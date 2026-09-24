// Universal Video & Music Downloader - Web Backend
// Powered by Deno, yt-dlp, and FFmpeg

const USER_PROFILE = Deno.env.get("USERPROFILE") || Deno.cwd();
const DEFAULT_DOWNLOAD_DIR = `${USER_PROFILE}\\Videos\\Download`;

const SYSTEM_PRESETS = {
  default: DEFAULT_DOWNLOAD_DIR,
  videos: `${USER_PROFILE}\\Videos\\Download`,
  music: `${USER_PROFILE}\\Music`,
  downloads: `${USER_PROFILE}\\Downloads`,
  desktop: `${USER_PROFILE}\\Desktop`
};

function ensureDirectory(dirPath?: string): string {
  const target = dirPath && dirPath.trim() ? dirPath.trim() : DEFAULT_DOWNLOAD_DIR;
  try {
    Deno.mkdirSync(target, { recursive: true });
  } catch { }
  return target;
}
const PORT = 3000;
let activePort = PORT;
const APP_VERSION = JSON.parse(Deno.readTextFileSync(new URL("../deno.json", import.meta.url))).version;

// Resolve binary paths
function getBinaryPath(binaryName: string): string {
  // Check if available on system path or standard winget location
  const localAppData = Deno.env.get("LOCALAPPDATA") || `${USER_PROFILE}\\AppData\\Local`;
  const wingetBase = `${localAppData}\\Microsoft\\WinGet\\Packages`;

  if (binaryName === "yt-dlp") {
    const defaultWinget = `${wingetBase}\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe`;
    try {
      if (Deno.statSync(defaultWinget).isFile) return defaultWinget;
    } catch { }
  }

  if (binaryName === "ffmpeg") {
    const ffmpegPackage = `${wingetBase}\\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe`;
    try {
      for (const entry of Deno.readDirSync(ffmpegPackage)) {
        if (!entry.isDirectory) continue;
        const candidate = `${ffmpegPackage}\\${entry.name}\\bin\\ffmpeg.exe`;
        try {
          if (Deno.statSync(candidate).isFile) return candidate;
        } catch { }
      }
    } catch { }
  }

  return binaryName; // fallback to relying on PATH
}

const ytDlpPath = getBinaryPath("yt-dlp");
const ffmpegPath = getBinaryPath("ffmpeg");
const ffmpegDir = ffmpegPath.includes("\\") ? ffmpegPath.substring(0, ffmpegPath.lastIndexOf("\\")) : null;
const denoPath = Deno.execPath();

// Ensure default download directory exists
ensureDirectory(DEFAULT_DOWNLOAD_DIR);

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function* getDirFiles(baseDir: string): AsyncGenerator<{ name: string; fullPath: string }> {
  try {
    for await (const entry of Deno.readDir(baseDir)) {
      if (entry.isFile) {
        yield { name: entry.name, fullPath: `${baseDir}\\${entry.name}` };
      } else if (entry.isDirectory && !entry.name.startsWith("$") && !entry.name.startsWith(".")) {
        try {
          for await (const subEntry of Deno.readDir(`${baseDir}\\${entry.name}`)) {
            if (subEntry.isFile) {
              yield { name: subEntry.name, fullPath: `${baseDir}\\${entry.name}\\${subEntry.name}` };
            }
          }
        } catch { }
      }
    }
  } catch { }
}

async function listDownloads(targetDir?: string) {
  const dir = targetDir && targetDir.trim() ? targetDir.trim() : DEFAULT_DOWNLOAD_DIR;
  const files: Array<{ name: string; size: string; sizeBytes: number; mtime: Date | null; path: string }> = [];
  try {
    for await (const item of getDirFiles(dir)) {
      if (!item.name.endsWith(".part") && !item.name.endsWith(".ytdl")) {
        try {
          const stat = await Deno.stat(item.fullPath);
          files.push({
            name: item.name,
            size: formatBytes(stat.size),
            sizeBytes: stat.size,
            mtime: stat.mtime,
            path: item.fullPath
          });
        } catch { }
      }
    }
    // Sort newest first
    files.sort((a, b) => {
      const timeA = a.mtime ? a.mtime.getTime() : 0;
      const timeB = b.mtime ? b.mtime.getTime() : 0;
      return timeB - timeA;
    });
  } catch (err) {
    console.error(`Error reading download directory ${dir}:`, err);
  }
  return files;
}

function formatDuration(sec?: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return "";
  const totalSec = Math.floor(sec);
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    const remM = m % 60;
    return `${h}:${remM.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatViews(views?: number | null): string {
  if (views === null || views === undefined || isNaN(views) || views <= 0) return "";
  if (views >= 1_000_000_000) return (views / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B plays";
  if (views >= 1_000_000) return (views / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M plays";
  if (views >= 1_000) return (views / 1_000).toFixed(1).replace(/\.0$/, "") + "K plays";
  return views.toLocaleString() + " plays";
}

function getBestThumbnail(e: any): string {
  if (!e) return "";
  if (Array.isArray(e.thumbnails) && e.thumbnails.length > 0) {
    const valid = e.thumbnails.filter((t: any) => t && t.url && !t.url.includes("mhtml") && !t.id?.startsWith("sb"));
    if (valid.length > 0) {
      return valid[valid.length - 1].url;
    }
  }
  if (e.thumbnail && typeof e.thumbnail === "string" && !e.thumbnail.includes("mhtml")) {
    return e.thumbnail;
  }
  if (e.id && typeof e.id === "string" && e.id.length === 11) {
    return `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`;
  }
  return "";
}

function parseAuthorAndTitle(rawTitle: string, rawUploader?: string, rawArtist?: string, rawAlbum?: string): { title: string; author: string; album: string } {
  let title = (rawTitle || "").trim();
  let author = (rawArtist || rawUploader || "").trim();
  let album = (rawAlbum || "").trim();

  // If title has "Artist - Track" or "Track - Artist" format
  if (title.includes(" - ")) {
    const parts = title.split(" - ");
    if (parts.length === 2) {
      if (!author) {
        author = parts[0].trim();
        title = parts[1].trim();
      }
    }
  }
  return { title, author, album };
}

// Active Download Sessions for Cancellation
interface ActiveSession {
  id: string;
  process: Deno.ChildProcess | null;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  targetDir: string;
  aborted: boolean;
}

const activeSessions = new Map<string, ActiveSession>();

function isSafeFileNameSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." &&
    !/[<>:"\/\\|?*\u0000-\u001f]/.test(value) && !/[. ]$/.test(value);
}

function sanitizeFileTitle(value: string): string {
  return value
    .replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 160)
    .replace(/[. ]+$/g, "");
}

async function cleanUpPartials(targetDir: string) {
  try {
    for await (const entry of Deno.readDir(targetDir)) {
      if (entry.isFile && (entry.name.endsWith(".part") || entry.name.endsWith(".ytdl") || entry.name.includes(".temp."))) {
        try {
          await Deno.remove(`${targetDir}\\${entry.name}`);
        } catch { }
      }
    }
  } catch { }
}

async function checkIfAlreadyDownloaded(targetDir: string, itemUrl: string, rawId?: string, rawTitle?: string): Promise<string | null> {
  try {
    let id = (rawId && rawId.length === 11) ? rawId : "";
    if (!id && itemUrl) {
      try {
        const u = new URL(itemUrl);
        id = u.searchParams.get("v") || "";
        if (!id && u.hostname.includes("youtu.be")) {
          id = u.pathname.replace(/^\/+/, "").split("/")[0];
        }
      } catch { }
    }

    const cleanTitle = rawTitle ? rawTitle.replace(/[\\/:*?"<>|]/g, "").trim().toLowerCase() : "";
    const mediaExts = [".m4a", ".mp3", ".mp4", ".opus", ".webm", ".flac", ".wav", ".mkv", ".aac"];

    for await (const item of getDirFiles(targetDir)) {
      if (!item.name.endsWith(".part") && !item.name.endsWith(".ytdl")) {
        const lowerName = item.name.toLowerCase();
        const hasMediaExt = mediaExts.some(ext => lowerName.endsWith(ext));
        if (!hasMediaExt) continue;

        let matched = false;
        // Check ID match: [id] or -id. or _id.
        if (id) {
          if (item.name.includes(`[${id}]`) || item.name.includes(id)) {
            matched = true;
          }
        }
        // Check Title match (if title is meaningful, >= 2 chars)
        if (!matched && cleanTitle && cleanTitle.length >= 2) {
          if (
            lowerName.startsWith(cleanTitle + " [") ||
            lowerName.startsWith(cleanTitle + ".") ||
            lowerName.startsWith(cleanTitle + " -") ||
            (cleanTitle.length >= 4 && (lowerName.startsWith(cleanTitle) || lowerName.includes(cleanTitle)))
          ) {
            matched = true;
          }
        }

        if (matched) {
          try {
            const stat = await Deno.stat(item.fullPath);
            if (stat.size > 50 * 1024) { // Valid non-empty media file (> 50KB)
              return item.name;
            }
          } catch { }
        }
      }
    }
  } catch { }
  return null;
}

function buildYtDlpQualityArgs(quality: string): string[] {
  const qArgs: string[] = [];

  switch (quality) {
    case "m4a":
    case "native":
    case "native-audio":
      // Pure YouTube Music AAC stream direct copy (~3.2 MB, 100% loss-free, instant extraction)
      qArgs.push(
        "-f", "ba[ext=m4a]/ba/b",
        "-x",
        "--audio-format", "m4a"
      );
      break;

    case "mp3-opt":
    case "audio":
      // Smart Compressed MP3 (~4.0 MB, LAME VBR ~190kbps preserving 100% YouTube Music acoustic spectrum)
      qArgs.push(
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "2"
      );
      break;

    case "mp3-max":
      // Legacy 320 kbps MP3 (~9-12 MB)
      qArgs.push(
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0"
      );
      break;

    case "best-compressed":
    case "1080p-compressed":
      // 1080p MP4 Smart Compressed (~50-60% smaller file size)
      qArgs.push(
        "-S", "+size,+br,res:1080",
        "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4"
      );
      break;

    case "4k":
      qArgs.push(
        "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4"
      );
      break;

    case "720p":
      // 720p HD (Fast & Compact)
      qArgs.push(
        "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/b",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4"
      );
      break;

    case "480p":
      qArgs.push(
        "-f", "bv*[height<=480][ext=mp4]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]/b",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4"
      );
      break;

    case "best":
    default:
      // 1080p Full HD MP4 (Optimal speed & crystal clear quality)
      qArgs.push(
        "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4"
      );
      break;
  }

  // Always embed metadata & embed thumbnail with JPG conversion for Windows Explorer cover art!
  qArgs.push(
    "--embed-metadata",
    "--embed-thumbnail",
    "--convert-thumbnails", "jpg"
  );

  return qArgs;
}

console.log(`[+] Universal Video Downloader Server starting...`);
console.log(`[+] yt-dlp: ${ytDlpPath}`);
console.log(`[+] FFmpeg: ${ffmpegPath}`);
console.log(`[+] Deno JS Runtime: ${denoPath}`);
console.log(`[+] Default Destination: ${DEFAULT_DOWNLOAD_DIR}`);

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // A loopback listener can still receive requests with an attacker-controlled
  // Host header. Only the address opened by the launcher may use these APIs.
  if (url.hostname !== "127.0.0.1" || Number(url.port) !== activePort) {
    return new Response("Forbidden", { status: 403 });
  }

  // Reject browser requests from non-loopback origins to prevent cross-site access
  // to the local file and process APIs. Non-browser clients may omit Origin.
  const originHeader = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return new Response("Forbidden", { status: 403 });
  }
  if (originHeader) {
    try {
      const origin = new URL(originHeader);
      const hostname = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
      if (origin.protocol !== "http:" || origin.host !== url.host || !isLoopback) {
        return new Response("Forbidden", { status: 403 });
      }
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  }

  // Serve static HTML frontend
  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      const htmlPath = new URL("../public/index.html", import.meta.url);
      const html = await Deno.readTextFile(htmlPath);
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("Frontend index.html not found.", { status: 404 });
    }
  }

  // Get status & system info
  if (url.pathname === "/api/status" && req.method === "GET") {
    return new Response(JSON.stringify({
      app: "universal-video-downloader",
      version: APP_VERSION,
      downloadDir: DEFAULT_DOWNLOAD_DIR,
      systemPresets: SYSTEM_PRESETS,
      ytDlp: ytDlpPath,
      ffmpeg: ffmpegPath,
      port: activePort,
      ready: true
    }), {
      headers: { "content-type": "application/json" }
    });
  }

  // Open native Windows Folder Picker dialog (with STA mode and timeout)
  if (url.pathname === "/api/select-folder" && req.method === "POST") {
    let currentDir = "";
    try {
      const body = await req.json();
      if (body.currentDir && typeof body.currentDir === "string") {
        currentDir = body.currentDir.trim();
      }
    } catch { }

    try {
      const safeInit = (currentDir || DEFAULT_DOWNLOAD_DIR).replace(/'/g, "''");
      const psCommand = [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$f = New-Object System.Windows.Forms.FolderBrowserDialog;",
        "$f.Description = 'Select Media Save Destination Folder';",
        "$f.ShowNewFolderButton = $true;",
        `if (Test-Path -LiteralPath '${safeInit}') { $f.SelectedPath = '${safeInit}' };`,
        "$form = New-Object System.Windows.Forms.Form;",
        "$form.TopMost = $true;",
        "$form.WindowState = [System.Windows.Forms.FormWindowState]::Minimized;",
        "[void]$form.Show();",
        "[void]$form.Activate();",
        "$res = $f.ShowDialog($form);",
        "if ($res -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) };",
        "$form.Close()"
      ].join(" ");

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 35000); // 35s max timeout to prevent hangs

      const proc = new Deno.Command("powershell.exe", {
        args: ["-Sta", "-NoProfile", "-Command", psCommand],
        stdout: "piped",
        stderr: "piped",
        signal: ac.signal
      });

      const output = await proc.output();
      clearTimeout(timer);
      const selected = new TextDecoder().decode(output.stdout).trim();

      if (selected) {
        ensureDirectory(selected);
        return new Response(JSON.stringify({ success: true, folder: selected }), {
          headers: { "content-type": "application/json" }
        });
      } else {
        return new Response(JSON.stringify({ success: false, cancelled: true }), {
          headers: { "content-type": "application/json" }
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  // Interactive in-browser File Explorer folder navigator
  if (url.pathname === "/api/browse-dir" && req.method === "POST") {
    let reqPath = "";
    try {
      const body = await req.json();
      if (body.path && typeof body.path === "string") reqPath = body.path.trim();
    } catch { }

    const targetDir = reqPath || DEFAULT_DOWNLOAD_DIR;
    ensureDirectory(targetDir);

    const subdirs: string[] = [];
    try {
      for await (const entry of Deno.readDir(targetDir)) {
        if (entry.isDirectory && !entry.name.startsWith("$") && !entry.name.startsWith(".")) {
          subdirs.push(entry.name);
        }
      }
      subdirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    } catch (err) {
      console.error(`Cannot read subdirs in ${targetDir}:`, err);
    }

    // Determine parent folder
    let parent: string | null = null;
    const norm = targetDir.replace(/[\/\\]+$/, "");
    const lastSlash = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    if (lastSlash > 2) {
      parent = norm.substring(0, lastSlash);
    } else if (lastSlash === 2) {
      parent = norm.substring(0, 3); // e.g. "C:\"
    }

    // Discover active Windows drives
    const drives: string[] = [];
    for (const d of ["C", "D", "E", "F", "G"]) {
      try {
        if (Deno.statSync(`${d}:\\`).isDirectory) drives.push(`${d}:\\`);
      } catch { }
    }

    return new Response(JSON.stringify({
      success: true,
      current: targetDir,
      parent,
      drives,
      subdirs,
      presets: SYSTEM_PRESETS
    }), {
      headers: { "content-type": "application/json" }
    });
  }

  // Create new folder in active directory
  if (url.pathname === "/api/create-dir" && req.method === "POST") {
    try {
      const body = await req.json();
      const parent = typeof body.parent === "string" ? body.parent.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!parent || !name) {
        return new Response(JSON.stringify({ success: false, error: "Parent path and folder name required" }), { status: 400 });
      }
      if (name.length > 120 || name === "." || name === ".." || /[<>:"\/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
        return new Response(JSON.stringify({ success: false, error: "Folder name contains unsupported characters" }), { status: 400 });
      }
      const newPath = `${parent.replace(/[\/\\]+$/, "")}\\${name}`;
      Deno.mkdirSync(newPath, { recursive: true });
      return new Response(JSON.stringify({ success: true, path: newPath }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500 });
    }
  }

  // Get recent downloads (optionally for a specific folder)
  if (url.pathname === "/api/history" && req.method === "GET") {
    const targetDir = url.searchParams.get("dir") || DEFAULT_DOWNLOAD_DIR;
    const files = await listDownloads(targetDir);
    return new Response(JSON.stringify({ dir: targetDir, files }), {
      headers: { "content-type": "application/json" }
    });
  }

  // Open download folder in Windows Explorer
  if (url.pathname === "/api/open-folder" && req.method === "POST") {
    let targetDir = DEFAULT_DOWNLOAD_DIR;
    try {
      const body = await req.json();
      if (body.dir && typeof body.dir === "string" && body.dir.trim()) {
        targetDir = body.dir.trim();
      }
    } catch { }

    try {
      ensureDirectory(targetDir);
      new Deno.Command("explorer.exe", { args: [targetDir] }).spawn();
      return new Response(JSON.stringify({ success: true, dir: targetDir }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500 });
    }
  }

  // Check which tracks are already downloaded on disk in targetDir
  if (url.pathname === "/api/check-downloaded" && req.method === "POST") {
    try {
      const body = await req.json();
      const targetDir = ensureDirectory(body.dir);
      const items = Array.isArray(body.items) ? body.items : [];
      const completedIds: string[] = [];
      const completedUrls: string[] = [];
      const existingFileMap: Record<string, string> = {};

      for (const item of items) {
        if (!item) continue;
        const existing = await checkIfAlreadyDownloaded(targetDir, item.url || "", item.id, item.title);
        if (existing) {
          if (item.id) completedIds.push(item.id);
          if (item.url) completedUrls.push(item.url);
          existingFileMap[item.url || item.id] = existing;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        dir: targetDir,
        completedCount: completedUrls.length,
        completedIds,
        completedUrls,
        existingFileMap
      }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500 });
    }
  }

  // Stop / Cancel active download at any time
  if (url.pathname === "/api/stop-download" && req.method === "POST") {
    let body: { sessionId?: string };
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const targetId = body.sessionId?.trim();
    let stoppedCount = 0;

    for (const [id, session] of activeSessions.entries()) {
      if (!targetId || id === targetId) {
        session.aborted = true;
        const proc = session.process;
        if (proc) {
          try {
            // Forcefully terminate the downloader process and its children on Windows
            new Deno.Command("taskkill", {
              args: ["/F", "/T", "/PID", String(proc.pid)],
              stdout: "null",
              stderr: "null"
            }).spawn();
          } catch {
            try { proc.kill(); } catch { }
          }
        }
        try {
          const ctrl = session.controller;
          if (ctrl) {
            const payload = `event: stopped\ndata: ${JSON.stringify({ message: "Download cancelled by user." })}\n\n`;
            ctrl.enqueue(new TextEncoder().encode(payload));
            ctrl.close();
          }
        } catch { }

        // Note: Do not cleanUpPartials so in-progress downloads can resume later!
        activeSessions.delete(id);
        stoppedCount++;
      }
    }

    return new Response(JSON.stringify({ success: true, stopped: stoppedCount }), {
      headers: { "content-type": "application/json" }
    });
  }

  // Single video info preview endpoint
  if (url.pathname === "/api/video-info" && req.method === "POST") {
    let body: { url?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
    const targetUrl = body.url?.trim();
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "URL is required" }), { status: 400 });
    }

    try {
      const infoArgs = ["--flat-playlist", "-J", "--no-warnings"];
      if (denoPath) {
        infoArgs.push("--js-runtimes", `deno:${denoPath}`);
      }
      infoArgs.push(targetUrl);
      const proc = new Deno.Command(ytDlpPath, {
        args: infoArgs,
        stdout: "piped",
        stderr: "piped"
      });
      const output = await proc.output();
      if (!output.success) {
        return new Response(JSON.stringify({ success: false, error: "Unable to inspect video" }), { status: 500 });
      }
      const data = JSON.parse(new TextDecoder().decode(output.stdout));
      const parsed = parseAuthorAndTitle(data.title || "", data.uploader || data.channel, data.artist, data.album);
      return new Response(JSON.stringify({
        success: true,
        id: data.id || "",
        title: parsed.title,
        author: parsed.author,
        album: parsed.album,
        duration: formatDuration(typeof data.duration === "number" ? data.duration : undefined),
        thumbnail: getBestThumbnail(data),
        url: data.webpage_url || targetUrl
      }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500 });
    }
  }

  // Extract video links from webpage, playlist, or pasted text
  if (url.pathname === "/api/extract-links" && req.method === "POST") {
    let body: { url?: string; rawText?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }

    // Direct multi-link text input
    if (body.rawText && body.rawText.trim()) {
      const rawLines = body.rawText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && (l.startsWith("http://") || l.startsWith("https://")));

      const entries = rawLines.map((u, i) => ({
        id: `manual-${i + 1}`,
        title: `Link #${i + 1}`,
        author: new URL(u).hostname,
        album: "",
        duration: "",
        thumbnail: "",
        url: u
      }));

      return new Response(JSON.stringify({
        success: true,
        playlist: null,
        count: entries.length,
        entries
      }), {
        headers: { "content-type": "application/json" }
      });
    }

    const targetUrl = body.url?.trim();
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "URL is required" }), { status: 400 });
    }

    try {
      const extractArgs = ["--flat-playlist", "-J", "--no-warnings"];
      if (denoPath) {
        extractArgs.push("--js-runtimes", `deno:${denoPath}`);
      }
      extractArgs.push(targetUrl);
      const proc = new Deno.Command(ytDlpPath, {
        args: extractArgs,
        stdout: "piped",
        stderr: "piped"
      });
      const output = await proc.output();
      if (!output.success) {
        const errStr = new TextDecoder().decode(output.stderr);
        return new Response(JSON.stringify({ success: false, error: errStr || "Extraction failed" }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }

      const data = JSON.parse(new TextDecoder().decode(output.stdout));
      let entries: Array<{
        id: string;
        title: string;
        author: string;
        album: string;
        duration: string;
        thumbnail: string;
        url: string;
        viewCount?: number | null;
        viewCountFormatted?: string;
        rank?: number;
        originalIndex?: number;
      }> = [];

      const playlistTitle = data.title || "";
      const playlistAuthor = data.uploader || data.channel || "";

      if (Array.isArray(data.entries) && data.entries.length > 0) {
        entries = data.entries.map((e: Record<string, any>, idx: number) => {
          const parsed = parseAuthorAndTitle(
            String(e.title || `Track #${idx + 1}`),
            e.uploader || e.channel,
            e.artist,
            e.album || playlistTitle
          );
          const rawViews = typeof e.view_count === "number" && e.view_count > 0 ? e.view_count : null;
          return {
            id: String(e.id || idx + 1),
            title: parsed.title,
            author: parsed.author,
            album: parsed.album,
            duration: formatDuration(typeof e.duration === "number" ? e.duration : undefined),
            thumbnail: getBestThumbnail(e),
            url: String(e.url || e.webpage_url || e.id),
            viewCount: rawViews,
            viewCountFormatted: formatViews(rawViews),
            originalIndex: idx
          };
        });

        // Assign initial ranks to entries with viewCount
        const withViews = entries
          .map((e, idx) => ({ idx, views: e.viewCount || 0 }))
          .filter(e => e.views > 0)
          .sort((a, b) => b.views - a.views);

        withViews.forEach((item, rankIdx) => {
          (entries[item.idx] as any).rank = rankIdx + 1;
        });
      } else if (data.id || data.title) {
        const parsed = parseAuthorAndTitle(
          String(data.title || "Video 1"),
          data.uploader || data.channel,
          data.artist,
          data.album
        );
        const rawViews = typeof data.view_count === "number" && data.view_count > 0 ? data.view_count : null;
        entries = [{
          id: String(data.id || "1"),
          title: parsed.title,
          author: parsed.author,
          album: parsed.album,
          duration: formatDuration(typeof data.duration === "number" ? data.duration : undefined),
          thumbnail: getBestThumbnail(data),
          url: String(data.webpage_url || targetUrl),
          viewCount: rawViews,
          viewCountFormatted: formatViews(rawViews),
          rank: 1,
          originalIndex: 0
        }];
      }

      const playlistInfo = {
        title: playlistTitle,
        author: playlistAuthor,
        thumbnail: getBestThumbnail(data) || (entries.length > 0 ? entries[0].thumbnail : ""),
        trackCount: entries.length
      };

      return new Response(JSON.stringify({
        success: true,
        playlist: playlistInfo,
        count: entries.length,
        entries
      }), {
        headers: { "content-type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: String(err) }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  const globalViewsCache = new Map<string, { viewCount: number; viewCountFormatted: string; author?: string; album?: string; thumbnail?: string }>();

  // Fetch views and ranks for an array of items/videoIds from YouTube / YouTube Music
  if (url.pathname === "/api/fetch-views" && req.method === "POST") {
    try {
      const body = await req.json();
      const items: Array<{ id?: string; url?: string; originalIndex?: number }> = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        return new Response(JSON.stringify({ success: true, viewsMap: {} }), { headers: { "content-type": "application/json" } });
      }

      const viewsMap: Record<string, { viewCount: number; viewCountFormatted: string }> = {};

      // Check cache first
      const pending: Array<{ id: string; url?: string }> = [];
      for (const item of items) {
        let vid = (item.id && item.id.length === 11) ? item.id : "";
        if (!vid && item.url) {
          try {
            const u = new URL(item.url);
            vid = u.searchParams.get("v") || "";
            if (!vid && u.hostname.includes("youtu.be")) {
              vid = u.pathname.replace(/^\/+/, "").split("/")[0];
            }
          } catch { }
        }
        if (vid && vid.length === 11) {
          if (globalViewsCache.has(vid)) {
            const cached = globalViewsCache.get(vid)!;
            viewsMap[vid] = cached;
            if (item.url) viewsMap[item.url] = cached;
          } else {
            pending.push({ id: vid, url: item.url });
          }
        }
      }

      // Process pending in concurrent chunks of 20
      const chunkSize = 20;
      for (let i = 0; i < pending.length; i += chunkSize) {
        const chunk = pending.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (item) => {
          const vid = item.id;
          try {
            const res = await fetch("https://music.youtube.com/youtubei/v1/player", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00" } },
                videoId: vid
              })
            });
            const data = await res.json();
            const rawViews = parseInt(data.videoDetails?.viewCount || "0");
            if (rawViews > 0) {
              const info = {
                viewCount: rawViews,
                viewCountFormatted: formatViews(rawViews),
                author: data.videoDetails?.author,
                thumbnail: Array.isArray(data.videoDetails?.thumbnail?.thumbnails) && data.videoDetails.thumbnail.thumbnails.length > 0
                  ? data.videoDetails.thumbnail.thumbnails[data.videoDetails.thumbnail.thumbnails.length - 1].url
                  : undefined
              };
              globalViewsCache.set(vid, info);
              viewsMap[vid] = info;
              if (item.url) viewsMap[item.url] = info;
            }
          } catch { }
        }));
      }

      return new Response(JSON.stringify({ success: true, viewsMap }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  // Scan a local folder for media tracks, parse IDs/metadata, batch fetch play counts & popularity ranks
  if (url.pathname === "/api/scan-folder" && req.method === "POST") {
    try {
      let body: { dir?: string; skipViews?: boolean } = {};
      try {
        body = await req.json();
      } catch { }

      const targetDir = ensureDirectory(body.dir);
      const mediaExts = [".m4a", ".mp3", ".mp4", ".opus", ".webm", ".flac", ".wav", ".aac", ".mkv"];
      const imageExts = [".jpg", ".jpeg", ".webp", ".png"];

      interface LocalTrack {
        filename: string;
        fullPath: string;
        cleanTitle: string;
        id: string;
        ext: string;
        size: string;
        sizeBytes: number;
        mtime: Date | null;
        existingPrefix: number | null;
        existingRank: number | null;
        thumbnail: string;
        viewCount: number | null;
        viewCountFormatted: string;
        rank: number | null;
        author?: string;
        album?: string;
      }

      const rawFiles: Array<{ name: string; fullPath: string; stat: Deno.FileInfo }> = [];
      const imageMap = new Map<string, string>(); // base/id -> image filename

      for await (const entry of Deno.readDir(targetDir)) {
        if (!entry.isFile) continue;
        if (entry.name.endsWith(".part") || entry.name.endsWith(".ytdl") || entry.name.includes(".temp.")) continue;

        const lower = entry.name.toLowerCase();
        const hasMedia = mediaExts.some(e => lower.endsWith(e));
        if (hasMedia) {
          try {
            const fullPath = `${targetDir}\\${entry.name}`;
            const stat = await Deno.stat(fullPath);
            rawFiles.push({ name: entry.name, fullPath, stat });
          } catch { }
        } else {
          const hasImage = imageExts.some(e => lower.endsWith(e));
          if (hasImage) {
            const base = entry.name.substring(0, entry.name.lastIndexOf("."));
            imageMap.set(base.toLowerCase(), entry.name);
            const idMatch = base.match(/\[([a-zA-Z0-9_-]{11})\]/);
            if (idMatch) {
              imageMap.set(idMatch[1], entry.name);
            }
          }
        }
      }

      const tracks: LocalTrack[] = [];

      for (const item of rawFiles) {
        const ext = item.name.substring(item.name.lastIndexOf("."));
        const baseName = item.name.substring(0, item.name.lastIndexOf("."));

        // Match 11-char YouTube ID
        let id = "";
        const idMatch = baseName.match(/\[([a-zA-Z0-9_-]{11})\]$/) || baseName.match(/\[([a-zA-Z0-9_-]{11})\]/);
        if (idMatch) {
          id = idMatch[1];
        } else {
          const trailingMatch = baseName.match(/[-_\s]([a-zA-Z0-9_-]{11})$/);
          if (trailingMatch) id = trailingMatch[1];
        }

        // Parse existing rank prefix: e.g. "01. [Rank #1] Song Title" or "01. Song Title"
        let cleanBase = baseName;
        let existingPrefix: number | null = null;
        let existingRank: number | null = null;

        const rankPrefixMatch = cleanBase.match(/^(\d+)\.\s*(?:\[Rank\s*#?(\d+)\]\s*)?(.*)$/i);
        if (rankPrefixMatch) {
          existingPrefix = parseInt(rankPrefixMatch[1], 10);
          if (rankPrefixMatch[2]) {
            existingRank = parseInt(rankPrefixMatch[2], 10);
          }
          cleanBase = rankPrefixMatch[3].trim();
        }

        // Remove [id] from clean title
        let cleanTitle = cleanBase;
        if (id) {
          cleanTitle = cleanTitle.replace(new RegExp(`\\s*\\[${id}\\]\\s*$`), "").trim();
          cleanTitle = cleanTitle.replace(new RegExp(`\\s*[-_]?${id}\\s*$`), "").trim();
        }

        // Resolve thumbnail
        let thumbnail = "";
        if (id) {
          thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        }
        // Local companion image if exists
        const localImg = imageMap.get(baseName.toLowerCase()) || (id ? imageMap.get(id) : null);
        if (localImg) {
          thumbnail = `/api/local-art?path=${encodeURIComponent(`${targetDir}\\${localImg}`)}`;
        }

        tracks.push({
          filename: item.name,
          fullPath: item.fullPath,
          cleanTitle: cleanTitle || baseName,
          id,
          ext,
          size: formatBytes(item.stat.size),
          sizeBytes: item.stat.size,
          mtime: item.stat.mtime,
          existingPrefix,
          existingRank,
          thumbnail,
          viewCount: null,
          viewCountFormatted: "",
          rank: null
        });
      }

      // 1. ALWAYS populate from in-memory cache first (instant, works even if skipViews is true)
      const pending: LocalTrack[] = [];
      for (const t of tracks) {
        if (!t.id) continue;
        if (globalViewsCache.has(t.id)) {
          const cached = globalViewsCache.get(t.id)!;
          t.viewCount = cached.viewCount;
          t.viewCountFormatted = cached.viewCountFormatted;
          if (cached.author) t.author = cached.author;
          if (!t.thumbnail.startsWith("/api/") && cached.thumbnail) t.thumbnail = cached.thumbnail;
        } else {
          pending.push(t);
        }
      }

      // 2. Fetch remaining play counts from YouTube Music player API (unless skipViews is explicitly requested)
      if (!body.skipViews && pending.length > 0) {
        const chunkSize = 20;
        for (let i = 0; i < pending.length; i += chunkSize) {
          const chunk = pending.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (t) => {
            if (!t.id) return;
            try {
              const res = await fetch("https://music.youtube.com/youtubei/v1/player", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00" } },
                  videoId: t.id
                })
              });
              const data = await res.json();
              const rawViews = parseInt(data.videoDetails?.viewCount || "0");
              if (rawViews > 0) {
                t.viewCount = rawViews;
                t.viewCountFormatted = formatViews(rawViews);
                if (data.videoDetails?.author) {
                  t.author = data.videoDetails.author;
                }
                let highResThumb = "";
                if (Array.isArray(data.videoDetails?.thumbnail?.thumbnails)) {
                  const thumbs = data.videoDetails.thumbnail.thumbnails;
                  if (thumbs.length > 0) highResThumb = thumbs[thumbs.length - 1].url;
                }
                if (!t.thumbnail.startsWith("/api/") && highResThumb) {
                  t.thumbnail = highResThumb;
                }
                globalViewsCache.set(t.id, {
                  viewCount: rawViews,
                  viewCountFormatted: formatViews(rawViews),
                  author: data.videoDetails?.author,
                  thumbnail: highResThumb
                });
              }
            } catch { }
          }));
        }
      }

      // 3. Compute popularity rank based on viewCount, with existingRank as secondary fallback
      const rankedIndices = tracks
        .map((t, idx) => ({ idx, viewCount: t.viewCount || 0, existingRank: t.existingRank || 9999 }))
        .sort((a, b) => {
          if (b.viewCount !== a.viewCount) return b.viewCount - a.viewCount;
          return a.existingRank - b.existingRank;
        });

      rankedIndices.forEach((item, rankIdx) => {
        if (tracks[item.idx].viewCount && tracks[item.idx].viewCount! > 0) {
          tracks[item.idx].rank = rankIdx + 1;
        } else if (tracks[item.idx].existingRank) {
          tracks[item.idx].rank = tracks[item.idx].existingRank;
        }
      });

      // 4. Compute total views and find top track
      let totalViews = 0;
      let topTrack: LocalTrack | null = null;
      for (const t of tracks) {
        if (t.viewCount) {
          totalViews += t.viewCount;
          if (!topTrack || (t.viewCount > (topTrack.viewCount || 0))) {
            topTrack = t;
          }
        }
      }

      if (!topTrack && tracks.length > 0) {
        topTrack = tracks.find(t => t.rank === 1 || t.existingRank === 1) || tracks[0];
      }

      return new Response(JSON.stringify({
        success: true,
        folder: targetDir,
        count: tracks.length,
        totalViews,
        totalViewsFormatted: formatViews(totalViews),
        topTrack,
        tracks
      }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  // Reorder/rename files directly on disk (Apply Rank Prefix or Remove Rank Prefix)
  if (url.pathname === "/api/reorder-folder" && req.method === "POST") {
    try {
      const body = await req.json();
      const targetDir = ensureDirectory(body.dir);
      const action: "apply-rank" | "remove-rank" = body.action === "remove-rank" ? "remove-rank" : "apply-rank";
      const tracks: Array<{ filename: string; rank?: number; cleanTitle?: string; id?: string }> = Array.isArray(body.tracks) ? body.tracks : [];

      if (tracks.length === 0) {
        return new Response(JSON.stringify({ success: false, error: "No tracks provided to reorder" }), { status: 400 });
      }

      // Padded rank width (01 vs 001)
      const padWidth = tracks.length >= 100 ? 3 : 2;

      interface RenamePlan {
        currentFilename: string;
        targetFilename: string;
      }

      const renamePlans: RenamePlan[] = [];

      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (!t || typeof t !== "object" || typeof t.filename !== "string" || !isSafeFileNameSegment(t.filename)) {
          return new Response(JSON.stringify({ success: false, error: "Track filename is invalid" }), { status: 400 });
        }

        const extMatch = t.filename.match(/\.[A-Za-z0-9]{1,10}$/);
        if (!extMatch) {
          return new Response(JSON.stringify({ success: false, error: `Track filename has no supported extension: ${t.filename}` }), { status: 400 });
        }
        const ext = extMatch[0];
        const baseName = t.filename.substring(0, t.filename.length - ext.length);

        // Match id if not provided
        let id = typeof t.id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(t.id) ? t.id : "";
        if (!id) {
          const idMatch = baseName.match(/\[([a-zA-Z0-9_-]{11})\]$/) || baseName.match(/\[([a-zA-Z0-9_-]{11})\]/);
          if (idMatch) id = idMatch[1];
        }

        // Clean base: remove existing rank prefix
        const cleanBase = baseName.replace(/^(\d+)\.\s*(?:\[Rank\s*#?(\d+)\]\s*)?/i, "").trim();
        // Remove trailing [id] if cleanTitle isn't given
        let cleanTitle = typeof t.cleanTitle === "string" ? t.cleanTitle : cleanBase;
        if (id) {
          cleanTitle = cleanTitle.replace(new RegExp(`\\s*\\[${id}\\]\\s*$`), "").trim();
          cleanTitle = cleanTitle.replace(new RegExp(`\\s*[-_]?${id}\\s*$`), "").trim();
        }
        cleanTitle = sanitizeFileTitle(cleanTitle);
        if (!cleanTitle) {
          return new Response(JSON.stringify({ success: false, error: "Track title is empty after filename cleanup" }), { status: 400 });
        }
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleanTitle)) {
          cleanTitle = `_${cleanTitle}`;
        }

        const idSuffix = id ? ` [${id}]` : "";
        let targetFilename = "";

        if (action === "apply-rank") {
          // Use track.rank or index + 1
          const rankNum = typeof t.rank === "number" && Number.isSafeInteger(t.rank) && t.rank > 0 && t.rank <= 999999999 ? t.rank : (i + 1);
          const padRank = String(rankNum).padStart(padWidth, "0");
          targetFilename = `${padRank}. [Rank #${rankNum}] ${cleanTitle}${idSuffix}${ext}`;
        } else {
          // remove-rank: plain clean name
          targetFilename = `${cleanTitle}${idSuffix}${ext}`;
        }

        renamePlans.push({
          currentFilename: t.filename,
          targetFilename
        });

        // Also check if companion image (.jpg, .webp, .png) exists and plan to rename it
        for (const imgExt of [".jpg", ".jpeg", ".webp", ".png"]) {
          const currentImgName = `${baseName}${imgExt}`;
          try {
            if (Deno.statSync(`${targetDir}\\${currentImgName}`).isFile) {
              const targetImgName = targetFilename.substring(0, targetFilename.lastIndexOf(".")) + imgExt;
              renamePlans.push({
                currentFilename: currentImgName,
                targetFilename: targetImgName
              });
            }
          } catch { }
        }
      }

      // Two-pass collision-proof renaming
      const needsRename = renamePlans.filter(p => p.currentFilename !== p.targetFilename);
      const stagingMap: Array<{ stagingPath: string; finalPath: string; originalPath: string }> = [];
      const timestamp = Date.now();

      // Pass 1: Rename to temporary unique staging files
      for (let i = 0; i < needsRename.length; i++) {
        const item = needsRename[i];
        const origPath = `${targetDir}\\${item.currentFilename}`;
        const stagingPath = `${targetDir}\\__tmp_reorder_${timestamp}_${i}__.tmp`;
        const finalPath = `${targetDir}\\${item.targetFilename}`;

        try {
          await Deno.rename(origPath, stagingPath);
          stagingMap.push({ stagingPath, finalPath, originalPath: origPath });
        } catch (err) {
          console.error(`Error in Pass 1 staging rename: ${origPath}`, err);
        }
      }

      // Pass 2: Rename from staging to target names
      let renamedCount = 0;
      for (const entry of stagingMap) {
        try {
          await Deno.rename(entry.stagingPath, entry.finalPath);
          renamedCount++;
        } catch (err) {
          console.error(`Error in Pass 2 final rename: ${entry.stagingPath} -> ${entry.finalPath}`, err);
          // Attempt rollback if final rename fails
          try {
            await Deno.rename(entry.stagingPath, entry.originalPath);
          } catch { }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        action,
        renamedCount,
        message: `Successfully renamed ${renamedCount} file(s) on disk.`
      }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  // Open Windows Explorer and highlight specific file
  if (url.pathname === "/api/reveal-file" && req.method === "POST") {
    try {
      const body = await req.json();
      let targetPath = body.path ? String(body.path).trim() : "";
      if (!targetPath && body.dir && body.filename) {
        targetPath = `${String(body.dir).trim()}\\${String(body.filename).trim()}`;
      }
      if (!targetPath) {
        return new Response(JSON.stringify({ success: false, error: "Path or dir+filename required" }), { status: 400 });
      }

      // Spawn Explorer with /select,path
      new Deno.Command("explorer.exe", {
        args: [`/select,${targetPath}`]
      }).spawn();

      return new Response(JSON.stringify({ success: true, path: targetPath }), {
        headers: { "content-type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }

  // Serve local thumbnail image safely
  if (url.pathname === "/api/local-art" && req.method === "GET") {
    try {
      const filePath = url.searchParams.get("path");
      if (!filePath) return new Response("File path missing", { status: 400 });
      const lower = filePath.toLowerCase();
      let contentType = "image/jpeg";
      if (lower.endsWith(".png")) contentType = "image/png";
      else if (lower.endsWith(".webp")) contentType = "image/webp";
      else if (!lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) {
        return new Response("Invalid image type", { status: 400 });
      }

      const fileData = await Deno.readFile(filePath);
      return new Response(fileData, {
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=86400"
        }
      });
    } catch {
      return new Response("Image not found", { status: 404 });
    }
  }

  // Bulk download multiple URLs with real-time SSE progress
  if (url.pathname === "/api/bulk-download" && req.method === "POST") {
    let body: {
      urls?: string[];
      items?: Array<{ url: string; title?: string; author?: string; album?: string; thumbnail?: string; rank?: number; id?: string; originalIndex?: number }>;
      quality?: string;
      dir?: string;
      sessionId?: string;
      numberByRank?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }

    const targetDir = ensureDirectory(body.dir);
    const itemsToDownload: Array<{ url: string; title?: string; author?: string; album?: string; thumbnail?: string; rank?: number; id?: string; originalIndex?: number }> = [];

    if (Array.isArray(body.items) && body.items.length > 0) {
      for (const it of body.items) {
        if (it && it.url && it.url.trim()) {
          itemsToDownload.push({
            url: it.url.trim(),
            title: it.title,
            author: it.author,
            album: it.album,
            thumbnail: it.thumbnail,
            id: (it as any).id,
            originalIndex: (it as any).originalIndex,
            rank: (it as any).rank
          } as any);
        }
      }
    } else if (Array.isArray(body.urls) && body.urls.length > 0) {
      for (const u of body.urls) {
        if (u && u.trim()) {
          itemsToDownload.push({ url: u.trim() });
        }
      }
    }

    const quality = body.quality || "m4a";
    const sessionId = body.sessionId || crypto.randomUUID();

    if (itemsToDownload.length === 0) {
      return new Response(JSON.stringify({ error: "No items provided for bulk download" }), { status: 400 });
    }

    const session: ActiveSession = {
      id: sessionId,
      process: null,
      controller: null,
      targetDir,
      aborted: false
    };
    activeSessions.set(sessionId, session);

    const bodyStream = new ReadableStream({
      async start(controller) {
        session.controller = controller;

        const sendEvent = (event: string, data: Record<string, unknown> | string) => {
          if (session.aborted && event !== "stopped") return;
          try {
            const payload = `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(payload));
          } catch { }
        };

        // Stream keep-alive ping every 10 seconds to prevent proxy / router / OS idle timeouts
        const pingTimer = setInterval(() => {
          if (!session.aborted) {
            sendEvent("ping", { t: Date.now() });
          }
        }, 10000);

        sendEvent("session", { sessionId });
        sendEvent("log", { message: `Starting bulk download of ${itemsToDownload.length} track(s)...`, type: "info" });
        sendEvent("log", { message: `Quality preset: ${quality}`, type: "info" });
        sendEvent("log", { message: `Target folder: ${targetDir}`, type: "info" });

        let completed = 0;
        let failed = 0;

        try {
          for (let i = 0; i < itemsToDownload.length; i++) {
            if (session.aborted) {
              sendEvent("log", { message: "Bulk download interrupted by user.", type: "error" });
              break;
            }

            const currentItem = itemsToDownload[i];
            const itemUrl = currentItem.url;
            const effectiveIndex = (currentItem as any).originalIndex !== undefined ? ((currentItem as any).originalIndex + 1) : (i + 1);

            // Check if file is already completely downloaded in destination directory (smart resume)
            const existingFile = await checkIfAlreadyDownloaded(targetDir, itemUrl, (currentItem as any).id, currentItem.title);
            if (existingFile) {
              completed++;
              sendEvent("log", {
                message: `[${i + 1}/${itemsToDownload.length}] Already downloaded: ${existingFile} (Skipping / Resumed)`,
                type: "info"
              });
              sendEvent("item-done", {
                index: effectiveIndex,
                batchIndex: i + 1,
                total: itemsToDownload.length,
                success: true,
                skipped: true,
                url: itemUrl,
                title: currentItem.title || "",
                filename: existingFile
              });
              continue;
            }

            sendEvent("item-start", {
              index: effectiveIndex,
              batchIndex: i + 1,
              total: itemsToDownload.length,
              url: itemUrl,
              title: currentItem.title || "",
              author: currentItem.author || "",
              album: currentItem.album || "",
              thumbnail: currentItem.thumbnail || "",
              dir: targetDir
            });

            sendEvent("log", {
              message: `[${i + 1}/${itemsToDownload.length}] Downloading: ${currentItem.title || itemUrl}`,
              type: "info"
            });

            const rankPrefix = (body.numberByRank && (currentItem as any).rank)
              ? `${String((currentItem as any).rank).padStart(2, "0")}. [Rank #${(currentItem as any).rank}] `
              : "";

            const args: string[] = [
              "-P", targetDir,
              "-o", `${rankPrefix}%(title)s [%(id)s].%(ext)s`,
              "--windows-filenames",
              "--no-mtime",
              "--newline",
              "--continue",
              "--no-overwrites",
              "--retries", "25",
              "--fragment-retries", "25",
              "--retry-sleep", "exp=1:30",
              "--socket-timeout", "30",
              "-N", "4",
              "--buffer-size", "16M",
              "--throttled-rate", "100K"
            ];

            if (ffmpegDir) {
              args.push("--ffmpeg-location", ffmpegDir);
            }
            if (denoPath) {
              args.push("--js-runtimes", `deno:${denoPath}`);
            }

            args.push(...buildYtDlpQualityArgs(quality));
            args.push(itemUrl);

            try {
              const command = new Deno.Command(ytDlpPath, {
                args,
                stdout: "piped",
                stderr: "piped"
              });

              const process = command.spawn();
              session.process = process;

              const readStream = async (stream: ReadableStream<Uint8Array>, isError: boolean) => {
                const reader = stream.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (!session.aborted) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split(/\r?\n/);
                  buffer = lines.pop() || "";

                  for (const line of lines) {
                    if (!line.trim() || session.aborted) continue;
                    const downloadMatch = line.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?([\d\.]+\w+)\s+at\s+([\d\.]+\w+\/s)\s+ETA\s+([\d:]+)/i);
                    if (downloadMatch) {
                      sendEvent("progress", {
                        itemIndex: effectiveIndex,
                        batchIndex: i + 1,
                        totalItems: itemsToDownload.length,
                        percent: parseFloat(downloadMatch[1]),
                        totalSize: downloadMatch[2],
                        speed: downloadMatch[3],
                        eta: downloadMatch[4]
                      });
                    }
                    sendEvent("log", {
                      message: line,
                      type: isError ? "error" : "stdout"
                    });
                  }
                }
              };

              await Promise.all([
                readStream(process.stdout, false),
                readStream(process.stderr, true),
              ]);

              const status = await process.status;
              session.process = null;

              if (session.aborted) {
                break;
              }

              let succeeded = status.success;

              // Automatic Audio Extraction Fallback:
              // If direct URL failed (e.g. Video unavailable or HTTP 403) and song has a title,
              // automatically search YouTube for the official audio track and extract it!
              if (!succeeded && !session.aborted && currentItem.title && ["audio", "m4a", "mp3-opt", "mp3-max"].includes(quality)) {
                const searchArtist = currentItem.author ? `${currentItem.author} ` : "";
                const cleanSongTitle = currentItem.title.replace(/[\\/:*?"<>|]/g, "").trim();
                const searchQuery = `ytsearch1:${searchArtist}${cleanSongTitle} audio`;

                sendEvent("log", {
                  message: `[Audio Fallback] Video unavailable. Automatically searching & extracting audio for: "${currentItem.title}"...`,
                  type: "info"
                });

                const fallbackArgs: string[] = [
                  "-P", targetDir,
                  "-o", `${rankPrefix}${cleanSongTitle} [%(id)s].%(ext)s`,
                  "--windows-filenames",
                  "--no-mtime",
                  "--newline",
                  "--continue",
                  "--no-overwrites",
                  "--retries", "15",
                  "--fragment-retries", "15",
                  "--retry-sleep", "exp=1:20",
                  "--socket-timeout", "30",
                  "-N", "4",
                  "--buffer-size", "16M",
                  "--throttled-rate", "100K"
                ];

                if (ffmpegDir) {
                  fallbackArgs.push("--ffmpeg-location", ffmpegDir);
                }
                if (denoPath) {
                  fallbackArgs.push("--js-runtimes", `deno:${denoPath}`);
                }
                fallbackArgs.push(...buildYtDlpQualityArgs(quality));
                fallbackArgs.push(searchQuery);

                try {
                  const fallbackCmd = new Deno.Command(ytDlpPath, {
                    args: fallbackArgs,
                    stdout: "piped",
                    stderr: "piped"
                  });

                  const fallbackProc = fallbackCmd.spawn();
                  session.process = fallbackProc;

                  await Promise.all([
                    readStream(fallbackProc.stdout, false),
                    readStream(fallbackProc.stderr, true),
                  ]);

                  const fallbackStatus = await fallbackProc.status;
                  session.process = null;

                  if (fallbackStatus.success) {
                    succeeded = true;
                    sendEvent("log", {
                      message: `[Audio Fallback Success] Successfully extracted audio for: ${currentItem.title}`,
                      type: "info"
                    });
                  } else {
                    sendEvent("log", {
                      message: `[Audio Fallback Notice] Could not extract audio from search for: ${currentItem.title}`,
                      type: "error"
                    });
                  }
                } catch (fallbackErr) {
                  sendEvent("log", {
                    message: `[Audio Fallback Error] ${String(fallbackErr)}`,
                    type: "error"
                  });
                }
              }

              if (succeeded) {
                completed++;
                sendEvent("item-done", {
                  index: effectiveIndex,
                  batchIndex: i + 1,
                  total: itemsToDownload.length,
                  success: true,
                  url: itemUrl,
                  title: currentItem.title || ""
                });
              } else {
                failed++;
                sendEvent("item-done", {
                  index: effectiveIndex,
                  batchIndex: i + 1,
                  total: itemsToDownload.length,
                  success: false,
                  url: itemUrl
                });
              }
            } catch (e) {
              if (session.aborted) break;
              failed++;
              sendEvent("item-done", {
                index: effectiveIndex,
                batchIndex: i + 1,
                total: itemsToDownload.length,
                success: false,
                error: String(e),
                url: itemUrl
              });
            }
          }

          if (session.aborted) {
            sendEvent("stopped", {
              message: `Download stopped. Completed ${completed} of ${itemsToDownload.length} track(s).`,
              completed,
              total: itemsToDownload.length,
              dir: targetDir
            });
          } else {
            sendEvent("done", {
              success: failed === 0,
              completed,
              failed,
              total: itemsToDownload.length,
              dir: targetDir,
              message: `Bulk download finished! Completed: ${completed}, Failed: ${failed} (Saved to: ${targetDir})`
            });
          }
        } finally {
          clearInterval(pingTimer);
          activeSessions.delete(sessionId);
          try {
            controller.close();
          } catch { }
        }
      }
    });

    return new Response(bodyStream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive"
      }
    });
  }

  // Start download with SSE streaming logs and progress
  if (url.pathname === "/api/download" && req.method === "POST") {
    let body: { url?: string; quality?: string; dir?: string; sessionId?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON request" }), { status: 400 });
    }

    const videoUrl = body.url?.trim();
    const quality = body.quality || "m4a";
    const targetDir = ensureDirectory(body.dir);
    const sessionId = body.sessionId || crypto.randomUUID();

    if (!videoUrl) {
      return new Response(JSON.stringify({ error: "Video URL is required" }), { status: 400 });
    }

    const session: ActiveSession = {
      id: sessionId,
      process: null,
      controller: null,
      targetDir,
      aborted: false
    };
    activeSessions.set(sessionId, session);

    // Set up Server-Sent Events (SSE)
    const bodyStream = new ReadableStream({
      async start(controller) {
        session.controller = controller;

        const sendEvent = (event: string, data: Record<string, unknown> | string) => {
          if (session.aborted && event !== "stopped") return;
          try {
            const payload = `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(payload));
          } catch { }
        };

        const pingTimer = setInterval(() => {
          if (!session.aborted) {
            sendEvent("ping", { t: Date.now() });
          }
        }, 10000);

        sendEvent("session", { sessionId });
        sendEvent("log", { message: `Starting download: ${videoUrl}`, type: "info" });
        sendEvent("log", { message: `Quality preset: ${quality}`, type: "info" });
        sendEvent("log", { message: `Target folder: ${targetDir}`, type: "info" });

        // Build command arguments with unthrottled streaming speed and resilience
        const args: string[] = [
          "-P", targetDir,
          "-o", "%(title)s [%(id)s].%(ext)s",
          "--windows-filenames",
          "--no-mtime",
          "--newline",
          "--continue",
          "--no-overwrites",
          "--retries", "25",
          "--fragment-retries", "25",
          "--retry-sleep", "exp=1:30",
          "--socket-timeout", "30",
          "-N", "4",
          "--buffer-size", "16M",
          "--throttled-rate", "100K"
        ];

        if (ffmpegDir) {
          args.push("--ffmpeg-location", ffmpegDir);
        }
        if (denoPath) {
          args.push("--js-runtimes", `deno:${denoPath}`);
        }

        args.push(...buildYtDlpQualityArgs(quality));
        args.push(videoUrl);

        try {
          const command = new Deno.Command(ytDlpPath, {
            args,
            stdout: "piped",
            stderr: "piped"
          });

          const process = command.spawn();
          session.process = process;

          // Read stdout
          const readStream = async (stream: ReadableStream<Uint8Array>, isError: boolean) => {
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (!session.aborted) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim() || session.aborted) continue;

                // Parse progress from yt-dlp
                const downloadMatch = line.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?([\d\.]+\w+)\s+at\s+([\d\.]+\w+\/s)\s+ETA\s+([\d:]+)/i);
                if (downloadMatch) {
                  sendEvent("progress", {
                    percent: parseFloat(downloadMatch[1]),
                    totalSize: downloadMatch[2],
                    speed: downloadMatch[3],
                    eta: downloadMatch[4]
                  });
                } else {
                  // Check 100% completion
                  const completeMatch = line.match(/\[download\]\s+100%\s+of/i);
                  if (completeMatch) {
                    sendEvent("progress", { percent: 100, status: "Processing media..." });
                  }
                }

                sendEvent("log", {
                  message: line,
                  type: isError ? "error" : "stdout"
                });
              }
            }
          };

          await Promise.all([
            readStream(process.stdout, false),
            readStream(process.stderr, true),
          ]);

          const status = await process.status;
          session.process = null;

          if (session.aborted) {
            sendEvent("stopped", { message: `Download stopped by user.`, dir: targetDir });
          } else if (status.success) {
            sendEvent("done", { success: true, dir: targetDir, message: `Download completed successfully! Saved to: ${targetDir}` });
          } else {
            sendEvent("done", { success: false, dir: targetDir, message: `Download failed with exit code ${status.code}` });
          }
        } catch (err) {
          if (!session.aborted) {
            sendEvent("done", { success: false, message: `Error starting process: ${String(err)}` });
          }
        } finally {
          clearInterval(pingTimer);
          activeSessions.delete(sessionId);
          try {
            controller.close();
          } catch { }
        }
      }
    });

    return new Response(bodyStream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive"
      }
    });
  }

  return new Response("Not found", { status: 404 });
};

for (let p = PORT; p <= PORT + 5; p++) {
  try {
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port: p,
      onListen: ({ port }) => {
        activePort = port;
        console.log(`\n======================================================================`);
        console.log(`[+] Universal Video Downloader Web UI is RUNNING at: http://127.0.0.1:${port}`);
        console.log(`======================================================================\n`);
        try {
          new Deno.Command("explorer.exe", {
            args: [`http://127.0.0.1:${port}`],
            stdout: "null",
            stderr: "null"
          }).spawn();
        } catch (error) {
          console.warn(`[!] Could not open the browser automatically: ${error}`);
        }
      }
    }, handler);
    await server.finished;
    break;
  } catch (e) {
    if (e instanceof Deno.errors.AddrInUse && p < PORT + 5) {
      console.log(`[!] Port ${p} is already in use, trying port ${p + 1}...`);
      continue;
    }
    throw e;
  }
}
