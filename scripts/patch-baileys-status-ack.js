// Backport WhiskeySockets/Baileys#2883 to the published 7.0.0-rc14 build.
// The upstream fix ACKs top-level status stanzas, including offline ones.
const fs = require('node:fs');
const path = require('node:path');

const baileysDir = path.resolve(__dirname, '../node_modules/baileys');
const packagePath = path.join(baileysDir, 'package.json');
const target = path.join(baileysDir, 'lib/Socket/messages-recv.js');
const version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;

if (version !== '7.0.0-rc14') {
    throw new Error(`Status ACK patch supports Baileys 7.0.0-rc14, found ${version}`);
}

let source = fs.readFileSync(target, 'utf8');

const changes = [
    [
        `    const offlineNodeProcessor = makeOfflineNodeProcessor(new Map([\n        ['message', handleMessage],\n        ['call', handleCall],\n        ['receipt', handleReceipt],\n        ['notification', handleNotification]\n    ]), {`,
        `    const handleStatus = async (node) => {\n        try {\n            await sendMessageAck(node);\n        }\n        catch (error) {\n            onUnexpectedError(error, 'acking status stanza');\n        }\n    };\n    const offlineNodeProcessor = makeOfflineNodeProcessor(new Map([\n        ['message', handleMessage],\n        ['call', handleCall],\n        ['receipt', handleReceipt],\n        ['notification', handleNotification],\n        ['status', handleStatus]\n    ]), {`
    ],
    [
        `    ws.on('CB:notification', async (node) => {\n        await processNode('notification', node, 'handling notification', handleNotification);\n    });`,
        `    ws.on('CB:notification', async (node) => {\n        await processNode('notification', node, 'handling notification', handleNotification);\n    });\n    ws.on('CB:status', async (node) => {\n        await processNode('status', node, 'acking status stanza', handleStatus).catch(error => onUnexpectedError(error, 'acking status stanza'));\n    });`
    ]
];

const isPatched = source.includes("['status', handleStatus]") &&
    source.includes("ws.on('CB:status'") &&
    source.includes('const handleStatus = async (node) => {');

if (isPatched) {
    console.log('Baileys status ACK patch already applied.');
    process.exit(0);
}

for (const [original, replacement] of changes) {
    if (source.split(original).length !== 2) {
        throw new Error('Unexpected Baileys build; refusing to apply partial status ACK patch.');
    }
    source = source.replace(original, replacement);
}

fs.writeFileSync(target, source);
console.log('Applied Baileys status ACK patch (WhiskeySockets/Baileys#2883).');
