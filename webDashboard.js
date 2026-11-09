const express = require('express');
const QRCode = require('qrcode');

class WebDashboard {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.status = 'מתאתחל...';
    this.qrImage = null;
    this.logs = [];

    this.setupRoutes();
  }

  addLog(message) {
    const time = new Date().toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' });
    this.logs.unshift({ time, message });
    if (this.logs.length > 50) this.logs.pop();
  }

  setQr(qrString) {
    this.status = 'ממתין לסריקת קוד או אימות';
    QRCode.toDataURL(qrString, (err, url) => {
      if (!err) this.qrImage = url;
    });
    this.addLog('קוד QR חדש נוצר וממתין לסריקה מהטלפון.');
  }

  setConnected() {
    this.status = 'מחובר לוואטסאפ ומאזין 24/7!';
    this.qrImage = null;
    this.addLog('וואטסאפ אומת בהצלחה! המערכת מעבירה עדכונים לקו.');
  }

  setupRoutes() {
    this.app.get('/', (req, res) => {
      const isConnected = this.status.includes('מחובר');
      const html = `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ניהול קו קולי - וואטסאפ</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f2f5; margin: 0; padding: 15px; color: #111; }
    .card { background: white; border-radius: 16px; padding: 20px; max-width: 480px; margin: 0 auto 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 20px; margin-bottom: 8px; color: #128C7E; }
    .status-badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 14px; margin: 10px 0; }
    .status-connected { background: #e8f5e9; color: #2e7d32; }
    .status-waiting { background: #fff8e1; color: #f57f17; }
    .qr-box { margin: 20px 0; }
    .qr-box img { max-width: 250px; border-radius: 12px; border: 2px solid #ddd; }
    .instructions { text-align: right; font-size: 14px; line-height: 1.6; background: #fafafa; padding: 14px; border-radius: 10px; margin-top: 15px; }
    .logs-box { text-align: right; font-size: 13px; max-height: 250px; overflow-y: auto; background: #263238; color: #eceff1; padding: 12px; border-radius: 10px; font-family: monospace; }
    .log-item { margin-bottom: 6px; border-bottom: 1px solid #37474f; padding-bottom: 4px; }
    .time { color: #80cbc4; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📞 גשר וואטסאפ לקו קולי</h1>
    <p style="color: #666; font-size: 14px;">מערכת אוטומטית בענן (הפרגוד וחדשות)</p>
    
    <div class="status-badge ${isConnected ? 'status-connected' : 'status-waiting'}">
      ● ${this.status}
    </div>

    ${!isConnected && this.qrImage ? `
      <div class="qr-box">
        <p style="font-weight: 500;">סרוק את הקוד הבא לחיבור:</p>
        <img src="${this.qrImage}" alt="WhatsApp QR">
      </div>
      <div class="instructions">
        <b>איך מחברים מהטלפון:</b>
        <ol style="margin: 6px 0; padding-right: 20px;">
          <li>פתחו את הוואטסאפ בטלפון.</li>
          <li>היכנסו ל<b>הגדרות</b> (או 3 נקודות למעלה) > <b>מכשירים מקושרים</b>.</li>
          <li>לחצו על <b>קשר מכשיר</b> וסרקו את הקוד שלמעלה (או צלמו מסך ממכשיר נוסף).</li>
        </ol>
      </div>
    ` : ''}

    ${isConnected ? `
      <div style="padding: 20px 0;">
        <span style="font-size: 40px;">🎉</span>
        <h3 style="margin: 10px 0 5px;">המערכת פועלת ברקע!</h3>
        <p style="font-size: 14px; color: #555;">כל עדכון, הקלטה או סרטון מקבוצת הפרגוד וקבוצות החדשות מועלים ישירות לקו הטלפוני.</p>
      </div>
    ` : ''}
  </div>

  <div class="card">
    <h3 style="margin-top: 0; font-size: 16px; text-align: right;">📋 יומן פעילות אחרון</h3>
    <div class="logs-box">
      ${this.logs.length === 0 ? '<div>ממתין לפעולות...</div>' : this.logs.map(l => `
        <div class="log-item"><span class="time">[${l.time}]</span> ${l.message}</div>
      `).join('')}
    </div>
  </div>
</body>
</html>
      `;
      res.send(html);
    });

    this.app.listen(this.port, () => {
      console.log(`🌐 לוח הבקרה זמין בכתובת: http://localhost:${this.port}`);
    });
  }
}

module.exports = new WebDashboard();
