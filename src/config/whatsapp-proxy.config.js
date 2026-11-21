// HTTP CONNECT proxy configuration shared by single and multi-instance Baileys sockets.
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ProxyAgent } = require('undici');

let config;

const getWhatsAppProxyConfig = () => {
    if (config) return config;

    const proxyUrl = process.env.WHATSAPP_PROXY_URL?.trim();
    if (!proxyUrl) {
        if (process.env.WHATSAPP_PROXY_REQUIRED === 'true') {
            throw new Error('WHATSAPP_PROXY_URL is required when WHATSAPP_PROXY_REQUIRED=true');
        }

        config = { socketOptions: {}, versionOptions: {} };
        return config;
    }

    let url;
    try {
        url = new URL(proxyUrl);
    } catch {
        throw new Error('WHATSAPP_PROXY_URL must be a valid HTTP proxy URL');
    }

    if (url.protocol !== 'http:' || !url.hostname || !url.port) {
        throw new Error('WHATSAPP_PROXY_URL must use http://HOST:PORT');
    }

    // Baileys uses a Node Agent for WebSocket/upload and an Undici dispatcher for fetch.
    const agent = new HttpsProxyAgent(url);
    const dispatcher = new ProxyAgent(url.toString());

    config = {
        socketOptions: {
            agent,
            fetchAgent: agent,
            options: { dispatcher }
        },
        versionOptions: { dispatcher }
    };
    return config;
};

module.exports = { getWhatsAppProxyConfig };
