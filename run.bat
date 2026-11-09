@echo off
chcp 65001 > nul
title מערכת וואטסאפ לקו קולי

echo ========================================================
echo   מערכת אוטומציה: וואטסאפ לקו קולי (IVR)
echo ========================================================
echo.

IF NOT EXIST "node_modules" (
    echo מתקין רכיבים נדרשים בפעם הראשונה... אנא המתן...
    npm install
)

IF NOT EXIST ".env" (
    echo יוצר קובץ הגדרות ראשוני .env...
    copy .env.example .env
)

echo.
echo מפעיל את המערכת...
node src/index.js
pause
