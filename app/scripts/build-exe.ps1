# Build the Windows portable EXE (Electron) -> <app>\release\SmartBartender-<version>-portable.exe
# ASCII-only on purpose (Windows PowerShell 5.1). Usage, from the app folder:
#   npm run build:exe
#   powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1 [-SkipTypecheck] [-CleanInstall] [-SkipSmoke] [-ToolsDir C:\...\sb-tools]
# Steps: mirror to ASCII path -> npm ci (if lock changed) -> typecheck -> vite build -> check-no-secrets
#        -> scripts/build-exe.mjs (stage + electron-builder portable x64) -> check-no-secrets on staged dist + app.asar
#        -> smoke test (win-unpacked\SmartBartender.exe --smoke-test) -> copy EXE back
param(
    [string]$ToolsDir,
    [string]$Mirror,
    [switch]$SkipTypecheck,
    [switch]$CleanInstall,
    [switch]$SkipSmoke
)

. (Join-Path $PSScriptRoot 'lib-build.ps1')

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ToolsDir = Initialize-SbTools -ToolsDir $ToolsDir
if (-not $Mirror) { $Mirror = Join-Path $ToolsDir 'build\app' }
$version = Get-SbVersion -Dir $AppDir
$total = [Diagnostics.Stopwatch]::StartNew()
$times = [ordered]@{}
function Stop-Watch($name, $sw) { $times[$name] = '{0:N0}s' -f $sw.Elapsed.TotalSeconds }

Write-Step "Mirror $AppDir -> $Mirror"
$sw = [Diagnostics.Stopwatch]::StartNew(); Sync-SbMirror -AppDir $AppDir -Mirror $Mirror; Stop-Watch 'mirror' $sw

Write-Step 'Install dependencies'
$sw = [Diagnostics.Stopwatch]::StartNew(); Install-SbDeps -Mirror $Mirror -Force:$CleanInstall; Stop-Watch 'npm ci' $sw

Write-Step 'Web build (typecheck, vite build, secret scan)'
$sw = [Diagnostics.Stopwatch]::StartNew(); Build-SbWeb -AppDir $AppDir -Mirror $Mirror -SkipTypecheck:$SkipTypecheck; Stop-Watch 'web build' $sw

Write-Step 'electron-builder (portable x64)'
$sw = [Diagnostics.Stopwatch]::StartNew()
$outDir = Join-Path $Mirror 'release'
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
Push-Location $Mirror
try { Invoke-Native 'build-exe.mjs' { & node scripts\build-exe.mjs } } finally { Pop-Location }
Stop-Watch 'electron' $sw

$exeName = "SmartBartender-$version-portable.exe"
$builtExe = Join-Path $outDir $exeName
$unpacked = Join-Path $outDir 'win-unpacked'
if (-not (Test-Path $builtExe)) { throw "EXE not found: $builtExe" }

Write-Step 'Secret scan (staged dist + app.asar)'
$asar = Join-Path $unpacked 'resources\app.asar'
Invoke-Native 'check-no-secrets (exe content)' { & node (Join-Path $AppDir 'scripts\check-no-secrets.mjs') --no-dist (Join-Path $Mirror '.electron-stage\dist') $asar $builtExe }

if (-not $SkipSmoke) {
    Write-Step 'Smoke test (hidden window: app renders, navigator.bluetooth, window.sbElectron)'
    $smokeOut = Join-Path ([IO.Path]::GetTempPath()) ('sb-smoke-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
    $exe = Join-Path $unpacked 'SmartBartender.exe'
    $p = Start-Process -FilePath $exe -ArgumentList @('--smoke-test', "--smoke-out=$smokeOut") -PassThru
    if (-not $p.WaitForExit(60000)) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        throw 'smoke test timed out (60s)'
    }
    if (-not (Test-Path $smokeOut)) { throw "smoke test wrote no result (exit $($p.ExitCode))" }
    $smoke = Get-Content -Path $smokeOut -Raw -Encoding UTF8 | ConvertFrom-Json
    Remove-Item $smokeOut -Force -ErrorAction SilentlyContinue
    Write-Host ("[sb] smoke: ok={0} electron={1} rootChildren={2} bluetooth={3} secure={4} sbElectron={5} serviceWorkers={6} localStorage={7} consoleErrors={8}" -f `
        $smoke.ok, $smoke.electron, $smoke.rootChildren, $smoke.bluetooth, $smoke.secureContext, $smoke.sbElectron, $smoke.serviceWorkers, $smoke.localStorage, @($smoke.consoleErrors).Count)
    if (-not $smoke.ok) { throw 'smoke test failed (see values above)' }
}

Write-Step 'Copy EXE'
$releaseDir = Join-Path $AppDir 'release'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$dest = Join-Path $releaseDir $exeName
Copy-Item -Path $builtExe -Destination $dest -Force

$times['total'] = '{0:N0}s' -f $total.Elapsed.TotalSeconds
Write-Step 'Done'
$times.GetEnumerator() | ForEach-Object { Write-Host ('  {0,-10} {1}' -f $_.Key, $_.Value) }
Write-Host "  EXE: $dest ($(Format-Size (Get-Item $dest).Length))"
Write-Host '  Unsigned: Windows SmartScreen may warn on first run ("More info" -> "Run anyway").'
