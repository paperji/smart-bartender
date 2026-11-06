# Build the Android APK (Capacitor) -> <app>\release\SmartBartender-<version>.apk
# ASCII-only on purpose (Windows PowerShell 5.1). Usage, from the app folder:
#   npm run build:android
#   powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1 [-SkipTypecheck] [-CleanInstall] [-ToolsDir C:\...\sb-tools] [-NewKeystore]
# Release signing key: android\keystore\release.keystore + keystore.properties (gitignored, keep a copy on the team drive).
#   Missing key -> the build STOPS. An APK signed with another key cannot update the installed app, so users would have
#   to uninstall it and lose their data. Restore both files from the backup. Only for the very first release, create a
#   new key on purpose with:  npm run build:android -- -NewKeystore   (or: npm run keystore)
# Steps: mirror to ASCII path -> npm ci (if lock changed) -> typecheck -> vite build -> check-no-secrets
#        -> cap sync android -> gradlew assembleRelease (signed with android\keystore) -> copy APK back
#        -> apksigner verify + aapt2 permissions -> unzip APK to temp and check-no-secrets on it -> gradlew --stop
param(
    [string]$ToolsDir,
    [string]$Mirror,
    [switch]$SkipTypecheck,
    [switch]$CleanInstall,
    [switch]$NewKeystore
)

. (Join-Path $PSScriptRoot 'lib-build.ps1')

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ToolsDir = Initialize-SbTools -ToolsDir $ToolsDir
if (-not $Mirror) { $Mirror = Join-Path $ToolsDir 'build\app' }
$version = Get-SbVersion -Dir $AppDir
$total = [Diagnostics.Stopwatch]::StartNew()
$times = [ordered]@{}
function Stop-Watch($name, $sw) { $times[$name] = '{0:N0}s' -f $sw.Elapsed.TotalSeconds }

$keystoreDir = Join-Path $AppDir 'android\keystore'
$haveProps = Test-Path (Join-Path $keystoreDir 'keystore.properties')
$haveStore = Test-Path (Join-Path $keystoreDir 'release.keystore')
if (-not ($haveProps -and $haveStore)) {
    if ($haveProps -or $haveStore) {
        throw ("Release signing key is incomplete in $keystoreDir (need both release.keystore and keystore.properties). " +
            'Restore both files from the team drive backup. Never mix files from different keys.')
    }
    if (-not $NewKeystore) {
        throw ("Release signing key not found in $keystoreDir (release.keystore + keystore.properties). " +
            'Restore both files from the team drive backup: an APK signed with a different key cannot update ' +
            'the installed app (users would have to uninstall it and lose their data). ' +
            'Only for the very first release: npm run build:android -- -NewKeystore')
    }
    Write-Step 'Creating a NEW release signing key (-NewKeystore). Back up android\keystore\ to the team drive now.'
    Invoke-Native 'make-keystore' { & node (Join-Path $AppDir 'scripts\make-keystore.mjs') }
}

$gradleStarted = $false
try {
    Write-Step "Mirror $AppDir -> $Mirror"
    $sw = [Diagnostics.Stopwatch]::StartNew(); Sync-SbMirror -AppDir $AppDir -Mirror $Mirror; Stop-Watch 'mirror' $sw

    Write-Step 'Install dependencies'
    $sw = [Diagnostics.Stopwatch]::StartNew(); Install-SbDeps -Mirror $Mirror -Force:$CleanInstall; Stop-Watch 'npm ci' $sw

    Write-Step 'Web build (typecheck, vite build, secret scan)'
    $sw = [Diagnostics.Stopwatch]::StartNew(); Build-SbWeb -AppDir $AppDir -Mirror $Mirror -SkipTypecheck:$SkipTypecheck; Stop-Watch 'web build' $sw

    Write-Step 'cap sync android'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Push-Location $Mirror
    try { Invoke-Native 'cap sync' { & npx --no-install cap sync android } } finally { Pop-Location }
    # the copied web assets must be clean too
    Invoke-Native 'check-no-secrets (android assets)' { & node (Join-Path $AppDir 'scripts\check-no-secrets.mjs') --no-dist (Join-Path $Mirror 'android\app\src\main\assets') }
    Stop-Watch 'cap sync' $sw

    Write-Step 'gradlew assembleRelease'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Push-Location (Join-Path $Mirror 'android')
    try {
        $gradleStarted = $true
        Invoke-Native 'gradlew assembleRelease' { & .\gradlew.bat assembleRelease --console=plain --warning-mode=summary }
    } finally { Pop-Location }
    Stop-Watch 'gradle' $sw

    Write-Step 'Copy APK'
    $built = Join-Path $Mirror 'android\app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path $built)) { throw "APK not found: $built (unsigned? check android\keystore\keystore.properties)" }
    $releaseDir = Join-Path $AppDir 'release'
    New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
    $apk = Join-Path $releaseDir "SmartBartender-$version.apk"
    Copy-Item -Path $built -Destination $apk -Force
    Write-Host "[sb] APK: $apk ($(Format-Size (Get-Item $apk).Length))"

    Write-Step 'Verify signature and permissions'
    $bt = Join-Path $env:ANDROID_HOME 'build-tools\36.0.0'
    Invoke-Native 'apksigner verify' { & (Join-Path $bt 'apksigner.bat') verify --verbose --print-certs $apk }
    Invoke-Native 'aapt2 badging' { & (Join-Path $bt 'aapt2.exe') dump badging $apk | Select-String -Pattern '^(package|sdkVersion|targetSdkVersion|application-label|launchable-activity):' | ForEach-Object { $_.Line } }
    Invoke-Native 'aapt2 permissions' { & (Join-Path $bt 'aapt2.exe') dump permissions $apk }

    Write-Step 'Secret scan of the APK (inside entries + unzipped copy)'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Invoke-Native 'check-no-secrets (apk)' { & node (Join-Path $AppDir 'scripts\check-no-secrets.mjs') --no-dist $apk }
    $unz = Join-Path ([IO.Path]::GetTempPath()) ("sb-apk-scan-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $unz | Out-Null
    try {
        Invoke-Native 'unzip apk' { & (Join-Path $env:SystemRoot 'System32\tar.exe') -xf $apk -C $unz }
        Invoke-Native 'check-no-secrets (unzipped apk)' { & node (Join-Path $AppDir 'scripts\check-no-secrets.mjs') --no-dist $unz }
    } finally { Remove-Item -Recurse -Force $unz -ErrorAction SilentlyContinue }
    Stop-Watch 'scan' $sw
}
finally {
    if ($gradleStarted) {
        Write-Step 'Stop Gradle daemons'
        Push-Location (Join-Path $Mirror 'android')
        try { & .\gradlew.bat --stop | Out-Host } catch { Write-Host "[sb] gradlew --stop: $_" } finally { Pop-Location }
        $global:LASTEXITCODE = 0
    }
}

$times['total'] = '{0:N0}s' -f $total.Elapsed.TotalSeconds
Write-Step 'Done'
$times.GetEnumerator() | ForEach-Object { Write-Host ('  {0,-10} {1}' -f $_.Key, $_.Value) }
Write-Host "  APK: $apk"
Write-Host '  Install: copy to the phone and open it (allow "install unknown apps"), or: adb install -r <apk>'
