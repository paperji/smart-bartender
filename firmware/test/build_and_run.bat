@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo [ERROR] Visual Studio 2022 C++ tools not found.
  exit /b 1
)
call "%VCVARS%" >nul
set "AJ=%USERPROFILE%\Documents\Arduino\libraries\ArduinoJson\src"
set "OUT=%TEMP%\sb_host_test"
if not exist "%OUT%" mkdir "%OUT%"
set "CLFLAGS=/nologo /utf-8 /std:c++17 /EHsc /W4 /D_CRT_SECURE_NO_WARNINGS /I "%HERE%..\SmartBartender" /I "%AJ%""
rem 1) host_test.cpp   : PUMP_COUNT=4 (config.h default) - full protocol test
rem 2) host_test_8.cpp : PUMP_COUNT=8 - longest events (status job+last, 8 pumps, 40-byte id)
rem 3) host_test_tx.cpp: BLE TX ring (TxRing.h) - retry/backoff, give up one line, resync with a leading LF
cl %CLFLAGS% "%HERE%host_test.cpp" /Fo"%OUT%\\" /Fe"%OUT%\sb_host_test.exe" || exit /b 1
cl %CLFLAGS% "%HERE%host_test_8.cpp" /Fo"%OUT%\\" /Fe"%OUT%\sb_host_test_8.exe" || exit /b 1
cl %CLFLAGS% "%HERE%host_test_tx.cpp" /Fo"%OUT%\\" /Fe"%OUT%\sb_host_test_tx.exe" || exit /b 1
"%OUT%\sb_host_test.exe"
set "R1=%ERRORLEVEL%"
echo.
echo ## PUMP_COUNT=8
echo.
"%OUT%\sb_host_test_8.exe"
set "R2=%ERRORLEVEL%"
echo.
echo ## TxRing (BLE send buffer)
echo.
"%OUT%\sb_host_test_tx.exe"
set "R3=%ERRORLEVEL%"
if not "%R1%"=="0" exit /b 1
if not "%R2%"=="0" exit /b 1
if not "%R3%"=="0" exit /b 1
exit /b 0
