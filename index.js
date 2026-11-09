process.on('uncaughtException', (err) => console.error('Caught:', err.message));
process.on('unhandledRejection', (reason) => console.error('Rejection:', reason));

const express = require('express');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const axios = require('axios');
const FormData = require('form-data');
const googleTTS = require('google-tts-api');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = {
  port: process.env.PORT || 3000,
  yemot: {
    apiUrl: 'https://www.call2all.co.il/ym/api',
    username: process.env.YEMOT_USERNAME || '0772290423',
    password: process.env.YEMOT_PASSWORD || '217056',
    token: '',
    maxFilesPerFolder: 30,
    pollIntervalSeconds: 15,
  },
  tempDir: './temp_audio'
};

if (!fs.existsSync(CONFIG.tempDir)) fs.mkdirSync(CONFIG.tempDir, { recursive: true });

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let serverStatus = 'מתאתחל...';
let currentPairingCode = null;
const activityLogs = [];

function addLog(msg) {
  const time = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' });
  activityLogs.unshift({ time, msg });
  if (activityLogs.length > 50) activityLogs.pop();
  console.log(`[${time}] ${msg}`);
}

app.get('/', (req, res) => {
  const isConnected = serverStatus.includes('מחובר');
  res.send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ניהול קו קולי</title><style>body{font-family:sans-serif;background:#f0f2f5;padding:15px;margin:0;color:#111}.card{background:#fff;border-radius:16px;padding:20px;max-width:480px;margin:0 auto 20px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.08)}h1{color:#128C7E;font-size:20px}.status{padding:6px 14px;border-radius:20px;font-weight:bold;margin:10px 0;display:inline-block;background:${isConnected?'#e8f5e9':'#fff8e1'};color:${isConnected?'#2e7d32':'#f57f17'}}.box{background:#e0f2fe;border:2px dashed #0284c7;padding:15px;border-radius:12px;margin:15px 0}.code{font-size:32px;font-weight:800;letter-spacing:4px;color:#0369a1;background:#fff;padding:10px;border-radius:8px;margin:10px 0}input{width:80%;padding:12px;font-size:16px;border:1px solid #ccc;border-radius:8px;text-align:center;margin-bottom:10px}button{background:#128C7E;color:#fff;border:none;padding:12px 24px;font-size:16px;font-weight:bold;border-radius:8px;cursor:pointer}.logs{text-align:right;font-size:13px;max-height:250px;overflow-y:auto;background:#263238;color:#eceff1;padding:12px;border-radius:10px;font-family:monospace}</style></head><body><div class="card"><h1>📞 גשר וואטסאפ לקו קולי</h1><p style="color:#666;font-size:14px">קו פעיל: 077-2290423</p><div class="status">● ${serverStatus}</div>${!isConnected?`<div class="box"><h3 style="margin-top:0;color:#0369a1">🔑 חיבור וואטסאפ</h3><p style="font-size:13px">הזן את מספר הטלפון לקבלת קוד:</p><form method="POST" action="/pair"><input type="tel" name="phone" placeholder="0556723061" required value="${req.query.phone||''}"><br><button type="submit">קבל קוד לוואטסאפ</button></form>${currentPairingCode?`<div style="margin-top:15px"><p style="font-weight:bold;color:#0284c7">הקוד שלך:</p><div class="code">${currentPairingCode}</div></div>`:''}</div>`:''}</div><div class="card"><h3 style="text-align:right">יומן פעילות</h3><div class="logs">${activityLogs.map(l=>`<div>[${l.time}] ${l.msg}</div>`).join('')||'ממתין...'}</div></div></body></html>`);
});

app.post('/pair', async (req, res) => {
  let phone = req.body.phone || '';
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('05')) phone = '972' + phone.substring(1);
  try {
    addLog(`מבקש קוד קישור עבור ${phone}...`);
    if (client && client.requestPairingCode) {
      const code = await client.requestPairingCode(phone);
      currentPairingCode = code;
      addLog(`קוד קישור התקבל: ${code}`);
    }
  } catch(e) {
    addLog(`שגיאה בבקשת קוד: ${e.message}`);
  }
  res.redirect(`/?phone=${req.body.phone||''}`);
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  addLog(`שרת האינטרנט זמין על פורט ${CONFIG.port}`);
});

class YemotClient {
  constructor() { this.token = ''; this.counters = {}; }
  async login() {
    if (this.token) return this.token;
    try {
      const res = await axios.get(`${CONFIG.yemot.apiUrl}/Login`, { params: { username: CONFIG.yemot.username, password: CONFIG.yemot.password } });
      if (res.data?.token) return (this.token = res.data.token);
    } catch(e) {}
    return null;
  }
  getNextFileName(pathKey) {
    if (!this.counters[pathKey]) this.counters[pathKey] = 1;
    const name = `${String(this.counters[pathKey]).padStart(3, '0')}.wav`;
    this.counters[pathKey] = (this.counters[pathKey] % CONFIG.yemot.maxFilesPerFolder) + 1;
    return name;
  }
  async uploadFile(localPath, destPath) {
    const token = await this.login();
    if (!token || !fs.existsSync(localPath)) return false;
    const form = new FormData();
    form.append('token', token); form.append('path', destPath);
    form.append('file', fs.createReadStream(localPath), { filename: path.basename(destPath), contentType: 'audio/wav' });
    try {
      const res = await axios.post(`${CONFIG.yemot.apiUrl}/UploadFile`, form, { headers: form.getHeaders() });
      return res.data?.responseStatus === 'OK';
    } catch(e) { return false; }
  }
  async checkAndDownloadRecordings(extPath) {
    const token = await this.login();
    if (!token) return [];
    try {
      const res = await axios.get(`${CONFIG.yemot.apiUrl}/GetIVR2Dir`, { params: { token, path: `ivr2:${extPath}` } });
      const files = res.data?.files || [];
      const results = [];
      for (const f of files) {
        if (f.name?.endsWith('.wav') && !f.name.startsWith('M0000')) {
          const dest = path.join(CONFIG.tempDir, `rec_${Date.now()}_${f.name}`);
          const writer = fs.createWriteStream(dest);
          const dl = await axios({ method: 'get', url: `${CONFIG.yemot.apiUrl}/DownloadFile?token=${token}&path=ivr2:${extPath}/${f.name}`, responseType: 'stream' });
          await new Promise((res, rej) => { dl.data.pipe(writer); writer.on('finish', res); writer.on('error', rej); });
          await axios.get(`${CONFIG.yemot.apiUrl}/DeleteFile`, { params: { token, path: `ivr2:${extPath}/${f.name}` } }).catch(()=>{});
          results.push({ path: dest, name: f.name });
        }
      }
      return results;
    } catch(e) { return []; }
  }
}

const yemot = new YemotClient();

function convertToIvrWav(inputPath, outputPath) {
  return new Promise((res, rej) => {
    ffmpeg(inputPath).noVideo().toFormat('wav').audioCodec('pcm_s16le').audioChannels(1).audioFrequency(8000).on('error', rej).on('end', () => res(outputPath)).save(outputPath);
  });
}

function convertToMp3(inputPath, outputPath) {
  return new Promise((res, rej) => {
    ffmpeg(inputPath).toFormat('mp3').audioBitrate(64).audioChannels(1).on('error', rej).on('end', () => res(outputPath)).save(outputPath);
  });
}

async function textToSpeechWav(text, outputPath) {
  let clean = (text || '').replace(/https?:\/\/\S+/gi, ' קישור ').replace(/\n+/g, '. ').trim();
  if (clean.length > 400) clean = clean.substring(0, 397) + '...';
  const url = googleTTS.getAudioUrl(clean, { lang: 'he', slow: false, host: 'https://translate.google.com' });
  const rawMp3 = path.join(CONFIG.tempDir, `tts_${Date.now()}.mp3`);
  await new Promise((res, rej) => {
    const file = fs.createWriteStream(rawMp3);
    https.get(url, r => { r.pipe(file); file.on('finish', () => file.close(res)); }).on('error', rej);
  });
  await convertToIvrWav(rawMp3, outputPath);
  try { fs.unlinkSync(rawMp3); } catch(e) {}
  return outputPath;
}

let groupsMap = [];
let contactsMap = [];
const activeChatsMap = new Map();

async function setupMainAndSubMenus() {
  try {
    addLog('מעדכן תפריטים: שלוחה 1 (קבוצות) ושלוחה 2 (אישי) לפי א-ב...');

    const rootMenu = 'ברוכים הבאים. לשמיעת קבוצות, הקישו 1. לשמיעת צ\'אטים אישיים, הקישו 2. לשליחת הודעה קולית למספר חדש, הקישו 0.';
    const pRoot = path.join(CONFIG.tempDir, 'M0000_root.wav');
    await textToSpeechWav(rootMenu, pRoot);
    await yemot.uploadFile(pRoot, 'ivr2:M0000.wav');
    try { fs.unlinkSync(pRoot); } catch(e) {}

    const p0 = path.join(CONFIG.tempDir, 'M0000_0.wav');
    await textToSpeechWav('נא הקישו מספר טלפון לשליחת הודעה, ובסיום סולמית. לאחר מכן השאירו הודעה.', p0);
    await yemot.uploadFile(p0, 'ivr2:0/M0000.wav');
    try { fs.unlinkSync(p0); } catch(e) {}

    let groupsPrompt = 'תפריט קבוצות. ';
    if (groupsMap.length === 0) {
      groupsPrompt += 'אין כרגע קבוצות זמינות.';
    } else {
      groupsMap.forEach(g => { groupsPrompt += `לשמיעת ${g.name}, הקישו ${g.subExt}. `; });
    }
    const p1 = path.join(CONFIG.tempDir, 'M0000_1.wav');
    await textToSpeechWav(groupsPrompt, p1);
    await yemot.uploadFile(p1, 'ivr2:1/M0000.wav');
    try { fs.unlinkSync(p1); } catch(e) {}

    for (const g of groupsMap) {
      const pSub = path.join(CONFIG.tempDir, `M0000_1_${g.subExt}.wav`);
      await textToSpeechWav(`קבוצת ${g.name}`, pSub);
      await yemot.uploadFile(pSub, `ivr2:1/${g.subExt}/M0000.wav`);
      try { fs.unlinkSync(pSub); } catch(e) {}
    }

    let contactsPrompt = 'תפריט צ\'אטים אישיים. ';
    if (contactsMap.length === 0) {
      contactsPrompt += 'אין כרגע צ\'אטים אישיים.';
    } else {
      contactsMap.forEach(c => { contactsPrompt += `לשמיעת שיחה עם ${c.name}, הקישו ${c.subExt}. `; });
    }
    const p2 = path.join(CONFIG.tempDir, 'M0000_2.wav');
    await textToSpeechWav(contactsPrompt, p2);
    await yemot.uploadFile(p2, 'ivr2:2/M0000.wav');
    try { fs.unlinkSync(p2); } catch(e) {}

    for (const c of contactsMap) {
      const pSub = path.join(CONFIG.tempDir, `M0000_2_${c.subExt}.wav`);
      await textToSpeechWav(`שיחה עם ${c.name}`, pSub);
      await yemot.uploadFile(pSub, `ivr2:2/${c.subExt}/M0000.wav`);
      try { fs.unlinkSync(pSub); } catch(e) {}
    }

    addLog('✅ כל התפריטים הועלו בהצלחה לקו!');
  } catch(e) {
    addLog('שגיאה בעדכון תפריטים: ' + e.message);
  }
}

async function syncAllChatsAlphabetically(allChats) {
  const groupsList = [];
  const contactsList = [];

  for (const chat of allChats) {
    const name = chat.name || (chat.id?.user || 'איש קשר');
    activeChatsMap.set(name, chat);

    if (chat.isGroup) {
      groupsList.push(name.trim());
    } else {
      contactsList.push(name.trim());
    }
  }

  groupsList.sort((a, b) => a.localeCompare(b, 'he'));
  contactsList.sort((a, b) => a.localeCompare(b, 'he'));

  groupsMap = groupsList.slice(0, 30).map((name, i) => ({
    name,
    subExt: (i + 1).toString(),
    path: `1/${i + 1}`,
    recordingPath: `1/${i + 1}/9`
  }));

  contactsMap = contactsList.slice(0, 30).map((name, i) => ({
    name,
    subExt: (i + 1).toString(),
    path: `2/${i + 1}`,
    recordingPath: `2/${i + 1}/9`
  }));

  addLog(`מוינו ${groupsMap.length} קבוצות (שלוחה 1) ו-${contactsMap.length} צ'אטים אישיים (שלוחה 2) לפי א-ב`);
  await setupMainAndSubMenus();
}

setupMainAndSubMenus();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
  }
});

client.on('ready', async () => {
  serverStatus = 'מחובר לוואטסאפ ומאזין 24/7!';
  currentPairingCode = null;
  addLog('וואטסאפ אומת בהצלחה! מסנכרן את כל הקבוצות והצ\'אטים האישיים...');
  try {
    const all = await client.getChats();
    await syncAllChatsAlphabetically(all);
  } catch(e) {}
  startListener();
});

client.on('message_create', async (msg) => {
  try {
    const chat = await msg.getChat();
    const chatName = chat.name || (chat.id?.user || 'איש קשר');
    activeChatsMap.set(chatName, chat);

    const isGroup = chat.isGroup;
    let targetEntry = null;

    if (isGroup) {
      targetEntry = groupsMap.find(g => chatName.toLowerCase().includes(g.name.toLowerCase()));
      if (!targetEntry) {
        const nextSub = (groupsMap.length + 1).toString();
        targetEntry = { name: chatName, subExt: nextSub, path: `1/${nextSub}`, recordingPath: `1/${nextSub}/9` };
        groupsMap.push(targetEntry);
      }
    } else {
      targetEntry = contactsMap.find(c => chatName.toLowerCase().includes(c.name.toLowerCase()));
      if (!targetEntry) {
        const nextSub = (contactsMap.length + 1).toString();
        targetEntry = { name: chatName, subExt: nextSub, path: `2/${nextSub}`, recordingPath: `2/${nextSub}/9` };
        contactsMap.push(targetEntry);
      }
    }

    const destFolder = targetEntry.path;
    addLog(`הודעה מ-${isGroup ? 'קבוצת' : 'צ\'אט אישי'} "${chatName}" -> שלוחה ${destFolder}`);

    const ts = Date.now();
    const targetWav = path.join(CONFIG.tempDir, `ivr_${ts}.wav`);

    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'voice' || msg.type === 'video')) {
      const media = await msg.downloadMedia();
      if (!media?.data) return;
      const raw = path.join(CONFIG.tempDir, `raw_${ts}.${msg.type === 'video' ? 'mp4' : 'ogg'}`);
      fs.writeFileSync(raw, Buffer.from(media.data, 'base64'));
      await convertToIvrWav(raw, targetWav);
      await yemot.uploadFile(targetWav, `ivr2:${destFolder}/${yemot.getNextFileName(destFolder)}`);
      try { fs.unlinkSync(raw); fs.unlinkSync(targetWav); } catch (e) {}
      addLog(`🎉 שמע עלה לשלוחה ${destFolder} ("${chatName}")!`);
      return;
    }

    const text = msg.body || msg.caption;
    if (text?.trim()) {
      const formatted = `הודעה מאת ${chatName}: ${text}`;
      await textToSpeechWav(formatted, targetWav);
      await yemot.uploadFile(targetWav, `ivr2:${destFolder}/${yemot.getNextFileName(destFolder)}`);
      try { fs.unlinkSync(targetWav); } catch (e) {}
      addLog(`🎉 הודעה הוקראה ועלתה לשלוחה ${destFolder} ("${chatName}")!`);
    }
  } catch(e) {
    addLog(`שגיאה בטיפול בהודעה: ${e.message}`);
  }
});

function startListener() {
  setInterval(async () => {
    try {
      const recs0 = await yemot.checkAndDownloadRecordings('0');
      for (const item of recs0) {
        const match = item.name.match(/(\d{9,12})/);
        if (match) {
          let num = match[1];
          if (num.startsWith('05')) num = '972' + num.substring(1);
          const mp3 = path.join(CONFIG.tempDir, `snd_${Date.now()}.mp3`);
          await convertToMp3(item.path, mp3);
          await client.sendMessage(`${num}@c.us`, MessageMedia.fromFilePath(mp3), { sendAudioAsVoice: true });
          addLog(`הקלטה נשלחה למספר ${num}`);
          try { fs.unlinkSync(item.path); fs.unlinkSync(mp3); } catch (e) {}
        }
      }
    } catch(e) {}

    for (const g of groupsMap) {
      try {
        const recs = await yemot.checkAndDownloadRecordings(g.recordingPath);
        for (const item of recs) {
          const chat = activeChatsMap.get(g.name);
          if (chat && !chat.isReadOnly) {
            const mp3 = path.join(CONFIG.tempDir, `snd_${Date.now()}.mp3`);
            await convertToMp3(item.path, mp3);
            await chat.sendMessage(MessageMedia.fromFilePath(mp3), { sendAudioAsVoice: true });
            addLog(`תגובה קולית נשלחה לקבוצה "${g.name}"!`);
            try { fs.unlinkSync(item.path); fs.unlinkSync(mp3); } catch (e) {}
          }
        }
      } catch(e) {}
    }

    for (const c of contactsMap) {
      try {
        const recs = await yemot.checkAndDownloadRecordings(c.recordingPath);
        for (const item of recs) {
          const chat = activeChatsMap.get(c.name);
          if (chat) {
            const mp3 = path.join(CONFIG.tempDir, `snd_${Date.now()}.mp3`);
            await convertToMp3(item.path, mp3);
            await chat.sendMessage(MessageMedia.fromFilePath(mp3), { sendAudioAsVoice: true });
            addLog(`תגובה קולית נשלחה לצ'אט האישי של "${c.name}"!`);
            try { fs.unlinkSync(item.path); fs.unlinkSync(mp3); } catch (e) {}
          }
        }
      } catch(e) {}
    }
  }, CONFIG.yemot.pollIntervalSeconds * 1000);
}

try { client.initialize(); } catch(e) {}
