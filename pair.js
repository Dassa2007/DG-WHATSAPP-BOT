const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys'); // Baileys නිවැරදි කළා

// ---------------- CONFIG ----------------
const BOT_NAME_FANCY = 'DG WHATSAPP BOT';

const config = {
  MONGO_URI: process.env.MONGO_URI || 'mongodb+srv://Dasun2007:bWDAWLiTXQZscbRE@dasun2.mutdzzm.mongodb.net/',
  SESSION_ID: process.env.SESSION_ID || '',
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'true',
  AUTO_LIKE_EMOJI: ['💙', '🩷', '💜', '🤎', '🧡', '🩵', '💛', '🩶', '♥️', '💗', '❤️‍🔥'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/If2IrHuqGzTDyMD9HuTMRt?mode=gi_t',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/z6bb14.jpg',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '94783188906',
  BOT_NAME: 'DG WHATSAPP BOT',
  BOT_VERSION: '1.0.0V',
  OWNER_NAME: 'DASUN GIMHANA',
  IMAGE_PATH: 'https://files.catbox.moe/iixpfq.jpg',
  ALIVE_VIDEO: 'https://files.catbox.moe/qrfo9h.mp4'
};

// ---------------- MONGO SETUP ----------------
let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, configsCol;

async function initMongo() {
  if (mongoClient && mongoClient.topology?.isConnected()) return;
  mongoClient = new MongoClient(config.MONGO_URI);
  await mongoClient.connect();
  mongoDB = mongoClient.db('FREE');
  sessionsCol = mongoDB.collection('sessions');
  numbersCol = mongoDB.collection('numbers');
  adminsCol = mongoDB.collection('admins');
  configsCol = mongoDB.collection('configs');
  console.log('✅ Mongo initialized');
}

// Mongo helpers
async function saveCredsToMongo(number, creds) {
  await initMongo();
  const sanitized = number.replace(/[^0-9]/g, '');
  await sessionsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, creds, updatedAt: new Date() } }, { upsert: true });
}

async function loadCredsFromMongo(number) {
  await initMongo();
  const sanitized = number.replace(/[^0-9]/g, '');
  return await sessionsCol.findOne({ number: sanitized });
}

async function removeSessionFromMongo(number) {
  await initMongo();
  await sessionsCol.deleteOne({ number: number.replace(/[^0-9]/g, '') });
}

async function addNumberToMongo(number) {
  await initMongo();
  await numbersCol.updateOne({ number: number.replace(/[^0-9]/g, '') }, { $set: { number: number.replace(/[^0-9]/g, '') } }, { upsert: true });
}

async function getAllNumbersFromMongo() {
  await initMongo();
  const docs = await numbersCol.find({}).toArray();
  return docs.map(d => d.number);
}

async function loadAdminsFromMongo() {
  await initMongo();
  const docs = await adminsCol.find({}).toArray();
  return docs.map(d => d.jid || d.number).filter(Boolean);
}

async function loadUserConfigFromMongo(number) {
  await initMongo();
  const doc = await configsCol.findOne({ number: number.replace(/[^0-9]/g, '') });
  return doc ? doc.config : null;
}

// ---------------- UTILS ----------------
function formatMessage(title, content, footer) {
  return `${title}\n\n${content}\n\n> *${footer}*`;
}
function getSriLankaTimestamp() { return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();
const socketCreationTime = new Map();

// ---------------- STATUS HANDLER (VIEW, REACT, DOWNLOAD) ----------------
async function setupStatusHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.key || msg.key.remoteJid !== 'status@broadcast') return;

    try {
      // 1. Auto View
      if (config.AUTO_VIEW_STATUS === 'true') {
        await socket.readMessages([msg.key]);
      }

      // 2. Auto React
      if (config.AUTO_LIKE_STATUS === 'true') {
        const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
        await socket.sendMessage('status@broadcast', {
          react: { text: emoji, key: msg.key }
        }, { statusJidList: [msg.key.participant] });
      }

      // 3. Status Download & Send to Me
      const userJid = jidNormalizedUser(socket.user.id);
      await socket.copyNForward(userJid, msg, true);

    } catch (e) {
      console.error('Status Error:', e);
    }
  });
}

// ---------------- ANTI-DELETE HANDLER ----------------
async function handleMessageRevocation(socket) {
  socket.ev.on('messages.delete', async (item) => {
    if (item.all) return;
    const key = item.keys[0];
    const userJid = jidNormalizedUser(socket.user.id);
    const msg = formatMessage('*⛔ MESSAGE DELETED*', `A message was deleted.\n*From:* ${key.remoteJid}\n*Time:* ${getSriLankaTimestamp()}`, BOT_NAME_FANCY);
    await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: msg });
  });
}

// ---------------- COMMAND HANDLERS ----------------
function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    const from = msg.key.remoteJid;
    const type = getContentType(msg.message);
    const body = type === 'conversation' ? msg.message.conversation : type === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';
    
    if (!body.startsWith(config.PREFIX)) return;
    const command = body.slice(config.PREFIX.length).trim().split(' ').shift().toLowerCase();

    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const commonVideo = { video: { url: config.ALIVE_VIDEO }, ptv: true };

    switch (command) {
      case 'alive':
        await socket.sendMessage(from, commonVideo);
        await socket.sendMessage(from, { 
          image: { url: config.IMAGE_PATH }, 
          caption: `*HY 👋 ${config.BOT_NAME} IS ALIVE*\n\n*Uptime:* ${hours}h ${minutes}m\n*Owner:* ${config.OWNER_NAME}` 
        }, { quoted: msg });
        break;

      case 'ping':
        const start = Date.now();
        await socket.sendMessage(from, { text: 'Testing Speed...' });
        const end = Date.now();
        await socket.sendMessage(from, { text: `*⚡ Latency:* ${end - start}ms` }, { quoted: msg });
        break;

      case 'system':
        // Alive එකේ වීඩියෝවම යැවීම
        await socket.sendMessage(from, commonVideo);
        const sysInfo = `*☘️ SYSTEM INFO*\n\n*OS:* ${os.type()}\n*Platform:* ${os.platform()}\n*RAM:* ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`;
        await socket.sendMessage(from, { text: sysInfo }, { quoted: msg });
        break;
    }
  });
}

// ---------------- CONNECTION LOGIC ----------------
async function joinGroup(socket) {
  const code = config.GROUP_INVITE_LINK.split('chat.whatsapp.com/')[1];
  if (code) await socket.groupAcceptInvite(code);
}

async function EmpirePair(number, res) {
  const sanitized = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
  
  const mongoDoc = await loadCredsFromMongo(sanitized);
  if (mongoDoc) {
    fs.ensureDirSync(sessionPath);
    fs.writeJsonSync(path.join(sessionPath, 'creds.json'), mongoDoc.creds);
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Safari')
  });

  socketCreationTime.set(sanitized, Date.now());

  socket.ev.on('creds.update', async () => {
    await saveCreds();
    await saveCredsToMongo(sanitized, state.creds);
  });

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(`✅ Connected: ${sanitized}`);
      activeSockets.set(sanitized, socket);
      await addNumberToMongo(sanitized);
      await joinGroup(socket);
      
      const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
      await socket.sendMessage(ownerJid, { text: `*✅ BOT CONNECTED:* ${sanitized}` });
      
      setupStatusHandlers(socket, sanitized);
      setupCommandHandlers(socket, sanitized);
      handleMessageRevocation(socket);
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) EmpirePair(sanitized, res);
      else {
        await removeSessionFromMongo(sanitized);
        fs.removeSync(sessionPath);
      }
    }
  });

  if (!socket.authState.creds.registered) {
    await delay(1500);
    const code = await socket.requestPairingCode(sanitized);
    if (res && !res.headersSent) res.send({ code });
  }
}

// ---------------- ROUTES ----------------
router.get('/', async (req, res) => {
  if (req.query.number) EmpirePair(req.query.number, res);
  else res.status(400).send({ error: 'Number required' });
});

module.exports = router;
