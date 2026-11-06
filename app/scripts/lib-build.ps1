# Shared helpers for build-android.ps1 / build-exe.ps1 (dot-sourced).
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 scripts as the ANSI code page.
#
# Why a mirror copy: the Android Gradle Plugin refuses project paths with non-ASCII characters
# (this project lives under "...\Desktop\<Korean folder>\..."), so Android (and, for safety, Electron) builds
# run from an ASCII copy: %USERPROFILE%\sb-tools\build\app. Results are copied back to <app>\release\.

$ErrorActionPreference = 'Stop'

function Initialize-SbTools {
    param([string]$ToolsDir)
    if (-not $ToolsDir) {
        if ($env:SB_TOOLS -and (Test-Path (Join-Path $env:SB_TOOLS 'env.ps1'))) { $ToolsDir = $env:SB_TOOLS }
        else { $ToolsDir = Join-Path $env:USERPROFILE 'sb-tools' }
    }
    $envScript = Join-Path $ToolsDir 'env.ps1'
    if (-not (Test-Path $envScript)) { throw "sb-tools not found: $envScript (JDK 21 / Android SDK / caches). See app/README.md section 3." }
    $env:SB_ENV_QUIET = '1'
    . $envScript
    Write-Host "[sb] tools: JAVA_HOME=$env:JAVA_HOME ANDROID_HOME=$env:ANDROID_HOME node=$env:SB_NODE_DIR"
    return $ToolsDir
}

function Write-Step {
    param([string]$Text)
    Write-Host ''
    Write-Host "==> $Text" -ForegroundColor Cyan
}

# Run a native command (scriptblock) and fail on a non-zero exit code.
function Invoke-Native {
    param([string]$What, [scriptblock]$Block)
    & $Block
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

# Mirror <app> into an ASCII path. node_modules / build outputs / local secrets are not copied
# (robocopy also leaves excluded folders such as the mirror's node_modules in place when purging).
function Sync-SbMirror {
    param([string]$AppDir, [string]$Mirror)
    New-Item -ItemType Directory -Force -Path $Mirror | Out-Null
    $xd = @('node_modules', 'dist', 'dev-dist', 'release', 'build', '.gradle', '.idea', '.electron-stage', '.cxx')
    $xf = @('.env', '.env.*', '*.local', 'local.properties', '*.log')
    $rcArgs = @($AppDir, $Mirror, '/MIR', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD') + $xd + @('/XF') + $xf
    & robocopy @rcArgs | Out-Host
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit code $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
    if (Get-ChildItem -Path $Mirror -Filter '.env*' -Force -ErrorAction SilentlyContinue) { throw 'a .env file reached the mirror - aborting' }
    Write-Host "[sb] mirror: $Mirror"
}

# npm ci only when package-lock.json changed since the last install in the mirror (or -Force).
function Install-SbDeps {
    param([string]$Mirror, [switch]$Force)
    $lock = Join-Path $Mirror 'package-lock.json'
    $hash = (Get-FileHash -Path $lock -Algorithm SHA256).Hash
    $stamp = Join-Path $Mirror 'node_modules\.sb-lock-hash'
    if (-not $Force -and (Test-Path $stamp) -and ((Get-Content -Path $stamp -Raw).Trim() -eq $hash)) {
        Write-Host '[sb] npm ci skipped (package-lock.json unchanged; use -CleanInstall to force)'
        return
    }
    Push-Location $Mirror
    try {
        Invoke-Native 'npm ci' { & npm ci --no-audit --no-fund }
    } finally { Pop-Location }
    Set-Content -Path $stamp -Value $hash -Encoding ascii
}

# typecheck (optional) + vite build + secret scan of dist (also with the original app's checker,
# which can compare against the dev key in <app>\.env.development.local without printing it).
function Build-SbWeb {
    param([string]$AppDir, [string]$Mirror, [switch]$SkipTypecheck)
    Push-Location $Mirror
    try {
        if (-not $SkipTypecheck) { Invoke-Native 'typecheck' { & npx --no-install tsc --noEmit -p tsconfig.json } }
        else { Write-Host '[sb] typecheck skipped (-SkipTypecheck)' }
        Invoke-Native 'vite build' { & npx --no-install vite build }
        Invoke-Native 'check-no-secrets (mirror dist)' { & node scripts/check-no-secrets.mjs }
    } finally { Pop-Location }
    Invoke-Native 'check-no-secrets (dev key compare)' { & node (Join-Path $AppDir 'scripts\check-no-secrets.mjs') --no-dist (Join-Path $Mirror 'dist') }
}

function Get-SbVersion {
    param([string]$Dir)
    return (Get-Content -Path (Join-Path $Dir 'package.json') -Raw | ConvertFrom-Json).version
}

function Format-Size {
    param([long]$Bytes)
    return ('{0:N1} MB' -f ($Bytes / 1MB))
}
