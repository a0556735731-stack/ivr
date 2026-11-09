const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const yemotClient = require('./yemotClient');
const groupsManager = require('./groupsManager');
const webDashboard = require('./webDashboard');
const { textToSpeech } = require('./ttsService');
const { convertToIvrAudio, convertIvrToWhatsAppAudio } = require('./audioConverter');

if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir, { recursive: true });
}

console.log('================================================================');
console.log('📞 גשר וואטסאפ לקו קולי (עם שלוחה 0 לשליחה ישירה למספר חדש)');
console.log('================================================================');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

const activeGroupChats = new Map();

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  webDashboard.setQr(qr);
});

client.on('ready', async () => {
  console.log('🚀 המערכת מחוברת לוואטסאפ!');
  webDashboard.setConnected();

  const allChats = await client.getChats();
  const sortedMap = await groupsManager.syncAndSortAlphabetically(allChats);

  for (const group of sortedMap) {
    const chat = allChats.find(c => c.isGroup && c.name.toLowerCase().includes(group.name.toLowerCase()));
    if (chat) activeGroupChats.set(group.name, chat);
  }

  await groupsManager.setupVoicePrompts();
  startPhoneRecordingListener();
});

async function canSendToGroup(chat) {
  if (chat.isReadOnly) return false;
  if (chat.groupMetadata && chat.groupMetadata.announce) {
    const myId = client.info?.wid?._serialized;
    const me = chat.groupMetadata.participants.find(p => p.id._serialized === myId);
    if (!me || (!me.isAdmin && !me.isSuperAdmin)) return false;
  }
  return true;
}

/**
 * מנרמל מספר טלפון ישראלי לפורמט וואטסאפ בינלאומי (למשל: 0521234567 -> 972521234567@c.us)
 */
function normalizePhoneNumber(rawNumber) {
  if (!rawNumber) return null;
  let cleaned = rawNumber.replace(/\D/g, '');
  if (cleaned.startsWith('05')) {
    cleaned = '972' + cleaned.substring(1);
  } else if (cleaned.startsWith('5')) {
    cleaned = '972' + cleaned;
  }
  if (cleaned.length >= 11 && cleaned.startsWith('972')) {
    return `${cleaned}@c.us`;
  }
  return null;
}

async function processIncomingWhatsAppMessage(msg) {
  try {
    const chat = await msg.getChat();
    if (!chat.isGroup) return;

    const groupConfig = groupsManager.getGroupConfig(chat.name);
    if (!groupConfig) return;

    activeGroupChats.set(groupConfig.name, chat);

    const timestamp = Date.now();
    const targetExtension = groupConfig.extension;
    const isReplyAllowed = await canSendToGroup(chat);
    const statusText = isReplyAllowed ? 'פתוחה לתגובות' : 'סגורה (השתקה)';

    webDashboard.addLog(`הודעה מקבוצת "${chat.name}" [שלוחה ${targetExtension} לפי א-ב | ${statusText}]`);

    // 1. שמע, הודעה קולית או סרטון וידאו (חילוץ שמע)
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'voice' || msg.type === 'video')) {
      const isVideo = msg.type === 'video';
      webDashboard.addLog(isVideo ? `מחלץ פס-קול מסרטון מקבוצת "${chat.name}"...` : `מעבד הודעה קולית לשלוחה ${targetExtension}...`);

      const media = await msg.downloadMedia();
      if (!media || !media.data) return;

      const inputExt = isVideo ? 'mp4' : (media.mimetype.includes('ogg') ? 'ogg' : 'mp3');
      const rawInputPath = path.join(config.tempDir, `raw_${timestamp}.${inputExt}`);
      const ivrAudioPath = path.join(config.tempDir, `ivr_${timestamp}.wav`);

      fs.writeFileSync(rawInputPath, Buffer.from(media.data, 'base64'));
      await convertToIvrAudio(rawInputPath, ivrAudioPath);
      await yemotClient.uploadAudioToExtension(ivrAudioPath, targetExtension);

      webDashboard.addLog(`השמע עלה בהצלחה לשלוחה ${targetExtension} (${groupConfig.name})!`);

      try {
        fs.unlinkSync(rawInputPath);
        fs.unlinkSync(ivrAudioPath);
      } catch (e) {}
      return;
    }

    // 2. הודעת טקסט או כיתוב תמונה
    let messageText = msg.body || msg.caption;
    if (messageText && messageText.trim().length > 0) {
      webDashboard.addLog(`הקראת טקסט מקבוצת "${chat.name}": "${messageText.substring(0, 30)}..."`);

      const ttsMp3Path = path.join(config.tempDir, `tts_${timestamp}.mp3`);
      const ivrAudioPath = path.join(config.tempDir, `ivr_${timestamp}.wav`);

      await textToSpeech(messageText, chat.name, ttsMp3Path);
      await convertToIvrAudio(ttsMp3Path, ivrAudioPath);
      await yemotClient.uploadAudioToExtension(ivrAudioPath, targetExtension);

      webDashboard.addLog(`הודעה הוקראה ועלתה לשלוחה ${targetExtension} (${groupConfig.name})!`);

      try {
        fs.unlinkSync(ttsMp3Path);
        fs.unlinkSync(ivrAudioPath);
      } catch (e) {}
    }
  } catch (error) {
    webDashboard.addLog(`שגיאה: ${error.message}`);
  }
}

function startPhoneRecordingListener() {
  const intervalMs = (config.yemot.pollIntervalSeconds || 15) * 1000;

  setInterval(async () => {
    // -------------------------------------------------------------
    // א. טיפול בשלוחה 0: שליחת הודעה קולית למספר וואטסאפ חדש לפי הקשות
    // -------------------------------------------------------------
    if (config.directSend && config.directSend.enabled) {
      try {
        const directRecordings = await yemotClient.checkAndDownloadNewRecordings(config.directSend.recordingExtension);
        for (const item of directRecordings) {
          // חילוץ מספר הטלפון משם הקובץ (למשל: 0521234567.wav או 0521234567_001.wav)
          const numberMatch = item.fileName.match(/(\d{9,12})/);
          if (numberMatch) {
            const rawDigits = numberMatch[1];
            const targetJid = normalizePhoneNumber(rawDigits);

            if (targetJid) {
              webDashboard.addLog(`📞 מזהה הקלטה למספר חדש: ${rawDigits}. ממיר ושולח לוואטסאפ...`);
              const convertedMp3 = path.join(config.tempDir, `direct_${Date.now()}.mp3`);
              await convertIvrToWhatsAppAudio(item.localPath, convertedMp3);

              const media = MessageMedia.fromFilePath(convertedMp3);
              await client.sendMessage(targetJid, media, { sendAudioAsVoice: true });
              webDashboard.addLog(`✅ ההודעה הקולית נשלחה בהצלחה למספר ${rawDigits}!`);

              try {
                fs.unlinkSync(item.localPath);
                fs.unlinkSync(convertedMp3);
              } catch (e) {}
            }
          }
        }
      } catch (err) {}
    }

    // -------------------------------------------------------------
    // ב. טיפול בשלוחות הקבוצות: שליחת הקלטות חזרה לקבוצה המקורית
    // -------------------------------------------------------------
    const allGroups = groupsManager.getAllGroups();
    for (const group of allGroups) {
      if (!group.recordingExtension) continue;

      try {
        const newRecordings = await yemotClient.checkAndDownloadNewRecordings(group.recordingExtension);

        for (const item of newRecordings) {
          let chat = activeGroupChats.get(group.name);
          if (!chat) {
            const allChats = await client.getChats();
            chat = allChats.find(c => c.isGroup && c.name.toLowerCase().includes(group.name.toLowerCase()));
            if (chat) activeGroupChats.set(group.name, chat);
          }

          if (!chat) continue;

          const isAllowed = await canSendToGroup(chat);
          if (!isAllowed) {
            webDashboard.addLog(`קבוצת "${chat.name}" סגורה להודעות. ההקלטה לא נשלחה.`);
            try { fs.unlinkSync(item.localPath); } catch (e) {}
            continue;
          }

          webDashboard.addLog(`שולח הקלטה קולית מהטלפון לקבוצת "${chat.name}"...`);
          const convertedMp3 = path.join(config.tempDir, `send_${Date.now()}.mp3`);
          await convertIvrToWhatsAppAudio(item.localPath, convertedMp3);

          const media = MessageMedia.fromFilePath(convertedMp3);
          await chat.sendMessage(media, { sendAudioAsVoice: true });

          webDashboard.addLog(`✅ ההקלטה נשלחה בהצלחה לקבוצה "${chat.name}"!`);

          try {
            fs.unlinkSync(item.localPath);
            fs.unlinkSync(convertedMp3);
          } catch (e) {}
        }
      } catch (err) {}
    }
  }, intervalMs);
}

client.on('message', async (msg) => {
  await processIncomingWhatsAppMessage(msg);
});

client.initialize();
