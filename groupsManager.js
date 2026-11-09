const fs = require('fs');
const path = require('path');
const config = require('./config');
const { textToSpeech } = require('./ttsService');
const { convertToIvrAudio } = require('./audioConverter');
const yemotClient = require('./yemotClient');

const MAP_FILE_PATH = path.join(__dirname, '../groups_map.json');

class GroupsManager {
  constructor() {
    this.map = this.loadMap();
  }

  loadMap() {
    if (fs.existsSync(MAP_FILE_PATH)) {
      try {
        return JSON.parse(fs.readFileSync(MAP_FILE_PATH, 'utf8'));
      } catch (e) {}
    }
    return [];
  }

  saveMap(data) {
    fs.writeFileSync(MAP_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    this.map = data;
  }

  async syncAndSortAlphabetically(allChats) {
    const matchedGroups = [];

    for (const chat of allChats) {
      if (!chat.isGroup) continue;

      const isTarget = config.targetGroups.some(target => 
        chat.name.toLowerCase().includes(target.toLowerCase())
      );

      if (isTarget) {
        matchedGroups.push(chat.name.trim());
      }
    }

    if (matchedGroups.length === 0) {
      const defaultGroups = ['הפרגוד', 'חדשות', 'נייעס'];
      defaultGroups.sort((a, b) => a.localeCompare(b, 'he'));
      
      const defaultMap = defaultGroups.map((name, index) => ({
        name,
        extension: (index + 1).toString(),
        recordingExtension: `${index + 1}/9`
      }));
      this.saveMap(defaultMap);
      return defaultMap;
    }

    matchedGroups.sort((a, b) => a.localeCompare(b, 'he'));

    const newMap = matchedGroups.map((name, index) => ({
      name,
      extension: (index + 1).toString(),
      recordingExtension: `${index + 1}/9`
    }));

    this.saveMap(newMap);
    console.log('\n📋 סדר השלוחות נקבע לפי סדר הא'-ב':');
    newMap.forEach(g => {
      console.log(` 🔹 שלוחה ${g.extension}: ${g.name}`);
    });

    return newMap;
  }

  getGroupConfig(chatName) {
    return this.map.find(item => 
      chatName.toLowerCase().includes(item.name.toLowerCase()) || 
      item.name.toLowerCase().includes(chatName.toLowerCase())
    );
  }

  getAllGroups() {
    return this.map;
  }

  async setupVoicePrompts() {
    try {
      console.log('🎙️ מייצר הקראות קוליות לתפריט לפי סדר הא'-ב'...');

      // 1. כותרת פנימית לכל שלוחת קבוצה
      for (const group of this.map) {
        const titleText = `קבוצת ${group.name}`;
        const titleMp3 = path.join(config.tempDir, `title_${group.extension}.mp3`);
        const titleWav = path.join(config.tempDir, `M0000_${group.extension}.wav`);

        await textToSpeech(titleText, '', titleMp3);
        await convertToIvrAudio(titleMp3, titleWav);
        await yemotClient.uploadCustomFile(titleWav, `ivr2:${group.extension}/M0000.wav`);

        try {
          fs.unlinkSync(titleMp3);
          fs.unlinkSync(titleWav);
        } catch (e) {}
      }

      // 2. שלוחה 0: שליחת הודעה למספר וואטסאפ חדש לפי הקשת מספר
      if (config.directSend && config.directSend.enabled) {
        const directExt = config.directSend.extension;
        const promptText = 'נא הקישו את מספר הטלפון לשליחת הודעה, ובסיום הקישו סולמית. לאחר מכן השאירו את הודעתכם.';
        const directMp3 = path.join(config.tempDir, 'prompt_direct.mp3');
        const directWav = path.join(config.tempDir, `M0000_ext${directExt}.wav`);

        await textToSpeech(promptText, '', directMp3);
        await convertToIvrAudio(directMp3, directWav);
        await yemotClient.uploadCustomFile(directWav, `ivr2:${directExt}/M0000.wav`);

        // הגדרת שלוחה 0 בימות המשיח לקבלת הקשות מספר והקלטה
        const extIniContent = Buffer.from(
          'type=record\n' +
          'record_name=digits\n' +
          'record_folder_digits=yes\n' +
          'record_end_goto=/\n', 
          'utf8'
        );
        const tempIniPath = path.join(config.tempDir, 'ext.ini');
        fs.writeFileSync(tempIniPath, extIniContent);
        await yemotClient.uploadCustomFile(tempIniPath, `ivr2:${directExt}/ext.ini`);

        try {
          fs.unlinkSync(directMp3);
          fs.unlinkSync(directWav);
          fs.unlinkSync(tempIniPath);
        } catch (e) {}
      }

      // 3. תפריט ראשי מוקלט לפי הא'-ב' + אופציה 0
      let menuText = 'ברוכים הבאים לקו העדכונים. ';
      menuText += 'לשליחת הודעה קולית למספר וואטסאפ חדש, הקישו 0. ';

      this.map.forEach(g => {
        menuText += `לשמיעת עדכוני ${g.name}, הקישו ${g.extension}. `;
      });

      const menuMp3 = path.join(config.tempDir, 'main_menu.mp3');
      const menuWav = path.join(config.tempDir, 'M0000_root.wav');

      await textToSpeech(menuText, '', menuMp3);
      await convertToIvrAudio(menuMp3, menuWav);
      await yemotClient.uploadCustomFile(menuWav, 'ivr2:M0000.wav');

      try {
        fs.unlinkSync(menuMp3);
        fs.unlinkSync(menuWav);
      } catch (e) {}

      console.log('✅ כל הכרזות התפריט, שלוחה 0 והשלוחות הועלו בהצלחה לקו!');
    } catch (err) {
      console.warn('הערה לגבי העלאת הודעות פתיחה:', err.message);
    }
  }
}

module.exports = new GroupsManager();
