@echo off
rem Serve this checkout locally: http://localhost:8020/
rem Needed for EXPORT and SHARE in the editor and "Try the example" in the map
rem editor; everything else works by double-clicking the .html files.
rem Port 8020 so PuzzleScript and PuzzleScript Plus can run at the same time.
rem Uses Node if present (the map editor's own zero-dependency server), else
rem Python. See runserver.sh for the same thing on macOS and Linux.
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8020
where node >nul 2>nul
if %errorlevel%==0 (
    node puzzlescript-map-editor\src\serve.js --root .
) else (
    echo Serving http://localhost:%PORT%/ ^(python^)
    python -m http.server %PORT%
)
