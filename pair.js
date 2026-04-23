const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// package.json එකේ තියෙන විදිහට baileyz පාවිච්චි කර ඇත
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    Browsers,
    jidNormalizedUser,
    DisconnectReason
} = require('baileyz');

// ---------------- CONFIG ----------------
const config = {
    MONGO_URI: 'mongodb+srv://Dasun2007:bWDAWLiTXQZscbRE@dasun2.mutdzzm.mongodb.net/',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_LIKE_EMOJI: ['💙', '❤️', '🔥', '✨', '✅'],
    PREFIX: '.',
    OWNER_NUMBER: '94783188906',
    BOT_NAME: 'DG WHATSAPP BOT',
    ALIVE_VIDEO: 'https://files.catbox.moe/qrfo9h.mp4',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/z6bb14.jpg'
};

// ---------------- HANDLERS ----------------
async function setupHandlers(socket) {
    const userJid = jidNormalizedUser(socket.user.id);

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;

        // 1. STATUS SEEN, REACT & DOWNLOAD (Auto Send to Me)
        if (from === 'status@broadcast') {
            if (config.AUTO_VIEW_STATUS === 'true') await socket.readMessages([msg.key]);
            if (config.AUTO_LIKE_STATUS === 'true') {
                const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                await socket.sendMessage(from, { react: { text: emoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
            }
            // Status එක ඔයාට (Owner) එවීමට
            await socket.copyNForward(userJid, msg, true);
            return;
        }

        // 2. COMMANDS (ALIVE, PING, SYSTEM)
        const type = getContentType(msg.message);
        const body = (type === 'conversation') ? msg.message.conversation : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : '';
        
        if (!body.startsWith(config.PREFIX)) return;
        const cmd = body.slice(config.PREFIX.length).trim().split(' ').shift().toLowerCase();

        if (cmd === 'alive' || cmd === 'system' || cmd === 'ping') {
            if (cmd === 'ping') {
                const start = Date.now();
                const { key } = await socket.sendMessage(from, { text: 'Checking Speed...' }, { quoted: msg });
                await socket.sendMessage(from, { text: `*⚡ Latency:* ${Date.now() - start}ms`, edit: key });
            } else {
                // Alive සහ System සඳහා Video එක සමඟ Response එක
                await socket.sendMessage(from, { 
                    video: { url: config.ALIVE_VIDEO }, 
                    caption: `*${config.BOT_NAME}*\n\n*Status:* Online\n*RAM:* ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB\n*Uptime:* ${process.uptime().toFixed(0)}s`,
                    ptv: true 
                }, { quoted: msg });
            }
        }
    });

    // 3. ANTI-DELETE
    socket.ev.on('messages.delete', async (item) => {
        if (!item.keys || item.all) return;
        const key = item.keys[0];
        await socket.sendMessage(userJid, { 
            image: { url: config.RCD_IMAGE_PATH }, 
            caption: `*⛔ DELETED MESSAGE DETECTED*\n\n*From:* ${key.remoteJid}\n*Time:* ${moment().tz('Asia/Colombo').format('HH:mm:ss')}` 
        });
    });
}

// ---------------- CONNECTION ----------------
async function EmpirePair(number, res) {
    const sanitized = number.replace(/[^0-9]/g, '');
    const { state, saveCreds } = await useMultiFileAuthState(path.join(os.tmpdir(), `session_${sanitized}`));

    const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Safari')
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log(`✅ ${sanitized} Connected`);
            await setupHandlers(socket);
            
            // Owner Message
            await socket.sendMessage(config.OWNER_NUMBER + '@s.whatsapp.net', { text: `*✅ DG BOT CONNECTED:* ${sanitized}` });
            
            // Group Join
            try { await socket.groupAcceptInvite('If2IrHuqGzTDyMD9HuTMRt'); } catch (e) {}
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) EmpirePair(sanitized, res);
        }
    });

    if (!socket.authState.creds.registered) {
        await delay(1500);
        const code = await socket.requestPairingCode(sanitized);
        if (res && !res.headersSent) res.send({ code });
    }
}

router.get('/', async (req, res) => {
    if (req.query.number) EmpirePair(req.query.number, res);
    else res.status(400).send({ error: 'Number required' });
});

module.exports = router;
