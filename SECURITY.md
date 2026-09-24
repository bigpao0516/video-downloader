# Security

The web UI runs on `127.0.0.1` and can read local media folders, create folders, rename files, and start download processes. Do not expose its port through a proxy, tunnel, or public network interface.

If you find a security issue, use GitHub private vulnerability reporting for this repository when available. Otherwise, open a minimal issue requesting a private contact channel without publishing exploit details.

Downloaded media and browser preferences stay on the user's machine. The browser may request Google Fonts and remote thumbnail images; yt-dlp contacts the sites supplied by the user.
