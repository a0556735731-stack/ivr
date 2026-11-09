const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class YemotClient {
  constructor() {
    this.apiUrl = config.yemot.apiUrl;
    this.username = config.yemot.username;
    this.password = config.yemot.password;
    this.token = config.yemot.token;
    this.extensionCounters = {};
  }

  async login() {
    if (this.token) return this.token;
    if (!this.username || !this.password) return null;

    try {
      const response = await axios.get(`${this.apiUrl}/Login`, {
        params: { username: this.username, password: this.password },
      });

      if (response.data && response.data.token) {
        this.token = response.data.token;
        return this.token;
      }
    } catch (error) {
      console.error('❌ נכשלה התחברות לימות המשיח:', error.message);
    }
    return null;
  }

  getNextFileNameForExtension(ext) {
    if (!this.extensionCounters[ext]) {
      this.extensionCounters[ext] = 1;
    }

    const index = this.extensionCounters[ext];
    const fileName = `${String(index).padStart(3, '0')}.wav`;

    this.extensionCounters[ext] += 1;
    if (this.extensionCounters[ext] > (config.yemot.maxFilesPerGroup || 30)) {
      this.extensionCounters[ext] = 1;
    }

    return fileName;
  }

  async uploadAudioToExtension(localFilePath, targetExtension) {
    const fileName = this.getNextFileNameForExtension(targetExtension);
    const destinationPath = `ivr2:${targetExtension}/${fileName}`;
    return this.uploadCustomFile(localFilePath, destinationPath);
  }

  /**
   * העלאת קובץ ייעודי לנתיב מותאם אישית (למשל ivr2:M0000.wav להודעת תפריט)
   */
  async uploadCustomFile(localFilePath, destinationPath) {
    if (!fs.existsSync(localFilePath)) return { success: false };

    if (!this.username && !this.token) {
      console.log(`[מצב סימולציה] העלאה לנתיב ${destinationPath}`);
      return { success: true, mode: 'simulation' };
    }

    const token = await this.login();
    const form = new FormData();
    form.append('token', token);
    form.append('path', destinationPath);
    form.append('file', fs.createReadStream(localFilePath), {
      filename: path.basename(destinationPath),
      contentType: 'audio/wav',
    });

    try {
      const response = await axios.post(`${this.apiUrl}/UploadFile`, form, {
        headers: { ...form.getHeaders() },
      });
      return { success: true, response: response.data };
    } catch (error) {
      console.error(`שגיאה בהעלאה ל-${destinationPath}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async checkAndDownloadNewRecordings(recordingExtension) {
    if (!this.username && !this.token) return [];

    try {
      const token = await this.login();
      const dirResponse = await axios.get(`${this.apiUrl}/GetIVR2Dir`, {
        params: { token, path: `ivr2:${recordingExtension}` },
      });

      const files = dirResponse.data?.files || [];
      const newRecordings = [];

      for (const file of files) {
        if (file.name && file.name.endsWith('.wav') && !file.name.startsWith('M0000')) {
          const downloadUrl = `${this.apiUrl}/DownloadFile?token=${token}&path=ivr2:${recordingExtension}/${file.name}`;
          const localDest = path.join(config.tempDir, `incoming_phone_${Date.now()}_${file.name}`);
          
          const writer = fs.createWriteStream(localDest);
          const downloadResponse = await axios({ method: 'get', url: downloadUrl, responseType: 'stream' });

          await new Promise((resolve, reject) => {
            downloadResponse.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
          });

          await axios.get(`${this.apiUrl}/DeleteFile`, {
            params: { token, path: `ivr2:${recordingExtension}/${file.name}` },
          }).catch(() => {});

          newRecordings.push({ localPath: localDest, fileName: file.name });
        }
      }

      return newRecordings;
    } catch (err) {
      return [];
    }
  }
}

module.exports = new YemotClient();
