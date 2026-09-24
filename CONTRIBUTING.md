# Contributing

This is a Windows-first Deno and PowerShell project. Keep changes within this repository directory; do not commit downloaded media, credentials, personal paths, or browser data.

Before opening a pull request:

1. Run `deno task check` from the repository root.
2. Run `./scripts/check-powershell.ps1` and, for launcher changes, try the affected launcher on Windows.
3. Describe what changed and how you verified it. For extractor issues, include the yt-dlp version and a public sample URL when possible.

The browser UI lives in `public/index.html`, the Deno server in `src/server.ts`, and the Windows launchers at the repository root. Avoid adding generated files or downloading test media into the repository.
