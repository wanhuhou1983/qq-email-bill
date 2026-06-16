@echo off
cd /d C:\services\bill-web\bank-loader
echo ====== bocom ======
node loader.js bocom 2>&1
echo ====== ccb ======
node loader.js ccb 2>&1
echo ====== ceb ======
node loader.js ceb 2>&1
echo ====== cgb ======
node loader.js cgb 2>&1
echo ====== citic ======
node loader.js citic 2>&1
echo ====== cmbc ======
node loader.js cmbc 2>&1
echo ====== icbc ======
node loader.js icbc 2>&1
echo ====== pab ======
node loader.js pab 2>&1
echo ALL DONE
