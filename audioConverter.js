const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

/**
 * ממיר קובץ שמע או מחלץ אודיו מסרטון וידאו לפורמט טלפוני תקני (WAV 8kHz מונו)
 * 
 * @param {string} inputPath נתיב קובץ המקור (קובץ שמע או קובץ וידאו mp4/mov)
 * @param {string} outputPath נתיב לקובץ ה-WAV המומר
 * @returns {Promise<string>}
 */
function convertToIvrAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    ffmpeg(inputPath)
      .noVideo()                 // התעלמות מערוץ הוידאו - חילוץ שמע בלבד
      .toFormat('wav')
      .audioCodec('pcm_s16le')
      .audioChannels(1)          // מונו
      .audioFrequency(8000)       // 8kHz תואם טלפוניה
      .on('error', (err) => {
        console.error('שגיאה בחילוץ/המרת האודיו:', err.message);
        reject(err);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

/**
 * ממיר קובץ שמע מהקו הטלפוני (WAV) לפורמט קולי המותאם לשליחה לוואטסאפ (OGG/Opus או MP3)
 */
function convertIvrToWhatsAppAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioBitrate(64)
      .audioChannels(1)
      .on('error', (err) => {
        console.error('שגיאה בהמרת הקלטה טלפונית לוואטסאפ:', err.message);
        reject(err);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

module.exports = {
  convertToIvrAudio,
  convertIvrToWhatsAppAudio
};
