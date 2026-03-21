@echo off
cd /d "%~dp0"
title Zillow Scraper API
echo Starting on http://localhost:3000 (or PORT from .env^)
echo Close this window to stop the API.
npm start
pause
