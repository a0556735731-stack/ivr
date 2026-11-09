process.on('uncaughtException', err => console.error('P:', err.message));
process.on('unhandledRejection', r => console.error('R:', r));

const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
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
    maxFiles: 30
  },
  temp: './temp_audio'
};

if (!fs.existsSync(CONFIG.temp)) fs.mkdirSync(CONFIG.temp, { recursive: true });

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let statusText = 'מתאתחל...';
let pCode = null;
let pPhone = '';
const logs = [];

function log(m) {
  const t = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' });
  logs.unshift(`[${t}] ${m}`);
  if (logs.length > 40) logs.pop();
  console.log(`[${t}] ${m}`);
}

app.get('/', (req, res) => {
  const ok = statusText.includes('מחובר');
  res.send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${!ok && pPhone && !pCode ? '<meta http-equiv="refresh" content="3">' : ''}<title>קו קולי</title><style>body{font-family:sans-serif;background:#f0f2f5;padding:15px;margin:0;text-align:center}.c{background:#fff;border-radius:14px;padding:20px;max-width:440px;margin:0 auto 15px;box-shadow:0 3px 10px rgba(0,0,0,.08)}h1{color:#128C7E;font-size:19px}.s{display:inline-block;padding:5px 12px;border-radius:20px;font-weight:bold;margin:8px 0;background:${ok?'#e8f5e9':'#fff8e1'};color:${ok?'#2e7d32':'#f57f17'}}.b{background:#e0f2fe;border:2px dashed #0284c7;padding:12px;border-radius:10px;margin:12px 0}.cd{font-size:32px;font-weight:bold;color:#0369a1;background:#fff;padding:8px;border-radius:6px;margin:10px 0}input{width:75%;padding:10px;font-size:16px;border:1px solid #ccc;border-radius:6px;text-align:center}button{background:#128C7E;color:#fff;border:none;padding:10px 20px;font-size:15px;font-weight:bold;border-radius:6px;margin-top:8px;cursor:pointer}.l{text-align:right;font-size:12px;max-height:220px;overflow-y:auto;background:#263238;color:#eceff1;padding:10px;border-radius:8px;font-family:monospace}</style></head><body><div class="c"><h1>📞 גשר וואטסאפ לקו קולי</h1><p style="color:#666;font-size:13px;margin:0">קו פעיל: 077-2290423</p><div class="s">● ${statusText}</div>${!ok ? `<div class="b"><h3 style="margin:0 0 5px;color:#0369a1">🔑 חיבור וואטסאפ</h3><form method="POST" action="/pair"><input type="tel" name="phone" placeholder="0556723061" required value="${pPhone}"><br><button type="submit">קבל קוד לוואטסאפ</button></form>${pCode ? `<div style="margin-top:12px"><p style="font-weight:bold;margin:0;color:#0284c7">הקוד שלך:</p><div class="cd">${pCode}</div><p style="font-size:12px;margin:0">בוואטסאפ > מכשירים מקושרים > קשר מכשיר > קישור באמצעות מספר הטלפון</p></div>` : pPhone ? '<p style="color:#0284c7;font-weight:bold;margin:10px 0">⏳ מבקש קוד מוואטסאפ...</p>' : ''}</div>` : '<div style="padding:15px 0"><span style="font-size:36px">🎉</span><h3 style="margin:5px 0">המערכת מחוברת ופועלת 24/7!</h3></div>'}</div><div class="c"><h4 style="text-align:right;margin:0 0 8px">יומן פעילות</h4><div class="l">${logs.map(x=>`<div>${x}</div>`).join('')||'ממתין...'}</div></div></body></html>`);
});

app.post('/pair', (req, res) => {
  let ph = (req.body.phone || '').replace(/\D/g, '');
  if (ph.startsWith('05')) ph = '972' + ph.substring(1);
  pPhone = req.body.phone;
  pCode = null;
  log(`מבקש קוד עבור ${ph}...`);
  res.redirect('/');
  setTimeout(async () => {
    try {
      if (client && client.requestPairingCode) {
        pCode = await client.requestPairingCode(ph);
        log(`✅ קוד קישור: ${pCode}`);
      }
    } catch (e) {
      log(`שגיאה בקוד: ${e.message}`);
    }
  }, 100);
});

app.listen(CONFIG.port, '0.0.0.0', () => log(`שרת זמין בפורט ${CONFIG.port}`));

class Yemot {
  constructor() { this.token = ''; this.c = {}; }
  async getToken() {
    if (this.token) return this.token;
    try {
      const r = await axios.get(`${CONFIG.yemot.apiUrl}/Login`, { params: { username: CONFIG.yemot.username, password: CONFIG.yemot.password } });
      if (r.data?.token) return (this.token = r.data.token);
    } catch (e) {}
    return null;
  }
  getName(f) {
    if (!this.c[f]) this.c[f] = 1;
    const n = `${String(this.c[f]).padStart(3, '0')}.wav`;
    this.c[f] = (this.c[f] % CONFIG.yemot.maxFiles) + 1;
    return n;
  }
  async upload(local, dest) {
    const t = await this.getToken();
    if (!t || !fs.existsSync(local)) return false;
    const f = new FormData();
    f.append('token', t); f.append('path', dest);
    f.append('file', fs.createReadStream(local), { filename: path.basename(dest), contentType: 'audio/wav' });
    try {
      const r = await axios.post(`${CONFIG.yemot.apiUrl}/UploadFile`, f, { headers: f.getHeaders() });
      return r.data?.responseStatus === 'OK';
    } catch (e) { return false; }
  }
  async getRecs(p) {
    const t = await this.getToken();
    if (!t) return [];
    try {
      const r = await axios.get(`${CONFIG.yemot.apiUrl}/GetIVR2Dir`, { params: { token: t, path: `ivr2:${p}` } });
      const out = [];
      for (const f of (r.data?.files || [])) {
        if (f.name?.endsWith('.wav') && !f.name.startsWith('M0000')) {
          const dst = path.join(CONFIG.temp, `rc_${Date.now()}_${f.name}`);
          const w = fs.createWriteStream(dst);
          const dl = await axios({ method: 'get', url: `${CONFIG.yemot.apiUrl}/DownloadFile?token=${t}&path=ivr2:${p}/${f.name}`, responseType: 'stream' });
          await new Promise((res, rej) => { dl.data.pipe(w); w.on('finish', res); w.on('error', rej); });
          await axios.get(`${CONFIG.yemot.apiUrl}/DeleteFile`, { params: { token: t, path: `ivr2:${p}/${f.name}` } }).catch(() => {});
          out.push({ path: dst, name: f.name });
        }
      }
      return out;
    } catch (e) { return []; }
  }
}
const yemot = new Yemot();

function toWav(src, dst) {
  return new Promise((res, rej) => {
    ffmpeg(src).noVideo().toFormat('wav').audioCodec('pcm_s16le').audioChannels(1).audioFrequency(8000).on('error', rej).on('end', () => res(dst)).save(dst);
  });
}

function toMp3(src, dst) {
  return new Promise((res, rej) => {
    ffmpeg(src).toFormat('mp3').audioBitrate(64).audioChannels(1).on('error', rej).on('end', () => res(dst)).save(dst);
  });
}

async function ttsWav(txt, dst) {
  let c = (txt || '').replace(/https?:\/\/\S+/gi, ' קישור ').replace(/\n+/g, '. ').trim();
  if (c.length > 350) c = c.substring(0, 347) + '...';
  const u = googleTTS.getAudioUrl(c, { lang: 'he', slow: false, host: 'https://translate.google.com' });
  const tmp = path.join(CONFIG.temp, `t_${Date.now()}.mp3`);
  await new Promise((res, rej) => {
    const fl = fs.createWriteStream(tmp);
    https.get(u, r => { r.pipe(fl); fl.on('finish', () => fl.close(res)); }).on('error', rej);
  });
  await toWav(tmp, dst);
  try { fs.unlinkSync(tmp); } catch (e) {}
  return dst;
}

let groups = [];
let contacts = [];
const chatMap = new Map();

async function updateMenus() {
  try {
    log('מעדכן תפריטים בימות המשיח (שלוחה 1 קבוצות, שלוחה 2 אישי)...');
    const pR = path.join(CONFIG.temp, 'm_root.wav');
    await ttsWav('ברוכים הבאים. לשמיעת קבוצות הקישו 1. לשמיעת צ\'אטים אישיים הקישו 2. לשליחת הודעה למספר חדש הקישו 0.', pR);
    await yemot.upload(pR, 'ivr2:M0000.wav');
    try { fs.unlinkSync(pR); } catch (e) {}

    const p0 = path.join(CONFIG.temp, 'm_0.wav');
    await ttsWav('נא הקישו מספר טלפון לשליחת הודעה וסולמית. לאחר מכן השאירו הודעה.', p0);
    await yemot.upload(p0, 'ivr2:0/M0000.wav');
    try { fs.unlinkSync(p0); } catch (e) {}

    let gp = 'תפריט קבוצות. ';
    if (!groups.length) gp += 'אין קבוצות עדיין.';
    else groups.forEach(g => { gp += `לשמיעת ${g.name} הקישו ${g.id}. `; });
    const p1 = path.join(CONFIG.temp, 'm_1.wav');
    await ttsWav(gp, p1);
    await yemot.upload(p1, 'ivr2:1/M0000.wav');
    try { fs.unlinkSync(p1); } catch (e) {}

    for (const g of groups) {
      const ps = path.join(CONFIG.temp, `m_1_${g.id}.wav`);
      await ttsWav(`קבוצת ${g.name}`, ps);
      await yemot.upload(ps, `ivr2:1/${g.id}/M0000.wav`);
      try { fs.unlinkSync(ps); } catch (e) {}
    }

    let cp = 'תפריט צ\'אטים אישיים. ';
    if (!contacts.length) cp += 'אין צ\'אטים עדיין.';
    else contacts.forEach(c => { cp += `לשמיעת ${c.name} הקישו ${c.id}. `; });
    const p2 = path.join(CONFIG.temp, 'm_2.wav');
    await ttsWav(cp, p2);
    await yemot.upload(p2, 'ivr2:2/M0000.wav');
    try { fs.unlinkSync(p2); } catch (e) {}

    for (const c of contacts) {
      const ps = path.join(CONFIG.temp, `m_2_${c.id}.wav`);
      await ttsWav(`שיחה עם ${c.name}`, ps);
      await yemot.upload(ps, `ivr2:2/${c.id}/M0000.wav`);
      try { fs.unlinkSync(ps); } catch (e) {}
    }
    log('✅ תפריטים עודכנו בהצלחה!');
  } catch (e) {
    log(`שגיאה בתפריטים: ${e.message}`);
  }
}

updateMenus();

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
  }
});

client.on('ready', async () => {
  statusText = 'מחובר לוואטסאפ ומאזין 24/7!';
  pCode = null;
  log('וואטסאפ אומת בהצלחה! ממיין צ\'אטים בא-ב...');
  try {
    const all = await client.getChats();
    const gL = [], cL = [];
    for (const ch of all) {
      const nm = ch.name || ch.id?.user || 'איש קשר';
      chatMap.set(nm, ch);
      if (ch.isGroup) gL.push(nm.trim());
      else cL.push(nm.trim());
    }
    gL.sort((a,b)=>a.localeCompare(b,'he'));
    cL.sort((a,b)=>a.localeCompare(b,'he'));
    groups = gL.slice(0,30).map((n,i)=>({name:n, id:(i+1).toString(), p:`1/${i+1}`, r:`1/${i+1}/9`}));
    contacts = cL.slice(0,30).map((n,i)=>({name:n, id:(i+1).toString(), p:`2/${i+1}`, r:`2/${i+1}/9`}));
    await updateMenus();
  } catch (e) {}
  startLoop();
});

client.on('message_create', async msg => {
  try {
    const ch = await msg.getChat();
    const nm = ch.name || ch.id?.user || 'איש קשר';
    chatMap.set(nm, ch);
    const isG = ch.isGroup;
    let entry = isG ? groups.find(x => nm.toLowerCase().includes(x.name.toLowerCase()))
                    : contacts.find(x => nm.toLowerCase().includes(x.name.toLowerCase()));

    if (!entry) {
      const list = isG ? groups : contacts;
      const nxt = (list.length + 1).toString();
      entry = { name: nm, id: nxt, p: `${isG ? '1' : '2'}/${nxt}`, r: `${isG ? '1' : '2'}/${nxt}/9` };
      list.push(entry);
    }

    const folder = entry.p;
    log(`הודעה מ-${isG ? 'קבוצה' : 'אישי'} "${nm}" -> שלוחה ${folder}`);
    const ts = Date.now();
    const wOut = path.join(CONFIG.temp, `i_${ts}.wav`);

    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'voice' || msg.type === 'video')) {
      const med = await msg.downloadMedia();
      if (!med?.data) return;
      const raw = path.join(CONFIG.temp, `r_${ts}.${msg.type === 'video' ? 'mp4' : 'ogg'}`);
      fs.writeFileSync(raw, Buffer.from(med.data, 'base64'));
      await toWav(raw, wOut);
      await yemot.upload(wOut, `ivr2:${folder}/${yemot.getName(folder)}`);
      try { fs.unlinkSync(raw); fs.unlinkSync(wOut); } catch (e) {}
      log(`🎉 שמע עלה לשלוחה ${folder}!`);
      return;
    }

    const txt = msg.body || msg.caption;
    if (txt?.trim()) {
      await ttsWav(`הודעה מאת ${nm}: ${txt}`, wOut);
      await yemot.upload(wOut, `ivr2:${folder}/${yemot.getName(folder)}`);
      try { fs.unlinkSync(wOut); } catch (e) {}
      log(`🎉 הודעה הוקראה ועלתה לשלוחה ${folder}!`);
    }
  } catch (e) {}
});

function startLoop() {
  setInterval(async () => {
    try {
      const r0 = await yemot.getRecs('0');
      for (const it of r0) {
        const m = it.name.match(/(\d{9,12})/);
        if (m) {
          let num = m[1];
          if (num.startsWith('05')) num = '972' + num.substring(1);
          const mp = path.join(CONFIG.temp, `s_${Date.now()}.mp3`);
          await toMp3(it.path, mp);
          await client.sendMessage(`${num}@c.us`, MessageMedia.fromFilePath(mp), { sendAudioAsVoice: true });
          log(`הקלטה נשלחה למספר ${num}`);
          try { fs.unlinkSync(it.path); fs.unlinkSync(mp); } catch (e) {}
        }
      }
    } catch (e) {}

    for (const g of groups) {
      try {
        const rc = await yemot.getRecs(g.r);
        for (const it of rc) {
          const ch = chatMap.get(g.name);
          if (ch && !ch.isReadOnly) {
            const mp = path.join(CONFIG.temp, `s_${Date.now()}.mp3`);
            await toMp3(it.path, mp);
            await ch.sendMessage(MessageMedia.fromFilePath(mp), { sendAudioAsVoice: true });
            log(`תגובה נשלחה לקבוצה "${g.name}"`);
            try { fs.unlinkSync(it.path); fs.unlinkSync(mp); } catch (e) {}
          }
        }
      } catch (e) {}
    }

    for (const c of contacts) {
      try {
        const rc = await yemot.getRecs(c.r);
        for (const it of rc) {
          const ch = chatMap.get(c.name);
          if (ch) {
            const mp = path.join(CONFIG.temp, `s_${Date.now()}.mp3`);
            await toMp3(it.path, mp);
            await ch.sendMessage(MessageMedia.fromFilePath(mp), { sendAudioAsVoice: true });
            log(`תגובה נשלחה לצ'אט "${c.name}"`);
            try { fs.unlinkSync(it.path); fs.unlinkSync(mp); } catch (e) {}
          }
        }
      } catch (e) {}
    }
  }, CONFIG.yemot.pollIntervalSeconds * 1000);
}

try { client.initialize(); } catch (e) {}
// סוף הקובץ - END OF FILE
