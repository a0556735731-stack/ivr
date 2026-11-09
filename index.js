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
  targetGroups: process.env.TARGET_GROUPS ? process.env.TARGET_GROUPS.split(',').map(s => s.trim()) : ['הפרגוד', 'חדשות', 'נייעס', 'מבזקים'],
  yemot: {
    apiUrl: 'https://www.call2all.co.il/ym/api',
    username: process.env.YEMOT_USERNAME || '0772290423',
    password: process.env.YEMOT_PASSWORD || '217056',
    token: '',
    maxFilesPerGroup: 30,
    pollIntervalSeconds: 15,
  },
  directSend: { enabled: true, extension: '0', recordingExtension: '0' },
  tempDir: './temp_audio'
};

if (!fs.existsSync(CONFIG.tempDir)) fs.mkdirSync(CONFIG.tempDir, { recursive: true });

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let serverStatus = 'מתאתחל... מחכה לחיבור וואטסאפ';
let currentQrDataUrl = null;
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
  res.send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ניהול קו קולי</title><style>body{font-family:sans-serif;background:#f0f2f5;padding:15px;margin:0}.card{background:#fff;border-radius:16px;padding:20px;max-width:480px;margin:0 auto 20px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.08)}h1{color:#128C7E;font-size:20px}.status{padding:6px 14px;border-radius:20px;font-weight:bold;margin:10px 0;display:inline-block;background:${isConnected?'#e8f5e9':'#fff8e1'};color:${isConnected?'#2e7d32':'#f57f17'}}.box{background:#e0f2fe;border:2px dashed #0284c7;padding:15px;border-radius:12px;margin:15px 0}.code{font-size:32px;font-weight:800;letter-spacing:4px;color:#0369a1;background:#fff;padding:10px;border-radius:8px;margin:10px 0}input{width:80%;padding:12px;font-size:16px;border:1px solid #ccc;border-radius:8px;text-align:center;margin-bottom:10px}button{background:#128C7E;color:#fff;border:none;padding:12px 24px;font-size:16px;font-weight:bold;border-radius:8px;cursor:pointer}.logs{text-align:right;font-size:13px;max-height:250px;overflow-y:auto;background:#263238;color:#eceff1;padding:12px;border-radius:10px;font-family:monospace}</style></head><body><div class="card"><h1>📞 גשר וואטסאפ לקו קולי</h1><p style="color:#666;font-size:14px">קו פעיל: 077-2290423</p><div class="status">● ${serverStatus}</div>${!isConnected?`<div class="box"><h3 style="margin-top:0;color:#0369a1">🔑 חיבור בלי מצלמה ובלי חברים!</h3><p style="font-size:13px">הזן את מספר הטלפון שלך לקבלת קוד:</p><form method="POST" action="/pair"><input type="tel" name="phone" placeholder="0501234567" required value="${req.query.phone||''}"><br><button type="submit">קבל קוד לוואטסאפ</button></form>${currentPairingCode?`<div style="margin-top:15px"><p style="font-weight:bold;color:#0284c7">הקוד שלך:</p><div class="code">${currentPairingCode}</div><p style="font-size:13px;text-align:right">1. פתח וואטסאפ > הגדרות > מכשירים מקושרים > קשר מכשיר.<br>2. לחץ למטה על <b>"קישור באמצעות מספר הטלפון"</b>.<br>3. הקלד את הקוד <b>${currentPairingCode}</b>.</p></div>`:''}</div>`:''}</div><div class="card"><h3 style="text-align:right">יומן פעילות</h3><div class="logs">${activityLogs.map(l=>`<div>[${l.time}] ${l.msg}</div>`).join('')||'ממתין...'}</div></div></body></html>`);
});

app.post('/pair', async (req, res) => {
  let phone = req.body.phone || '';
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('05')) phone = '972' + phone.substring(1);
  try {
    addLog(`מבקש קוד קישור עבור ${phone}...`);
    const code = await client.requestPairingCode(phone);
    currentPairingCode = code;
    addLog(`קוד קישור התקבל: ${code}`);
  } catch(e) {
    addLog(`שגיאה בבקשת קוד: ${e.message}`);
  }
  res.redirect(`/?phone=${req.body.phone||''}`);
});

app.listen(CONFIG.port, () => addLog(`שרת פעיל על פורט ${CONFIG.port}`));

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
  getNextFileName(ext) {
    if (!this.counters[ext]) this.counters[ext] = 1;
    const name = `${String(this.counters[ext]).padStart(3, '0')}.wav`;
    this.counters[ext] = (this.counters[ext] % CONFIG.yemot.maxFilesPerGroup) + 1;
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
  async checkAndDownloadRecordings(ext) {
    const token = await this.login();
    if (!token) return [];
    try {
      const res = await axios.get(`${CONFIG.yemot.apiUrl}/GetIVR2Dir`, { params: { token, path: `ivr2:${ext}` } });
      const files = res.data?.files || [];
      const results = [];
      for (const f of files) {
        if (f.name?.endsWith('.wav') && !f.name.startsWith('M0000')) {
          const dest = path.join(CONFIG.tempDir, `rec_${Date.now()}_${f.name}`);
          const writer = fs.createWriteStream(dest);
          const dl = await axios({ method: 'get', url: `${CONFIG.yemot.apiUrl}/DownloadFile?token=${token}&path=ivr2:${ext}/${f.name}`, responseType: 'stream' });
          await new Promise((res, rej) => { dl.data.pipe(writer); writer.on('finish', res); writer.on('error', rej); });
          await axios.get(`${CONFIG.yemot.apiUrl}/DeleteFile`, { params: { token, path: `ivr2:${ext}/${f.name}` } }).catch(()=>{});
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

let groupsMap = [
  { name: 'הפרגוד', extension: '1', recordingExtension: '1/9' },
  { name: 'חדשות', extension: '2', recordingExtension: '2/9' },
  { name: 'נייעס', extension: '3', recordingExtension: '3/9' }
];

async function syncGroupsAlphabetically(allChats) {
  const matched = [];
  for (const c of allChats) {
    if (c.isGroup && CONFIG.targetGroups.some(t => c.name.toLowerCase().includes(t.toLowerCase()))) {
      matched.push(c.name.trim());
    }
  }
  if (matched.length > 0) {
    matched.sort((a, b) => a.localeCompare(b, 'he'));
    groupsMap = matched.map((name, i) => ({ name, extension: (i + 1).toString(), recordingExtension: `${i + 1}/9` }));
  }
  addLog('שלוחות לפי א-ב: ' + groupsMap.map(g => `${g.extension}=${g.name}`).join(', '));
  try {
    for (const g of groupsMap) {
      const p = path.join(CONFIG.tempDir, `M0000_${g.extension}.wav`);
      await textToSpeechWav(`קבוצת ${g.name}`, p);
      await yemot.uploadFile(p, `ivr2:${g.extension}/M0000.wav`);
      try { fs.unlinkSync(p); } catch(e) {}
    }
    const p0 = path.join(CONFIG.tempDir, 'M0000_0.wav');
    await textToSpeechWav('נא הקישו מספר טלפון לשליחת הודעה, ובסיום סולמית. לאחר מכן השאירו הודעה.', p0);
    await yemot.uploadFile(p0, 'ivr2:0/M0000.wav');
    try { fs.unlinkSync(p0); } catch(e) {}
    let menu = 'ברוכים הבאים לקו העדכונים. לשליחת הודעה קולית למספר וואטסאפ חדש, הקישו 0. ';
    groupsMap.forEach(g => { menu += `לשמיעת עדכוני ${g.name}, הקישו ${g.extension}. `; });
    const pRoot = path.join(CONFIG.tempDir, 'M0000_root.wav');
    await textToSpeechWav(menu, pRoot);
    await yemot.uploadFile(pRoot, 'ivr2:M0000.wav');
    try { fs.unlinkSync(pRoot); } catch(e) {}
  } catch(e) {}
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
});

const activeChats = new Map();

client.on('ready', async () => {
  serverStatus = 'מחובר לוואטסאפ ומאזין 24/7!';
  currentPairingCode = null;
  addLog('וואטסאפ אומת בהצלחה!');
  const all = await client.getChats();
  await syncGroupsAlphabetically(all);
  for (const g of groupsMap) {
    const c = all.find(item => item.isGroup && item.name.toLowerCase().includes(g.name.toLowerCase()));
    if (c) activeChats.set(g.name, c);
  }
  startListener();
});

client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;
    const g = groupsMap.find(item => chat.name.toLowerCase().includes(item.name.toLowerCase()));
    if (!g) return;
    activeChats.set(g.name, chat);
    const ts = Date.now();
    const targetWav = path.join(CONFIG.tempDir, `ivr_${ts}.wav`);

    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'voice' || msg.type === 'video')) {
      const media = await msg.downloadMedia();
      if (!media?.data) return;
      const raw = path.join(CONFIG.tempDir, `raw_${ts}.${msg.type === 'video' ? 'mp4' : 'ogg'}`);
      fs.writeFileSync(raw, Buffer.from(media.data, 'base64'));
      await convertToIvrWav(raw, targetWav);
      await yemot.uploadFile(targetWav, `ivr2:${g.extension}/${yemot.getNextFileName(g.extension)}`);
      try { fs.unlinkSync(raw); fs.unlinkSync(targetWav); } catch (e) {}
      addLog(`שמע עלה לשלוחה ${g.extension} (${g.name})`);
      return;
    }

    const text = msg.body || msg.caption;
    if (text?.trim()) {
      await textToSpeechWav(text, targetWav);
      await yemot.uploadFile(targetWav, `ivr2:${g.extension}/${yemot.getNextFileName(g.extension)}`);
      try { fs.unlinkSync(targetWav); } catch (e) {}
      addLog(`הודעה עלתה לשלוחה ${g.extension} (${g.name})`);
    }
  } catch(e) {}
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
        const recs = await yemot.checkAndDownloadRecordings(g.recordingExtension);
        for (const item of recs) {
          const chat = activeChats.get(g.name);
          if (chat && !chat.isReadOnly) {
            const mp3 = path.join(CONFIG.tempDir, `snd_${Date.now()}.mp3`);
            await convertToMp3(item.path, mp3);
            await chat.sendMessage(MessageMedia.fromFilePath(mp3), { sendAudioAsVoice: true });
            addLog(`תגובה נשלחה לקבוצת ${chat.name}`);
            try { fs.unlinkSync(item.path); fs.unlinkSync(mp3); } catch (e) {}
          }
        }
      } catch (e) {}
    }
  }, CONFIG.yemot.pollIntervalSeconds * 1000);
}

client.initialize();
