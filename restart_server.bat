@echo off
set PYTHON_PATH=C:\Users\linhu\.workbuddy\binaries\python\versions\3.13.12\python.exe
set APP_DIR=C:\Users\linhu\WorkBuddy\20260424010651
set LOG_FILE=%APP_DIR%\server.log
set PID_FILE=%APP_DIR%\server.pid

echo Stopping old server on port 8765...
taskkill /F /FI "WINDOWTITLE eq futu_server" 2>nul

echo Starting futu server...
start "futu_server" /B "%PYTHON_PATH%" -c "import uvicorn,sys;sys.path.insert(0,r'%APP_DIR%');from app import app;uvicorn.run(app,host='0.0.0.0',port=8765)" > "%LOG_FILE%" 2>&1
echo Server started. PID logged in server.log
