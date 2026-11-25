const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require('baileys');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const packageJson = require('../../package.json');
const PluginManager = require('../core/plugin-manager.core');
const { getWhatsAppProxyConfig } = require('../config/whatsapp-proxy.config');
const ConnectionRecovery = require('../core/connection-recovery.core');
const instanceService = require('./instanceService');
const messageService = require('./messageService');
const webhookService = require('./webhookService');
const webhookHistoryService = require('./webhookHistoryService');
const axios = require('axios');
const instanceLogService = require('./instanceLogService');

class WhatsAppInstance {
    constructor(instanceData) {
        this.instanceData = instanceData;
        this.sock = null;
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        this.qrCode = null;
        this.authDir = path.join(__dirname, `../../auth/${instanceData.phone}`);
        this.pluginManager = new PluginManager(instanceData);
        this.groupMetadataCache = new Map();
        this.recovery = new ConnectionRecovery(
            () => this.initialize(),
            error => logger.error(`Reconnect failed for ${this.instanceData.phone}: ${error.message}`)
        );
        this.initializing = null;
        this.isManualRestart = false; // Flag to prevent auto-reconnect during manual restart
    }

    async initialize() {
        if (this.initializing) return this.initializing;
        const pending = this.initializeSocket();
        this.initializing = pending;
        try {
            return await pending;
        } finally {
            if (this.initializing === pending) this.initializing = null;
        }
    }

    async initializeSocket() {
        const previousSocket = this.sock;
        try {
            logger.info(`🔄 Initializing WhatsApp instance for ${this.instanceData.phone}...`);

            // Update instance status to connecting
            await instanceService.updateStatus(this.instanceData.id, 'connecting');

            // Create auth directory if it doesn't exist
            if (!fs.existsSync(this.authDir)) {
                fs.mkdirSync(this.authDir, { recursive: true });
            }

            // Initialize plugin manager
            await this.pluginManager.loadPlugins();

            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            const proxy = getWhatsAppProxyConfig();
            const { version, isLatest } = await fetchLatestBaileysVersion(proxy.versionOptions);

            logger.info(`📱 Using WA version ${version.join('.')}, isLatest: ${isLatest} for ${this.instanceData.phone}`);

            this.sock = makeWASocket({
                version,
                auth: state,
                ...proxy.socketOptions,
                printQRInTerminal: false,
                logger: {
                    level: 'error',
                    trace: () => {},
                    debug: () => {},
                    info: () => {},
                    warn: () => {},
                    error: (data, msg) => {
                        // Only log meaningful errors, ignore debug objects
                        if (msg && typeof msg === 'string') {
                            logger.error(`[Baileys] ${msg}`);
                        } else if (data && data.err && data.err instanceof Error) {
                            logger.error(`[Baileys] ${data.err.message}`);
                        }
                    },
                    fatal: (msg) => logger.error(`[Baileys Fatal] ${msg}`),
                    child: () => ({
                        level: 'error',
                        trace: () => {},
                        debug: () => {},
                        info: () => {},
                        warn: () => {},
                        error: (data, msg) => {
                            if (msg && typeof msg === 'string') {
                                logger.error(`[Baileys] ${msg}`);
                            } else if (data && data.err && data.err instanceof Error) {
                                logger.error(`[Baileys] ${data.err.message}`);
                            }
                        },
                        fatal: (msg) => logger.error(`[Baileys Fatal] ${msg}`)
                    })
                },
                cachedGroupMetadata: async (jid) => {
                    if (this.groupMetadataCache.has(jid)) {
                        return this.groupMetadataCache.get(jid);
                    }

                    try {
                        const metadata = await this.sock.groupMetadata(jid);
                        this.groupMetadataCache.set(jid, metadata);
                        return metadata;
                    } catch (error) {
                        logger.error(`Error getting group metadata of ${jid} for ${this.instanceData.phone}: ${error.message}`);
                        return null;
                    }
                }
            });

            this.setupEventHandlers(saveCreds);

            await instanceLogService.create({
                instanceId: this.instanceData.id,
                level: 'info',
                message: `WhatsApp instance initialized. WA version ${version.join('.')} is latest? ${isLatest}`
            });

        } catch (error) {
            logger.error(`❌ Error initializing WhatsApp instance ${this.instanceData.phone}: ${error.message}`);
            this.connectionStatus = 'error';
            try {
                await instanceLogService.create({
                    instanceId: this.instanceData.id,
                    level: 'error',
                    message: `Error initializing WhatsApp instance: ${error.message}`
                });
                await instanceService.updateStatus(this.instanceData.id, 'reconnecting');
            } catch (statusError) {
                logger.error(`Could not persist connection error for ${this.instanceData.phone}: ${statusError.message}`);
            }

            if (this.sock === previousSocket) {
                this.recovery.schedule();
            }
        }
    }

    setupEventHandlers(saveCreds) {
        const socket = this.sock;
        socket.ev.on('connection.update', async (update) => {
            if (socket !== this.sock || this.recovery.stopped) return;
            try {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.qrCode = qr;
                    logger.info(`📱 QR Code generated for ${this.instanceData.phone}. Scan to connect.`);
                    if (process.env.NODE_ENV === 'development') {
                        qrcodeTerminal.generate(qr, { small: true });
                    }
                    this.connectionStatus = 'qr_ready';
                    await instanceService.updateStatus(this.instanceData.id, 'qr_ready');
                    
                    const qrCodeImage = await qrcode.toDataURL(qr);
                    // Trigger webhook for QR code generation
                    await this.triggerWebhooks('connection.update', {
                        status: 'qr_ready',
                        qrCode: qr,
                        qrCodeImage: qrCodeImage, 
                        instance: this.instanceData,
                        timestamp: new Date().toISOString(),
                        message: 'QR Code generated. Scan to connect.'
                    });
                }

                if (connection === 'close') {
                    const disconnectReason = lastDisconnect?.error?.output?.statusCode;
                    const errorMessage = lastDisconnect?.error?.message;
                    const wasManualRestart = this.isManualRestart && disconnectReason !== 515;

                    this.isManualRestart = false;
                    this.isConnected = false;
                    this.recovery.markDisconnected();
                    logger.info(`🔌 Connection closed for ${this.instanceData.phone}. Reason: ${disconnectReason}, Error: ${errorMessage}`);

                    if (wasManualRestart) {
                        this.recovery.cancelRetry();
                        this.connectionStatus = 'disconnected';
                        await instanceService.updateStatus(this.instanceData.id, 'inactive');
                        await this.triggerWebhooks('connection.update', {
                            status: 'manual_restart',
                            instance: this.instanceData,
                            timestamp: new Date().toISOString(),
                            message: 'Connection closed for manual restart; auth preserved',
                            disconnectReason,
                            errorMessage,
                            authFolderCleaned: false
                        });
                    } else if (disconnectReason === DisconnectReason.loggedOut) {
                        // Server-reported logout requires user intervention; never delete auth automatically.
                        this.recovery.stop();
                        this.connectionStatus = 'logged_out';
                        await instanceService.updateStatus(this.instanceData.id, 'logged_out');
                        await this.triggerWebhooks('connection.update', {
                            status: 'logged_out',
                            instance: this.instanceData,
                            timestamp: new Date().toISOString(),
                            message: 'WhatsApp reported logout; auth retained for manual inspection',
                            disconnectReason,
                            errorMessage,
                            authFolderCleaned: false
                        });
                    } else {
                        this.connectionStatus = 'reconnecting';
                        const retry = this.recovery.schedule();
                        logger.info(`🔄 Reconnecting ${this.instanceData.phone} after ${retry?.delay ?? 'scheduled'} ms (attempt ${this.recovery.attempts})`);
                        await instanceService.updateStatus(this.instanceData.id, 'reconnecting');
                        await this.triggerWebhooks('connection.update', {
                            status: 'reconnecting',
                            instance: this.instanceData,
                            timestamp: new Date().toISOString(),
                            reconnectAttempt: this.recovery.attempts,
                            message: 'Connection lost; retry scheduled while retaining auth',
                            disconnectReason,
                            errorMessage
                        });
                    }
                } else if (connection === 'open') {
                    logger.info(`✅ WhatsApp connection established for ${this.instanceData.phone}`);
                    this.connectionStatus = 'connected';
                    this.isConnected = true;
                    this.qrCode = null;
                    const previousReconnectAttempts = this.recovery.attempts;
                    this.recovery.markConnected();
                    await instanceService.updateStatus(this.instanceData.id, 'active');
                    
                    // Trigger webhook for successful connection
                    await this.triggerWebhooks('connection.update', {
                        status: 'connected',
                        instance: this.instanceData,
                        timestamp: new Date().toISOString(),
                        message: 'WhatsApp connection established successfully',
                        previousReconnectAttempts
                    });
                } else if (connection === 'connecting') {
                    logger.info(`🔄 Connecting to WhatsApp for ${this.instanceData.phone}...`);
                    this.connectionStatus = 'connecting';
                    await instanceService.updateStatus(this.instanceData.id, 'connecting');
                    
                    // Trigger webhook for connecting state
                    await this.triggerWebhooks('connection.update', {
                        status: 'connecting',
                        instance: this.instanceData,
                        timestamp: new Date().toISOString(),
                        message: 'Attempting to connect to WhatsApp...'
                    });
                }

                await instanceLogService.create({
                    instanceId: this.instanceData.id,
                    level: 'info',
                    message: `Connection status changed: ${connection}`
                });
            } catch (error) {
                logger.error(`Connection event handler failed for ${this.instanceData.phone}: ${error.message}`);
            }
        });

        this.sock.ev.on('creds.update', saveCreds);
        this.sock.ev.on('messages.upsert', this.handleMessagesUpsert.bind(this));
        this.sock.ev.on('group-participants.update', this.handleGroupUpdate.bind(this));
        
        // Add error handling for Baileys internal errors (like MAC errors)
        this.sock.ev.on('CB:call', (callUpdate) => {
            // Handle call updates if needed
        });
        
        // Handle stream errors and message decryption failures
        this.sock.ws.on('error', (error) => {
            logger.warn(`WebSocket error for ${this.instanceData.phone}: ${error.message}`);
        });
        
        // Override console.error to catch Baileys internal errors
        const originalConsoleError = console.error;
        console.error = (...args) => {
            const errorString = args.join(' ');
            
            // Check for MAC errors and other Baileys-related errors
            if (errorString.includes('Bad MAC') || 
                errorString.includes('failed to decrypt message') ||
                errorString.includes('Session error')) {
                
                logger.warn(`[Baileys MAC Error Handled] ${errorString}`);
                // Don't crash the application - just log and continue
                return;
            }
            
            // Check for stream errors
            if (errorString.includes('stream errored out')) {
                logger.warn(`[Baileys Stream Error] ${errorString}`);
                return;
            }
            
            // Call original console.error for other errors
            originalConsoleError.apply(console, args);
        };
    }

    async handleGroupUpdate(update) {
        const { id, participants, action } = update;
        const message = { message: { groupUpdate: { participants, action } }, key: { remoteJid: id } };

        try {
            logger.info(`👥 Group participant update for ${this.instanceData.phone} in ${id}: ${action}`);
            await this.pluginManager.executePlugins(this.sock, message);
        } catch (error) {
            logger.error(`Error processing group participant update for ${this.instanceData.phone}: ${error.message}`);
        }
    }

    async handleMessagesUpsert(messageUpdate) {
        const { messages, type } = messageUpdate;

        if (type !== 'notify') return;

        for (const message of messages) {
            // Skip messages from self
            if (message.key.fromMe) continue;

            try {
                logger.info(`📨 Processing message from ${message.pushName || 'Unknown'} for instance ${this.instanceData.phone}`);

                // Store message in database
                await this.storeMessage(message);

                // Execute plugins
                await this.pluginManager.executePlugins(this.sock, message);

                // Trigger webhooks
                await this.triggerWebhooks('message.received', { message, instance: this.instanceData });

            } catch (error) {
                logger.error(`Error processing message for ${this.instanceData.phone}: ${error.message}`);
            }
        }
    }

    /**
     * Safely serialize an object to JSON-compatible format
     * Converts non-serializable objects like Uint8Array, functions, etc.
     */
    safeSerialize(obj) {
        try {
            return JSON.parse(JSON.stringify(obj, (key, value) => {
                // Handle Uint8Array
                if (value instanceof Uint8Array) {
                    return {
                        __type: 'Uint8Array',
                        data: Array.from(value)
                    };
                }
                
                // Handle functions
                if (typeof value === 'function') {
                    return {
                        __type: 'Function',
                        name: value.name || 'anonymous'
                    };
                }
                
                // Handle Buffer objects
                if (Buffer.isBuffer(value)) {
                    return {
                        __type: 'Buffer',
                        data: value.toString('base64')
                    };
                }
                
                // Handle circular references and other complex objects
                if (value && typeof value === 'object') {
                    // Check if it's a plain object or array
                    if (Object.prototype.toString.call(value) === '[object Object]' || Array.isArray(value)) {
                        return value;
                    }
                    // For other object types, convert to string representation
                    return {
                        __type: 'ComplexObject',
                        toString: value.toString()
                    };
                }
                
                return value;
            }));
        } catch (error) {
            logger.warn(`Failed to serialize object, using fallback: ${error.message}`);
            // Fallback: return a safe representation
            return {
                __serialization_error: true,
                error: error.message,
                type: typeof obj,
                toString: obj?.toString?.() || 'Unable to convert to string'
            };
        }
    }

    /**
     * Extract timestamp from Baileys Long object or number
     * @param {*} timestamp - The timestamp from Baileys (can be Long object or number)
     * @returns {number} - Unix timestamp in seconds
     */
    extractTimestamp(timestamp) {
        if (typeof timestamp === 'number') {
            return timestamp;
        }
        
        // Handle Long object from Baileys
        if (timestamp && typeof timestamp === 'object' && ('low' in timestamp || 'high' in timestamp)) {
            // Convert Long object to number
            if (timestamp.toNumber && typeof timestamp.toNumber === 'function') {
                return timestamp.toNumber();
            }
            
            // Manual conversion for Long-like objects
            const low = timestamp.low || 0;
            const high = timestamp.high || 0;
            return high * 0x100000000 + (low >>> 0);
        }
        
        // Fallback to current timestamp if we can't parse it
        logger.warn(`Unable to parse timestamp: ${JSON.stringify(timestamp)}, using current time`);
        return Math.floor(Date.now() / 1000);
    }

    async storeMessage(message) {
        try {
            // Safely serialize the raw message to avoid Prisma serialization errors
            const safeRawMessage = this.safeSerialize(message);
            
            const messageData = {
                instanceId: this.instanceData.id,
                direction: 'incoming',
                from: message.key.remoteJid,
                to: this.sock.user?.id || this.instanceData.phone,
                type: Object.keys(message.message || {})[0] || 'unknown',
                message: {
                    content: message.message?.conversation || 
                             message.message?.extendedTextMessage?.text ||
                             message.message?.imageMessage?.caption ||
                             'Media message',
                    pushName: message.pushName,
                    messageId: message.key.id,
                    timestamp: this.extractTimestamp(message.messageTimestamp),
                    raw: safeRawMessage
                },
                status: 'received',
                sentAt: new Date(this.extractTimestamp(message.messageTimestamp) * 1000)
            };

            await messageService.create(messageData);
        } catch (error) {
            logger.error(`Error storing message for ${this.instanceData.phone}: ${error.message}`);
        }
    }

    async triggerWebhooks(event, data) {
        try {
            const webhooks = await webhookService.getEnabledWebhooks(this.instanceData.id, event);
            
            for (const webhook of webhooks) {
                const startTime = Date.now();
                const payload = {
                    event,
                    data,
                    timestamp: new Date().toISOString(),
                    instanceId: this.instanceData.id
                };

                let historyData = {
                    instanceId: this.instanceData.id,
                    webhookId: webhook.id,
                    event: event,
                    payload: payload,
                    status: 'pending',
                    retryCount: 0
                };

                try {
                    const response = await axios.post(webhook.url, payload, {
                        timeout: 5000,
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': `${packageJson.name}/${packageJson.version}`
                        }
                    });

                    const responseTime = Date.now() - startTime;
                    
                    // Update history with success data
                    historyData = {
                        ...historyData,
                        status: 'success',
                        httpStatusCode: response.status,
                        responseTime: responseTime,
                        response: {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers,
                            data: response.data
                        },
                        completedAt: new Date()
                    };

                    logger.info(`📡 Webhook ${webhook.id} triggered successfully for ${event} (${responseTime}ms)`);
                    
                } catch (error) {
                    const responseTime = Date.now() - startTime;
                    let status = 'failed';
                    let httpStatusCode = null;
                    let response = null;
                    
                    if (error.code === 'ECONNABORTED') {
                        status = 'timeout';
                    } else if (error.response) {
                        httpStatusCode = error.response.status;
                        response = {
                            status: error.response.status,
                            statusText: error.response.statusText,
                            headers: error.response.headers,
                            data: error.response.data
                        };
                    }

                    // Update history with failure data
                    historyData = {
                        ...historyData,
                        status: status,
                        httpStatusCode: httpStatusCode,
                        responseTime: responseTime,
                        response: response,
                        errorMessage: error.message,
                        completedAt: new Date()
                    };

                    logger.error(`Failed to trigger webhook ${webhook.id} for ${event}: ${error.message} (${responseTime}ms)`);
                }

                // Save webhook history record
                try {
                    await webhookHistoryService.create(historyData);
                } catch (historyError) {
                    logger.error(`Failed to save webhook history for ${webhook.id}: ${historyError.message}`);
                }
            }
        } catch (error) {
            logger.error(`Error triggering webhooks for ${this.instanceData.phone}: ${error.message}`);
        }
    }

    async sendMessage(phoneNumber, messageText) {
        try {
            if (!this.isConnected) {
                throw new Error(`WhatsApp instance ${this.instanceData.phone} not connected`);
            }

            // Format phone number
            let formattedNumber = phoneNumber.replace(/[^\d]/g, '');
            if (!formattedNumber.startsWith('62')) {
                if (formattedNumber.startsWith('0')) {
                    formattedNumber = '62' + formattedNumber.substring(1);
                } else {
                    formattedNumber = '62' + formattedNumber;
                }
            }

            const jid = `${formattedNumber}@s.whatsapp.net`;

            logger.info(`📤 Sending message from ${this.instanceData.phone} to ${jid}: ${messageText}`);

            // Add watermark
            const finalMessage = `${messageText}\n\n> Sent via ${(s => s[0].toUpperCase() + s.slice(1, s.indexOf('-')))(packageJson.name)}\n> @${packageJson.author}/${packageJson.name}.git`;

            const result = await this.sock.sendMessage(jid, { text: finalMessage });

            // Store sent message in database
            const messageData = {
                instanceId: this.instanceData.id,
                direction: 'outgoing',
                from: this.instanceData.phone,
                to: formattedNumber,
                type: 'text',
                message: {
                    content: messageText,
                    messageId: result.key.id
                },
                status: 'sent',
                sentAt: new Date()
            };

            const storedMessage = await messageService.create(messageData);

            // Trigger webhook
            await this.triggerWebhooks('message.sent', { 
                message: storedMessage, 
                instance: this.instanceData,
                recipient: formattedNumber
            });

            logger.info(`✅ Message sent successfully from ${this.instanceData.phone} to ${phoneNumber}`);
            
            await instanceLogService.create({
                instanceId: this.instanceData.id,
                level: 'info',
                message: `Message sent: ${messageText}`
            });
            
            return { success: true, message: 'Message sent successfully', messageId: result.key.id };

        } catch (error) {
            logger.error(`❌ Error sending message from ${this.instanceData.phone}:`, error);
            await instanceLogService.create({
                instanceId: this.instanceData.id,
                level: 'error',
                message: `Error sending message: ${error.message}`
            });
            throw error;
        }
    }

    async sendGroupMessage(groupId, messageText) {
        try {
            if (!this.isConnected) {
                throw new Error(`WhatsApp instance ${this.instanceData.phone} not connected`);
            }

            const jid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;

            logger.info(`📤 Sending group message from ${this.instanceData.phone} to ${jid}: ${messageText}`);

            // Ensure we have group metadata and participants before sending
            try {
                await this.sock.groupMetadata(jid);
            } catch (metaError) {
                logger.warn(`Could not fetch group metadata for ${jid}: ${metaError.message}`);
            }

            // Add watermark  
            const finalMessage = `${messageText}\n\n> Sent via ${(s => s[0].toUpperCase() + s.slice(1, s.indexOf('-')))(packageJson.name)}\n> @${packageJson.author}/${packageJson.name}.git`;

            // Send with additional options to handle encryption properly
            const result = await this.sock.sendMessage(jid, { text: finalMessage }, { 
                ephemeralExpiration: 0,
                messageId: undefined // Let Baileys generate the message ID
            });

            // Store sent message in database
            const messageData = {
                instanceId: this.instanceData.id,
                direction: 'outgoing',
                from: this.instanceData.phone,
                to: groupId,
                type: 'text',
                message: {
                    content: messageText,
                    messageId: result.key.id,
                    isGroup: true
                },
                status: 'sent',
                sentAt: new Date()
            };

            const storedMessage = await messageService.create(messageData);

            // Trigger webhook
            await this.triggerWebhooks('message.sent', { 
                message: storedMessage, 
                instance: this.instanceData,
                recipient: groupId,
                isGroup: true
            });

            logger.info(`✅ Group message sent successfully from ${this.instanceData.phone} to ${groupId}`);
            
            await instanceLogService.create({
                instanceId: this.instanceData.id,
                level: 'info',
                message: `Group message sent to ${groupId}: ${messageText}`
            });
            
            return { success: true, message: 'Group message sent successfully', messageId: result.key.id };

        } catch (error) {
            logger.error(`❌ Error sending group message from ${this.instanceData.phone}:`, error);
            await instanceLogService.create({
                instanceId: this.instanceData.id,
                level: 'error',
                message: `Error sending group message: ${error.message}`
            });
            throw error;
        }
    }

    async sendMediaMessage(phoneNumber, mediaData) {
        try {
            if (!this.isConnected) {
                throw new Error(`WhatsApp instance ${this.instanceData.phone} not connected`);
            }

            // Format phone number
            let formattedNumber = phoneNumber.replace(/[^\d]/g, '');
            if (!formattedNumber.startsWith('62')) {
                if (formattedNumber.startsWith('0')) {
                    formattedNumber = '62' + formattedNumber.substring(1);
                } else {
                    formattedNumber = '62' + formattedNumber;
                }
            }

            const jid = `${formattedNumber}@s.whatsapp.net`;
            const { type, url, caption, filename } = mediaData;

            logger.info(`📤 Sending ${type} media from ${this.instanceData.phone} to ${jid}`);

            // Prepare media message object based on type
            let messageContent = {};
            
            switch (type.toLowerCase()) {
                case 'image':
                    messageContent = {
                        image: { url },
                        caption: caption ? `${caption}\n\n> Sent via ${(s => s[0].toUpperCase() + s.slice(1, s.indexOf('-')))(packageJson.name)}\n> @${packageJson.author}/${packageJson.name}.git` : undefined
                    };
                    break;
                case 'video':
                    messageContent = {
                        video: { url },
                        caption: caption ? `${caption}\n\n> Sent via ${(s => s[0].toUpperCase() + s.slice(1, s.indexOf('-')))(packageJson.name)}\n> @${packageJson.author}/${packageJson.name}.git` : undefined
                    };
                    break;
                case 'audio':
                    messageContent = {
                        audio: { url },
                        mimetype: 'audio/mp4'
                    };
                    break;
                case 'document':
                    messageContent = {
                        document: { url },
                        fileName: filename || 'document',
                        caption: caption ? `${caption}\n\n> Sent via ${(s => s[0].toUpperCase() + s.slice(1, s.indexOf('-')))(packageJson.name)}\n> @${packageJson.author}/${packageJson.name}.git` : undefined
                    };
                    break;
                default:
                    throw new Error(`Unsupported media type: ${type}. Supported types: image, video, audio, document`);
            }

            const result = await this.sock.sendMessage(jid, messageContent);

            // Store sent message in database
            const messageData = {
                instanceId: this.instanceData.id,
                direction: 'outgoing',
                from: this.instanceData.phone,
                to: formattedNumber,
                type: type.toLowerCase(),
                message: {
                    content: caption || `${type} media`,
                    messageId: result.key.id,
                    mediaType: type.toLowerCase(),
                    mediaUrl: url,
                    filename: filename
                },
                status: 'sent',
                sentAt: new Date()
            };

            const storedMessage = await messageService.create(messageData);

            // Trigger webhook
            await this.triggerWebhooks('message.sent', { 
                message: storedMessage, 
                instance: this.instanceData,
                recipient: formattedNumber,
                mediaType: type.toLowerCase()
            });

            logger.info(`✅ ${type} media sent successfully from ${this.instanceData.phone} to ${phoneNumber}`);
            
            await instanceLogService.create({
                instanceId: this.instanceData.id,
                level: 'info',
                message: `${type} media sent${caption ? " with caption: " + caption : ''}`
            });
            
            return { success: true, message: `${type} media sent successfully`, messageId: result.key.id };

        } catch (error) {
            logger.error(`❌ Error sending media message from ${this.instanceData.phone}:`, error);
            await instanceLogService.create({
                instanceId: this.instanceData.id,
                level: 'error',
                message: `Error sending media message: ${error.message}`
            });
            throw error;
        }
    }

    async close() {
        this.recovery.cancelRetry();
        this.recovery.markDisconnected();
        // Close connection without logging out (for restart)
        if (this.sock && this.sock.ws) {
            try {
                this.sock.ws.close();
                logger.info(`🔌 Connection closed for ${this.instanceData.phone}`);
            } catch (error) {
                logger.error(`Error closing connection for ${this.instanceData.phone}:`, error);
            }
        }
        
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        // Don't update status to inactive for close (only for logout)
    }

    async disconnect() {
        this.recovery.stop();
        if (this.sock) {
            try {
                await this.sock.logout();
                logger.info(`🔓 Instance ${this.instanceData.phone} logged out`);
            } catch (error) {
                logger.error(`Error logging out instance ${this.instanceData.phone}:`, error);
            }
        }
        
        this.isConnected = false;
        this.connectionStatus = 'disconnected';
        await instanceService.updateStatus(this.instanceData.id, 'inactive');
    }

    async getStatus() {
        const qrCodeImage = this.qrCode ? await qrcode.toDataURL(this.qrCode) : null;
        return {
            instanceId: this.instanceData.id,
            phone: this.instanceData.phone,
            name: this.instanceData.name,
            alias: this.instanceData.alias,
            isConnected: this.isConnected,
            connectionStatus: this.connectionStatus,
            qrCode: this.qrCode,
            qrCodeImage: qrCodeImage,
            reconnectAttempts: this.recovery.attempts,
            timestamp: new Date().toISOString()
        };
    }
}

class WhatsAppInstanceManager {
    constructor() {
        this.instances = new Map(); // phone -> WhatsAppInstance
        this.initialized = false;
    }

    async initialize() {
        try {
            logger.info('🔄 Initializing WhatsApp Instance Manager...');
            
            // Load existing instances from database
            const existingInstances = await instanceService.findAll();
            
            for (const instanceData of existingInstances) {
                const instance = new WhatsAppInstance(instanceData);
                this.instances.set(instanceData.phone, instance);
                
                // Initialize instance if it was active before
                if (['active', 'connecting', 'reconnecting', 'error'].includes(instanceData.status)) {
                    await instance.initialize();
                }
            }

            this.initialized = true;
            logger.info(`✅ WhatsApp Instance Manager initialized with ${existingInstances.length} instances`);
            
        } catch (error) {
            logger.error('❌ Error initializing WhatsApp Instance Manager:', error);
            throw error;
        }
    }

    async createInstance(instanceData) {
        try {
            // Create instance in database
            const dbInstance = await instanceService.create(instanceData);
            
            // Create and initialize WhatsApp instance
            const instance = new WhatsAppInstance(dbInstance);
            this.instances.set(dbInstance.phone, instance);
            
            // Initialize the instance
            await instance.initialize();
            
            logger.info(`✅ WhatsApp instance created for ${dbInstance.phone}`);
            return dbInstance;
            
        } catch (error) {
            logger.error(`❌ Error creating WhatsApp instance:`, error);
            throw error;
        }
    }

    async deleteInstance(phone, keepDatabaseRecord = false) {
        try {
            const instance = this.instances.get(phone);
            if (instance) {
                await instance.disconnect();
                this.instances.delete(phone);
            }

            // Delete from database only if not keeping records
            if (!keepDatabaseRecord) {
                const dbInstance = await instanceService.findByPhone(phone);
                if (dbInstance) {
                    await instanceService.delete(dbInstance.id);
                }
            }

            // Remove auth directory
            const authDir = path.join(__dirname, `../../auth/${phone}`);
            if (fs.existsSync(authDir)) {
                fs.rmSync(authDir, { recursive: true, force: true });
            }

            const message = keepDatabaseRecord 
                ? 'Instance logged out and cleaned up successfully. Restart to get new QR code.'
                : 'Instance deleted successfully';
            
            logger.info(`✅ WhatsApp instance ${keepDatabaseRecord ? 'cleaned up' : 'deleted'} for ${phone}`);
            return { success: true, message };
            
        } catch (error) {
            logger.error(`❌ Error ${keepDatabaseRecord ? 'cleaning up' : 'deleting'} WhatsApp instance ${phone}:`, error);
            throw error;
        }
    }

    getInstance(phone) {
        return this.instances.get(phone);
    }

    async getAllInstances() {
        const statuses = await Promise.all(
            Array.from(this.instances.values()).map(instance => instance.getStatus())
        );
        return statuses;
    }

    async getInstanceByPhone(phone) {
        const instance = this.instances.get(phone);
        if (instance) {
            const statuses = await instance.getStatus();
            return statuses;
        }

        // Try to get from database
        const dbInstance = await instanceService.findByPhone(phone);
        return dbInstance ? {
            instanceId: dbInstance.id,
            phone: dbInstance.phone,
            name: dbInstance.name,
            alias: dbInstance.alias,
            isConnected: false,
            connectionStatus: 'disconnected',
            qrCode: null,
            timestamp: new Date().toISOString()
        } : null;
    }

    async sendMessage(phone, recipientNumber, message) {
        const instance = this.instances.get(phone);
        if (!instance) {
            throw new Error(`WhatsApp instance ${phone} not found`);
        }
        return await instance.sendMessage(recipientNumber, message);
    }

    async sendGroupMessage(phone, groupId, message) {
        const instance = this.instances.get(phone);
        if (!instance) {
            throw new Error(`WhatsApp instance ${phone} not found`);
        }
        return await instance.sendGroupMessage(groupId, message);
    }

    async sendMediaMessage(phone, recipientNumber, mediaData) {
        const instance = this.instances.get(phone);
        if (!instance) {
            throw new Error(`WhatsApp instance ${phone} not found`);
        }
        return await instance.sendMediaMessage(recipientNumber, mediaData);
    }

    async restartInstance(phone) {
        const instance = this.instances.get(phone);
        if (!instance) {
            throw new Error(`WhatsApp instance ${phone} not found`);
        }

        // Manual restart preserves the existing credentials.
        instance.recovery.resume();
        instance.recovery.cancelRetry();
        instance.isManualRestart = true;
        
        // Close connection without logging out (to preserve auth)
        await instance.close();
        
        // Wait a moment for clean disconnection
        await new Promise(resolve => setTimeout(resolve, 1000));
        instance.isManualRestart = false;

        // Initialize the instance again
        await instance.initialize();
        
        return { success: true, message: 'Instance restarted successfully' };
    }

    async getManagerStatus() {
        const statuses = await this.getAllInstances();
        return {
            initialized: this.initialized,
            totalInstances: this.instances.size,
            connectedInstances: Array.from(this.instances.values()).filter(i => i.isConnected).length,
            instances: statuses
        };
    }
}

// Create singleton instance
const instanceManager = new WhatsAppInstanceManager();

module.exports = instanceManager;
