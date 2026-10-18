@echo off
chcp 65001 > nul
rem 온재 숙소 관리 - 내 컴퓨터 수집 프로그램. 이 파일을 더블클릭하면 됩니다.
cd /d "%~dp0"
title 온재 숙소 관리 - 예약 가져오기

where node > nul 2> nul
if errorlevel 1 (
  echo Node.js 가 설치되어 있지 않아요.
  echo 열리는 페이지에서 LTS 버전을 받아 설치한 뒤, 이 파일을 다시 더블클릭해 주세요.
  start https://nodejs.org/ko
  pause
  exit /b 1
)

if not exist node_modules\.package-lock.json (
  echo 처음 실행이라 필요한 파일을 설치해요. 몇 분 걸릴 수 있어요...
  set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.
    pause
    exit /b 1
  )
)

call npx tsx collector/local.ts %*
echo.
pause
