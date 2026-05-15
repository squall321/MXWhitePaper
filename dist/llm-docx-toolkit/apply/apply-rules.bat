@echo off
REM ============================================================================
REM  apply-rules.bat — double-click entry point for Windows users.
REM
REM  Workflow:
REM    1. Open every .docx (and optionally .html) under targets/ via Word COM.
REM       The COM round-trip strips most DRM / IRM-by-policy in the process
REM       (Word writes back a plain .docx during Save).
REM    2. Apply the MXWhitePaper input rules:
REM       - Title set from the filename
REM       - Section headings inferred from dotted numbering (1., 1.1, ...)
REM       - Widget marker paragraphs (Widget: <type>) flipped to hidden text
REM       - Table header rows un-bolded and **markdown bold** wrappers stripped
REM       - Floating pictures converted to inline shapes
REM    3. Run mxwp-validator on each saved .docx to verify schema compliance.
REM    4. Write a CSV report alongside the inputs.
REM
REM  Usage:
REM    Double-click this file. The script processes everything under targets/.
REM    To target a different folder, drag-drop it onto this file (the path is
REM    received as %~1).
REM
REM  Requirements:
REM    - Microsoft Word installed (any reasonably recent version).
REM    - PowerShell 5.1+ (ships with Windows 10/11).
REM
REM  Notes:
REM    - Files inside Examples\docx\ or Examples\CAE\ are skipped by default
REM      (legacy org convention). See apply-rules.ps1 for the matcher.
REM    - The validator binary (mxwp-validator-win32.exe) must sit at
REM      ..\bin\ relative to this script. CI builds package it that way.
REM ============================================================================

setlocal

set "SCRIPT_DIR=%~dp0"
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=%SCRIPT_DIR%targets"

echo.
echo MXWhitePaper — applying input rules
echo   target folder : %TARGET%
echo   script        : %SCRIPT_DIR%apply-rules.ps1
echo.

REM -NoProfile : skip user $PROFILE (faster, predictable)
REM -ExecutionPolicy Bypass : signed-policy environments can still run this script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%apply-rules.ps1" -Root "%TARGET%"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
    echo Done. Exit code: %RC%
) else (
    echo FINISHED with errors. Exit code: %RC%
    echo Check the CSV report under %TARGET% for per-file status.
)
echo.
pause
endlocal
exit /b %RC%
