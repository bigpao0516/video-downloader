$ErrorActionPreference = "Stop"

$serverPath = Join-Path $PSScriptRoot "src\server.ts"
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    Write-Error "Downloader server file was not found: $serverPath"
    exit 1
}
$manifestPath = Join-Path $PSScriptRoot "deno.json"
$expectedVersion = (Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).version
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }

$legacyServers = @()
foreach ($port in 3000..3005) {
    $statusUrl = "http://127.0.0.1:$port/api/status"
    try {
        $status = Invoke-RestMethod -Uri $statusUrl -Method Get -TimeoutSec 1 -ErrorAction Stop
    } catch {
        continue
    }

    if ($status.app -eq "universal-video-downloader" -and $status.version -eq $expectedVersion) {
        $activePort = if ($status.port) { [int]$status.port } else { $port }
        $appUrl = "http://127.0.0.1:$activePort"
        Write-Host "The downloader is already running at $appUrl. Opening it..." -ForegroundColor Cyan
        Start-Process $appUrl
        exit 0
    }

    $statusFields = @($status.PSObject.Properties.Name)
    if ($status.ready -eq $true -and $statusFields -contains "downloadDir" -and $statusFields -contains "ytDlp") {
        $legacyServers += $port
    }
}

if ($legacyServers.Count -gt 0) {
    $portsText = $legacyServers -join ", "
    Write-Host "A different downloader version is still responding on port(s) $portsText." -ForegroundColor Yellow
    Write-Host "I have left it running to avoid interrupting downloads. Let its current downloads finish, close its old server console, then run start_web_ui.bat again." -ForegroundColor Yellow
    exit 2
}

$denoCommand = Get-Command "deno" -ErrorAction SilentlyContinue
$denoPath = if ($denoCommand) { $denoCommand.Source } else { Join-Path $localAppData "Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe" }
if (-not (Test-Path -LiteralPath $denoPath -PathType Leaf)) {
    Write-Error "Deno was not found. Install Deno, then run start_web_ui.bat again."
    exit 1
}

$allowedHosts = @(
    "127.0.0.1:3000",
    "127.0.0.1:3001",
    "127.0.0.1:3002",
    "127.0.0.1:3003",
    "127.0.0.1:3004",
    "127.0.0.1:3005",
    "music.youtube.com:443"
)
$networkPermission = "--allow-net=" + ($allowedHosts -join ",")

$allowedCommands = @("yt-dlp", "yt-dlp.exe", "powershell.exe", "explorer.exe", "taskkill", "taskkill.exe")
$wingetYtDlp = Join-Path $localAppData "Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe"
if (Test-Path -LiteralPath $wingetYtDlp -PathType Leaf) {
    $allowedCommands += $wingetYtDlp
}
$runPermission = "--allow-run=" + ($allowedCommands -join ",")

$denoArgs = @(
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env=USERPROFILE,LOCALAPPDATA",
    $networkPermission,
    $runPermission,
    $serverPath
)

Write-Host "Starting the downloader on loopback (ports 3000-3005)..." -ForegroundColor Cyan
Write-Host "Keep this console open while using the downloader. Press Ctrl+C here to stop it." -ForegroundColor DarkGray
& $denoPath @denoArgs
exit $LASTEXITCODE
