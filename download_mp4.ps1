<#
.SYNOPSIS
    Universal MP4 Video Downloader
    Downloads videos from virtually any website or direct URL as MP4.
    Supports inspecting / fetching link lists first and bulk downloading.
    Default destination: %USERPROFILE%\Videos\Download

.EXAMPLE
    .\download_mp4.ps1 -Url "https://www.youtube.com/watch?v=..."
    .\download_mp4.ps1 -Url "https://..." -FetchLinks
    .\download_mp4.ps1 -BatchFile "links.txt"
    .\download_mp4.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $false, HelpMessage = "The URL of the video to download or inspect")]
    [string]$Url,

    [Parameter(Mandatory = $false)]
    [ValidateSet("best", "1080p", "1080p-compressed", "720p", "480p", "4k", "audio", "m4a", "mp3-opt", "mp3-max")]
    [string]$Quality = "m4a",

    [Parameter(Mandatory = $false)]
    [string]$DownloadDir = "$env:USERPROFILE\Videos\Download",

    [Parameter(Mandatory = $false)]
    [switch]$FetchLinks,

    [Parameter(Mandatory = $false)]
    [string]$BatchFile,

    [Parameter(Mandatory = $false)]
    [switch]$OpenFolder
)

$ErrorActionPreference = "Stop"
$isInteractive = [string]::IsNullOrWhiteSpace($Url) -and [string]::IsNullOrWhiteSpace($BatchFile) -and -not $FetchLinks

function Write-Color([string]$text, [ConsoleColor]$color = [ConsoleColor]::White) {
    Write-Host $text -ForegroundColor $color
}

# Ensure destination directory exists
if (-not (Test-Path -LiteralPath $DownloadDir)) {
    try {
        New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
        Write-Color "[+] Created download directory: $DownloadDir" Green
    }
    catch {
        Write-Color "[!] Failed to create download directory: $_" Red
        exit 1
    }
}

# Ensure PATH includes winget package directories for the current session
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User") + ";$env:Path"

# Locate yt-dlp
$ytDlpCmd = Get-Command yt-dlp -ErrorAction SilentlyContinue
if (-not $ytDlpCmd) {
    $wingetYtDlp = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe"
    if (Test-Path $wingetYtDlp) {
        $ytDlpPath = $wingetYtDlp
    }
    else {
        Write-Color "[!] yt-dlp executable not found. Please install via: winget install yt-dlp.yt-dlp" Red
        exit 1
    }
}
else {
    $ytDlpPath = $ytDlpCmd.Source
}

# Locate ffmpeg
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffmpegDir = $null
if ($ffmpegCmd) {
    $ffmpegDir = Split-Path -Parent $ffmpegCmd.Source
}
else {
    $wingetFFmpegPackage = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    if (Test-Path -LiteralPath $wingetFFmpegPackage -PathType Container) {
        foreach ($release in Get-ChildItem -LiteralPath $wingetFFmpegPackage -Directory) {
            $candidate = Join-Path $release.FullName "bin\ffmpeg.exe"
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $ffmpegDir = Split-Path -Parent $candidate
                break
            }
        }
    }
}

# Locate Deno as JavaScript runtime for yt-dlp to solve YouTube n-sig challenges (avoids 403 Forbidden)
$denoCmd = Get-Command deno -ErrorAction SilentlyContinue
$denoPath = $null
if ($denoCmd) {
    $denoPath = $denoCmd.Source
}
else {
    $wingetDeno = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe"
    if (Test-Path $wingetDeno) {
        $denoPath = $wingetDeno
    }
}

# Helper to build yt-dlp arguments for a given URL and quality
function Get-YtDlpArgs([string]$targetUrl, [string]$selectedQuality) {
    $argsList = @(
        "-P", $DownloadDir,
        "-o", "%(title)s [%(id)s].%(ext)s",
        "--windows-filenames",
        "--no-mtime",
        "--continue",
        "--no-overwrites",
        "--retries", "25",
        "--fragment-retries", "25",
        "--retry-sleep", "exp=1:30",
        "--socket-timeout", "30",
        "-N", "4",                  # Up to four concurrent fragments where supported
        "--buffer-size", "16M",     # yt-dlp read buffer setting
        "--throttled-rate", "100K"  # Restarts stalled connections if throttled below 100K
    )

    if ($ffmpegDir) {
        $argsList += @("--ffmpeg-location", $ffmpegDir)
    }

    if ($denoPath) {
        $argsList += @("--js-runtimes", "deno:$denoPath")
    }

    switch ($selectedQuality) {
        "4k" {
            $argsList += @(
                "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
                "--merge-output-format", "mp4",
                "--remux-video", "mp4"
            )
        }
        "720p" {
            $argsList += @(
                "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/b",
                "--merge-output-format", "mp4",
                "--remux-video", "mp4"
            )
        }
        "480p" {
            $argsList += @(
                "-f", "bv*[height<=480][ext=mp4]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]/b",
                "--merge-output-format", "mp4",
                "--remux-video", "mp4"
            )
        }
        "m4a" {
            # Direct YouTube Music AAC stream (Zero re-encoding loss, Smallest ~3MB)
            $argsList += @(
                "-f", "ba[ext=m4a]/ba/b",
                "-x",
                "--audio-format", "m4a"
            )
        }
        "audio" {
            # MP3 Optimized (~4MB, 192k VBR)
            $argsList += @(
                "-x",
                "--audio-format", "mp3",
                "--audio-quality", "2"
            )
        }
        "mp3-opt" {
            $argsList += @(
                "-x",
                "--audio-format", "mp3",
                "--audio-quality", "2"
            )
        }
        "mp3-max" {
            $argsList += @(
                "-x",
                "--audio-format", "mp3",
                "--audio-quality", "0"
            )
        }
        "1080p-compressed" {
            # 1080p MP4 Smart Compressed (~50% smaller)
            $argsList += @(
                "-S", "+size,+br,res:1080",
                "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
                "--merge-output-format", "mp4",
                "--remux-video", "mp4"
            )
        }
        default {
            # 1080p Full HD MP4 (Optimal speed & crystal clear quality)
            $argsList += @(
                "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
                "--merge-output-format", "mp4",
                "--remux-video", "mp4"
            )
        }
    }

    # Embed metadata & embed thumbnail converted to JPG for Windows Explorer cover art
    $argsList += @(
        "--embed-metadata",
        "--embed-thumbnail",
        "--convert-thumbnails", "jpg"
    )
    $argsList += $targetUrl
    return $argsList
}

# Helper to prompt for Quality Preset
function Prompt-Quality() {
    Write-Host ""
    Write-Color "Select Quality & Size Preset:" Cyan
    Write-Host " [1] Native M4A Audio (when available) [Default]"
    Write-Host " [2] MP3 Optimized (variable bitrate)"
    Write-Host " [3] MP3 Max (high bitrate conversion)"
    Write-Host " [4] Video up to 1080p"
    Write-Host " [5] Prefer smaller 1080p video stream"
    Write-Host " [6] 720p HD MP4 (Fast & Compact)"
    Write-Host " [7] 480p SD MP4"
    $choice = Read-Host " Choice [1-7, Enter for Default (1)]"

    switch ($choice.Trim()) {
        "2" { return "mp3-opt" }
        "3" { return "mp3-max" }
        "4" { return "best" }
        "5" { return "1080p-compressed" }
        "6" { return "720p" }
        "7" { return "480p" }
        default { return "m4a" }
    }
}

# Helper to select or browse destination folder
function Select-DestinationFolder([string]$currentDir) {
    Write-Host ""
    Write-Color "Download Destination Folder Selection:" Cyan
    Write-Host " Current location: $currentDir"
    Write-Host " [1] Keep current folder"
    Write-Host " [2] Browse with Windows File Explorer folder picker"
    Write-Host " [3] Type or paste custom folder path"
    $c = Read-Host " Choice [1-3, Default: 1]"

    $chosenDir = $currentDir
    switch ($c.Trim()) {
        "2" {
            try {
                Add-Type -AssemblyName System.Windows.Forms
                $f = New-Object System.Windows.Forms.FolderBrowserDialog
                $f.Description = "Select Media Save Destination Folder"
                $f.ShowNewFolderButton = $true
                if ($currentDir -and (Test-Path -LiteralPath $currentDir)) {
                    $f.SelectedPath = $currentDir
                }
                $top = New-Object System.Windows.Forms.Form
                $top.TopMost = $true
                if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
                    if (-not [string]::IsNullOrWhiteSpace($f.SelectedPath)) {
                        $chosenDir = $f.SelectedPath
                        Write-Color "[+] Folder Selected: $chosenDir" Green
                    }
                }
            }
            catch {
                Write-Color "[!] Folder picker dialog unavailable: $_" Yellow
            }
        }
        "3" {
            $typed = Read-Host " Enter custom destination folder path"
            if (-not [string]::IsNullOrWhiteSpace($typed)) {
                $chosenDir = $typed.Trim()
            }
        }
    }

    if (-not (Test-Path -LiteralPath $chosenDir)) {
        try {
            New-Item -ItemType Directory -Path $chosenDir -Force | Out-Null
            Write-Color "[+] Created folder: $chosenDir" Green
        }
        catch {
            Write-Color "[!] Could not create folder: $_. Using previous folder." Red
            return $currentDir
        }
    }
    return $chosenDir
}

# If no arguments provided, show interactive menu
if ([string]::IsNullOrWhiteSpace($Url) -and [string]::IsNullOrWhiteSpace($BatchFile) -and -not $FetchLinks) {
    $menuLoop = $true
    while ($menuLoop) {
        Write-Host ""
        Write-Color "==========================================================" Cyan
        Write-Color "           Universal MP4 Video Downloader                " Yellow
        Write-Color "==========================================================" Cyan
        Write-Color " Current Save Location: $DownloadDir" Gray
        Write-Host ""
        Write-Host " What would you like to do?"
        Write-Host " [1] Download a single video link"
        Write-Host " [2] Inspect website / playlist & select videos to bulk download"
        Write-Host " [3] Bulk download from a text file of URLs"
        Write-Host " [4] Change save destination folder anytime"
        $mode = Read-Host " Choice [1-4, Default: 1]"

        switch ($mode.Trim()) {
            "2" {
                $Url = Read-Host " Enter website, page, or playlist URL to inspect"
                $FetchLinks = $true
                $menuLoop = $false
            }
            "3" {
                $BatchFile = Read-Host " Enter path to text file with URLs (e.g. links.txt)"
                $menuLoop = $false
            }
            "4" {
                $DownloadDir = Select-DestinationFolder $DownloadDir
            }
            default {
                $Url = Read-Host " Enter Video URL"
                $menuLoop = $false
            }
        }
    }
}

# Option A: Batch download from text file
if (-not [string]::IsNullOrWhiteSpace($BatchFile)) {
    if (-not (Test-Path -LiteralPath $BatchFile)) {
        Write-Color "[!] Batch file '$BatchFile' does not exist." Red
        exit 1
    }
    $urls = @(Get-Content -LiteralPath $BatchFile | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith("#") })
    if (@($urls).Count -eq 0) {
        Write-Color "[!] Batch file contains no URLs." Red
        exit 1
    }
    Write-Color "[+] Loaded $($urls.Count) URLs from $BatchFile" Green
    if (-not $PSBoundParameters.ContainsKey("Quality")) { $Quality = Prompt-Quality }

    Write-Host ""
    Write-Color "[-] Starting Bulk Download of $($urls.Count) videos..." Cyan
    $counter = 0
    $failedCount = 0
    foreach ($itemUrl in $urls) {
        $counter++
        Write-Host ""
        Write-Color "----------------------------------------------------------" DarkGray
        Write-Color "[$counter / $($urls.Count)] Downloading: $itemUrl" Cyan
        $argsList = Get-YtDlpArgs $itemUrl.Trim() $Quality
        & $ytDlpPath @argsList
        if ($LASTEXITCODE -ne 0) {
            $failedCount++
            Write-Color "[!] Download failed: $itemUrl" Red
        }
    }

    Write-Host ""
    if ($failedCount -gt 0) {
        Write-Color "[!] Finished with $failedCount failed download(s). Output folder: $DownloadDir" Red
        exit 1
    }
    Write-Color "[+] Bulk download complete! All files saved to: $DownloadDir" Green
    if ($OpenFolder) { Start-Process explorer.exe -ArgumentList $DownloadDir }
    exit 0
}

# Option B: Fetch links first, then select and bulk download
if ($FetchLinks -or ($Url -and $Url.Contains("playlist"))) {
    Write-Host ""
    Write-Color "[-] Fetching and inspecting video list from: $Url ..." Cyan
    Write-Color "    (Scanning page for embedded and streamable videos, please wait...)" Gray
    
    try {
        $extractArgs = @("--flat-playlist", "-J", "--no-warnings")
        if ($denoPath) { $extractArgs += @("--js-runtimes", "deno:$denoPath") }
        $extractArgs += $Url
        $rawJson = & $ytDlpPath @extractArgs
        $data = $rawJson | ConvertFrom-Json
    }
    catch {
        Write-Color "[!] Failed to extract link list: $_" Red
        exit 1
    }

    $entries = @()
    if ($data.entries) {
        $entries = $data.entries
    }
    elseif ($data.id -or $data.title) {
        $entries = @($data)
    }

    if ($entries.Count -eq 0) {
        Write-Color "[!] No video links could be extracted from that URL." Red
        exit 1
    }

    Write-Host ""
    Write-Color "==========================================================" Cyan
    Write-Color " Found $($entries.Count) Video(s):" Green
    Write-Color "==========================================================" Cyan
    
    $index = 0
    foreach ($entry in $entries) {
        $index++
        $title = if ($entry.title) { $entry.title } else { "Track #$index" }
        $author = if ($entry.artist) { $entry.artist } elseif ($entry.uploader) { $entry.uploader } else { "" }
        $durStr = if ($entry.duration) {
            $m = [math]::Floor($entry.duration / 60)
            $s = [math]::Floor($entry.duration % 60)
            "[$($m):$($s.ToString().PadLeft(2, '0'))]"
        } else { "" }
        $viewStr = if ($entry.view_count) {
            $vc = [double]$entry.view_count
            if ($vc -ge 1000000) { " $([math]::Round($vc / 1000000, 1))M plays" }
            elseif ($vc -ge 1000) { " $([math]::Round($vc / 1000, 1))K plays" }
            else { " $vc plays" }
        } else { "" }
        $entryUrl = if ($entry.url) { $entry.url } elseif ($entry.webpage_url) { $entry.webpage_url } else { $entry.id }
        Write-Host (" [{0,2}] {1}{2}" -f $index, $title, $viewStr) -ForegroundColor Yellow
        if ($author) {
            Write-Host ("      Artist: {0} {1}" -f $author, $durStr) -ForegroundColor Cyan
        }
        Write-Host ("      URL: {0}" -f $entryUrl) -ForegroundColor Gray
    }

    Write-Host ""
    Write-Color "Download Selection:" Cyan
    Write-Host " Enter 'all' to download everything, or specify ranges/numbers (e.g. 1-3, 5)"
    $selection = Read-Host " Selection [Default: all]"
    if ([string]::IsNullOrWhiteSpace($selection)) { $selection = "all" }

    # Parse user selection
    $chosenEntries = @()
    if ($selection.Trim().ToLower() -eq "all") {
        foreach ($e in $entries) {
            $u = if ($e.url) { $e.url } elseif ($e.webpage_url) { $e.webpage_url } else { $e.id }
            $t = if ($e.title) { $e.title } else { "" }
            $a = if ($e.artist) { $e.artist } elseif ($e.uploader) { $e.uploader } else { "" }
            $chosenEntries += [PSCustomObject]@{ url = $u; title = $t; author = $a }
        }
    }
    else {
        $parts = $selection -split "[, ]+"
        foreach ($part in $parts) {
            if ($part -match "^(\d+)-(\d+)$") {
                $start = [int]$matches[1]
                $end = [int]$matches[2]
                for ($i = $start; $i -le $end; $i++) {
                    if ($i -ge 1 -and $i -le $entries.Count) {
                        $e = $entries[$i - 1]
                        $u = if ($e.url) { $e.url } elseif ($e.webpage_url) { $e.webpage_url } else { $e.id }
                        $t = if ($e.title) { $e.title } else { "" }
                        $a = if ($e.artist) { $e.artist } elseif ($e.uploader) { $e.uploader } else { "" }
                        $chosenEntries += [PSCustomObject]@{ url = $u; title = $t; author = $a }
                    }
                }
            }
            elseif ($part -match "^\d+$") {
                $i = [int]$part
                if ($i -ge 1 -and $i -le $entries.Count) {
                    $e = $entries[$i - 1]
                    $u = if ($e.url) { $e.url } elseif ($e.webpage_url) { $e.webpage_url } else { $e.id }
                    $t = if ($e.title) { $e.title } else { "" }
                    $a = if ($e.artist) { $e.artist } elseif ($e.uploader) { $e.uploader } else { "" }
                    $chosenEntries += [PSCustomObject]@{ url = $u; title = $t; author = $a }
                }
            }
        }
    }

    if ($chosenEntries.Count -eq 0) {
        Write-Color "[!] No valid videos selected. Aborting." Red
        exit 1
    }

    if (-not $PSBoundParameters.ContainsKey("Quality")) { $Quality = Prompt-Quality }

    Write-Host ""
    Write-Color "[-] Starting Bulk Download of $($chosenEntries.Count) selected video(s)..." Cyan
    $counter = 0
    $failedCount = 0
    foreach ($item in $chosenEntries) {
        $counter++
        $itemUrl = $item.url
        Write-Host ""
        Write-Color "----------------------------------------------------------" DarkGray
        Write-Color "[$counter / $($chosenEntries.Count)] Downloading: $(if ($item.title) { $item.title } else { $itemUrl })" Cyan
        $argsList = Get-YtDlpArgs $itemUrl $Quality
        & $ytDlpPath @argsList
        $downloadExit = $LASTEXITCODE
        if ($downloadExit -ne 0 -and $item.title -and $Quality -in @("audio", "m4a", "mp3-opt", "mp3-max")) {
            Write-Color "[Audio Fallback] Direct video unavailable. Searching YouTube for audio: $($item.title)..." Yellow
            $searchQuery = "ytsearch1:$($item.author) $($item.title) audio".Trim()
            $fallbackArgs = Get-YtDlpArgs $searchQuery $Quality
            & $ytDlpPath @fallbackArgs
            $downloadExit = $LASTEXITCODE
        }
        if ($downloadExit -ne 0) {
            $failedCount++
            Write-Color "[!] Download failed: $itemUrl" Red
        }
    }

    Write-Host ""
    if ($failedCount -gt 0) {
        Write-Color "[!] Finished with $failedCount failed download(s). Output folder: $DownloadDir" Red
        exit 1
    }
    Write-Color "[+] Bulk download complete! All files saved to: $DownloadDir" Green
    if ($OpenFolder) { Start-Process explorer.exe -ArgumentList $DownloadDir }
    exit 0
}

# Option C: Single Video Download
if ([string]::IsNullOrWhiteSpace($Url)) {
    Write-Color "[!] No URL provided. Aborting." Red
    exit 1
}

if ($isInteractive) {
    $Quality = Prompt-Quality
}

Write-Host ""
Write-Color "[-] Processing Video Download with High-Speed Acceleration..." Cyan
Write-Color "    URL:     $Url" Gray
Write-Color "    Quality: $Quality" Gray
Write-Color "    Target:  $DownloadDir" Gray
Write-Host ""

$dlpArgs = Get-YtDlpArgs $Url $Quality

try {
    & $ytDlpPath @dlpArgs
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Color "[+] Download completed successfully!" Green
        Write-Color "[+] Saved to: $DownloadDir" Green
        Write-Host ""

        if ($OpenFolder) {
            Start-Process explorer.exe -ArgumentList $DownloadDir
        }
    }
    else {
        Write-Color "[!] Download finished with exit code $LASTEXITCODE. Check error messages above." Red
        exit $LASTEXITCODE
    }
}
catch {
    Write-Color "[!] An unexpected error occurred: $_" Red
    exit 1
}
