$ErrorActionPreference = "Stop"

$projectDir = "E:\Codex\codex-weixin"
$stateDir = "E:\Codex\codex-weixin-state"
$nodePath = "E:\Library\Node\node.exe"
$entryPath = Join-Path $projectDir "dist\server\index.js"
$logsDir = Join-Path $stateDir "logs"
$supervisorLog = Join-Path $logsDir "supervisor.log"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Set-Location -LiteralPath $projectDir

$env:CODEX_WEIXIN_STATE_DIR = $stateDir
$env:CODEX_WEIXIN_PORT = "18787"
$env:CODEX_WEIXIN_OPEN = "0"

$codexBinRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
$codexExecutable = Get-ChildItem -LiteralPath $codexBinRoot -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if ($null -ne $codexExecutable) {
  $env:PATH = "$($codexExecutable.DirectoryName);$env:PATH"
}

Add-Content -LiteralPath $supervisorLog -Value "$(Get-Date -Format o) bridge-start"
try {
  $service = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @($entryPath) `
    -WorkingDirectory $projectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logsDir "service.stdout.log") `
    -RedirectStandardError (Join-Path $logsDir "service.stderr.log") `
    -PassThru `
    -Wait
  $exitCode = $service.ExitCode
} catch {
  Add-Content -LiteralPath $supervisorLog -Value "$(Get-Date -Format o) bridge-launch-error type=$($_.Exception.GetType().Name)"
  exit 1
}

Add-Content -LiteralPath $supervisorLog -Value "$(Get-Date -Format o) bridge-exit code=$exitCode"
exit $exitCode
