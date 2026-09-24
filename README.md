# Universal Video & Music Downloader

A Windows downloader with a browser interface and a PowerShell command line interface. It uses your installed [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/) to save media from sites supported by yt-dlp. The browser interface is served locally by [Deno](https://deno.com/).

Download only media you have permission to save. Site support and available formats depend on the source and your installed yt-dlp version.

## Requirements

- Windows with Windows PowerShell 5.1 or newer.
- `yt-dlp` for all downloads.
- FFmpeg for merging video/audio streams, audio conversion, and embedded artwork.
- Deno 2.x for the browser interface; it is also recommended for YouTube extraction in the CLI.

Install these tools separately and make them available on `PATH`. You can check them in PowerShell with `Get-Command yt-dlp, ffmpeg, deno`. The launchers also recognize the standard WinGet package locations for yt-dlp, FFmpeg, and Deno where applicable. No binaries or downloaded media are included in this repository.

## Start the browser interface

Double-click [start_web_ui.bat](start_web_ui.bat). The launcher opens the app at `http://127.0.0.1:3000` (or the next free port through 3005). Keep its console open while using the app. You can stop it with Ctrl+C in that console.

The interface can download a single video or song, inspect a playlist, select tracks, and show progress. To combine playlists, put one URL in the main field, click **Add multiple playlist URLs or direct video URLs**, and put the remaining URLs in the box, one per line. Up to 20 source URLs can be inspected in one batch. Tracks are labeled with their source playlist and enter one download queue; transfers run one track at a time. Individual video links work in the same box.

If the launcher detects an older running copy, finish its active downloads, close its console, and launch this version again. The app binds to `127.0.0.1`; do not expose its port through a proxy or tunnel because the local API can access folders and start downloads.

## Use the command line

Double-click [download_mp4.bat](download_mp4.bat) for an interactive menu, or run [download_mp4.ps1](download_mp4.ps1) from PowerShell:

```powershell
# Interactive menu and quality selection
.\download_mp4.ps1

# Download one URL as 1080p video
.\download_mp4.ps1 -Url "https://example.com/video" -Quality 1080p

# Inspect a playlist and choose tracks
.\download_mp4.ps1 -Url "https://example.com/playlist" -FetchLinks

# Download URLs from a text file, one per line (# starts a comment)
.\download_mp4.ps1 -BatchFile ".\links.txt"

# Set the output directory explicitly
.\download_mp4.ps1 -Url "https://example.com/video" -DownloadDir "D:\Media"
```

The CLI defaults to native M4A audio unless you select another quality. Its output folder defaults to `%USERPROFILE%\Videos\Download`. The browser interface can use any folder you choose; its last selected folder is saved in the browser's local storage.

For failed audio tracks in a playlist, the downloader may search YouTube by artist and title as a fallback. Check the resulting file if an exact match matters. Video selections are not replaced by an audio search.

## Repository layout

```text
video-downloader/
├── src/server.ts             Deno local API and download runner
├── public/index.html         Browser interface
├── scripts/                  Source checks
├── start_web_ui.bat/.ps1     Browser interface launchers
├── download_mp4.bat/.ps1     Command line launchers
├── deno.json                 Deno check commands
└── .github/workflows/        GitHub source checks
```

From the repository root, run `deno task check` to type-check the server and parse the browser script. Run `.\scripts\check-powershell.ps1` to parse the PowerShell launchers. GitHub Actions runs both checks on pushes and pull requests. These checks do not download media.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributions and [SECURITY.md](SECURITY.md) for the local API security model.

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 bigpao0516.

## Privacy and dependencies

Downloads are saved on your computer. The app does not include analytics or a hosted account. The browser can request Google Fonts and remote thumbnail images; yt-dlp contacts the sites whose URLs you submit, and the app requests YouTube Music metadata for some views and artwork. Browser folder preferences are stored locally. Keep credentials, personal files, and downloaded media out of public commits.
