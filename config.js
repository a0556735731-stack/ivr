require('dotenv').config();

module.exports = {
  // שלוחה ייעודית לשליחת הודעה קולית ישירה למספר טלפון חדש (מקש 0)
  directSend: {
    enabled: true,
    extension: '0',               // מקש 0 בתפריט הראשי
    recordingExtension: '0',     // שלוחת הקלטת ההודעה והזנת המספר
  },

  // מיפוי קבוצות וואטסאפ לשלוחות בקו הטלפון (נשמר וממוין בא'-ב')
  groupExtensions: [
    {
      name: 'הפרגוד',
      extension: '1',
      recordingExtension: '1/9',
    },
    {
      name: 'חדשות',
      extension: '2',
      recordingExtension: '2/9',
    },
    {
      name: 'נייעס',
      extension: '3',
      recordingExtension: '3/9',
    }
  ],

  // הגדרות מערכת ימות המשיח המוגדרות עבור הקו שלך
  yemot: {
    apiUrl: process.env.YEMOT_API_URL || 'https://www.call2all.co.il/ym/api',
    username: process.env.YEMOT_USERNAME || '0772290423',
    password: process.env.YEMOT_PASSWORD || '217056',
    token: process.env.YEMOT_TOKEN || '',
    maxFilesPerGroup: 30,
    pollIntervalSeconds: 15,
  },

  tts: {
    language: 'he',
    addPrefix: true,
  },

  tempDir: './temp_audio'
};
