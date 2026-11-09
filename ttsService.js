const googleTTS = require('google-tts-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config');

/**
 * מנקה טקסט מהודעת וואטסאפ לצורך הקראה נעימה וטבעית בקו הקולי
 */
function cleanTextForSpeech(rawText) {
  if (!rawText) return '';

  let text = rawText
    // הסרת קישורי אינטרנט
    .replace(/https?:\/\/\S+/gi, ' קישור ')
    // הסרת אימוג'ים ותווים מיוחדים שאינם נקראים טוב
    .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
    // החלפת רווחים כפולים וירידות שורה מרובות
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * מוריד קובץ שמע מכתובת URL ושומר אותו בדיסק
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`נכשל בהורדת קובץ דיבור: קוד סטטוס ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * ממיר טקסט לקובץ שמע (MP3) בעברית
 * 
 * @param {string} text הטקסט להקראה
 * @param {string} groupName שם הקבוצה ממנה הגיעה ההודעה
 * @param {string} outputFile נתיב קובץ היעד (MP3)
 * @returns {Promise<string>}
 */
async function textToSpeech(text, groupName, outputFile) {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) {
    throw new Error('הטקסט ריק לאחר ניקוי');
  }

  // הוספת הכרזה מקדימה לפי הגדרות
  let fullText = cleaned;
  if (config.tts.addPrefix && groupName) {
    const prefix = config.tts.prefixTemplate.replace('{group}', groupName);
    fullText = `${prefix}${cleaned}`;
  }

  // הגבלת אורך טקסט עבור בקשת TTS יחידה (עד 200 תווים למקטע בסיסי של גוגל TTS)
  // במידה והטקסט ארוך, מקצרים או משתמשים ב-getAllAudioBase64
  let textToRead = fullText;
  if (textToRead.length > 500) {
    textToRead = textToRead.substring(0, 497) + '...';
  }

  // קבלת URL לקובץ השמע מגוגל TTS
  const url = googleTTS.getAudioUrl(textToRead, {
    lang: config.tts.language || 'he',
    slow: false,
    host: 'https://translate.google.com',
    timeout: 10000,
  });

  // וידוא קיום תיקיית היעד
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await downloadFile(url, outputFile);
  return outputFile;
}

module.exports = {
  textToSpeech,
  cleanTextForSpeech
};
