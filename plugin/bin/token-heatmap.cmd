@echo off
rem token-heatmap: runs the bundled command line, dist\cli.mjs, with the node on PATH.
rem
rem   token-heatmap COMMAND [OPTIONS]
rem
rem bin/token-heatmap does the same on macOS and Linux.
setlocal

set "fix=Install Node.js 20 or later from https://nodejs.org, make sure node is on the PATH that Claude Code starts with, then try again."

where node >nul 2>nul
if errorlevel 1 (
  >&2 echo token-heatmap: node was not found on PATH. %fix%
  exit /b 127
)

rem "v24.22.3" gives 24. A version this cannot read lets node try.
set "major="
for /f "tokens=1 delims=v." %%m in ('node --version 2^>nul') do set "major=%%m"
if not defined major set "major=20"
if %major% LSS 20 (
  >&2 echo token-heatmap: the node on PATH is version %major%, and token-heatmap needs 20 or later. %fix%
  exit /b 1
)

node "%~dp0..\dist\cli.mjs" %*
exit /b %errorlevel%
