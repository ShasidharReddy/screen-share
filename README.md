<div align="center">

```
  ⚙️  Secure System
  ──────────────────────────────────────
  AnyDesk-style Remote Desktop • WebRTC P2P • Cross-Platform
  Mac ↔ Mac  •  Windows ↔ Windows  •  Windows ↔ Mac
```

</div>

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Installation](#installation)
7. [Running the App](#running-the-app)
8. [How to Use](#how-to-use)
   - [Host Mode (Share Your Screen)](#host-mode-share-your-screen)
   - [Viewer Mode (Connect to Remote)](#viewer-mode-connect-to-remote)
   - [File Transfer](#file-transfer)
9. [Configuration](#configuration)
10. [Platform Setup](#platform-setup)
    - [macOS](#macos-setup)
    - [Windows](#windows-setup)
11. [Building for Distribution](#building-for-distribution)
12. [Signaling Protocol Reference](#signaling-protocol-reference)
13. [Troubleshooting](#troubleshooting)
14. [FAQ](#faq)

---

## Overview

**Secure System** is a fully self-hosted, AnyDesk-style remote desktop application built on:

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 28 (Mac + Windows) |
| P2P video stream | WebRTC via `simple-peer` |
| Input injection | `robotjs` (keyboard + mouse) |
| Screen capture | Electron `desktopCapturer` (built-in) |
| Signaling | Node.js + Express + Socket.IO |
| File transfer | WebRTC DataChannel, 64 KB chunks |

Everything is self-contained — no cloud relay, no third-party servers. The signaling server only handles the WebRTC handshake; all video, audio, and file data flow **peer-to-peer**.

---

## Features

| Feature | Detail |
|---------|--------|
| 🔑 Session IDs | 9-digit AnyDesk-style IDs (e.g. `123 456 789`), persisted across restarts |
| 🔒 Password protection | Optional per-session password set by the host |
| 🖥️ Screen streaming | Primary display captured at up to 30 fps, 1080p–4K |
| 🖱️ Remote control | Mouse move, click, scroll, drag + full keyboard passthrough |
| 📁 File transfer | Bidirectional, drag-and-drop or file picker, progress bars |
| 🌑 Dark UI | Custom frameless dark theme, macOS gear icon, system tray |
| 📦 Cross-platform | Single codebase, builds for macOS (`.dmg`) and Windows (`.exe`) |
| 💓 Heartbeat | Signaling server auto-clears stale sessions after 60 s |
| 🔌 Self-hosted | Point `SIGNALING_SERVER_URL` at any machine on your network |

---

## Architecture

```
┌──────────────────────────────────┐        ┌──────────────────────────────────┐
│        VIEWER (Machine A)        │        │         HOST (Machine B)         │
│  ┌────────────────────────────┐  │        │  ┌────────────────────────────┐  │
│  │ Electron Renderer          │  │        │  │ Electron Renderer          │  │
│  │  viewer.js  ─────────────────────────────▶  host.js                   │  │
│  │  filetransfer.js           │◀─────────────── filetransfer.js          │  │
│  │  renderer.js               │  │ WebRTC │  │  renderer.js               │  │
│  └──────────┬─────────────────┘  │ P2P    │  └─────────────┬──────────────┘  │
│             │ IPC                │        │                │ IPC             │
│  ┌──────────▼─────────────────┐  │        │  ┌─────────────▼──────────────┐  │
│  │ Electron Main (main.js)    │  │        │  │ Electron Main (main.js)    │  │
│  │  window controls           │  │        │  │  desktopCapturer           │  │
│  │  file open/save dialogs    │  │        │  │  robotjs (input inject)    │  │
│  └────────────────────────────┘  │        │  └────────────────────────────┘  │
└────────────────┬─────────────────┘        └────────────────┬─────────────────┘
                 │ socket.io                                  │ socket.io
                 │ (offer / answer / ICE)                     │ (offer / answer / ICE)
                 └────────────────┬───────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │    Signaling Server         │
                    │    server/index.js          │
                    │    Express + Socket.IO      │
                    │    port 3478               │
                    │    session Map (in-memory)  │
                    └─────────────────────────────┘
```

**Data flows:**

```
Screen video  ─ WebRTC MediaStream  ──────────────── Host → Viewer
Mouse/keyboard ─ WebRTC DataChannel (JSON events) ─── Viewer → Host
File chunks ─── WebRTC DataChannel (base64 JSON) ──── either direction
Signaling ────── Socket.IO TCP ───────────────────── both ↔ server (handshake only)
```

---

## Project Structure

```
remote-desktop/
│
├── README.md
│
├── server/                         # Signaling server
│   ├── package.json
│   └── index.js                    # Express + Socket.IO, session registry
│
└── client/                         # Electron desktop app
    ├── package.json
    ├── main.js                     # Main process: windows, IPC, robotjs, capturer
    ├── preload.js                  # contextBridge IPC bridge to renderer
    │
    ├── src/
    │   ├── index.html              # App shell, custom titlebar, sidebar, video area
    │   ├── styles.css              # Dark theme, layout, animations
    │   ├── renderer.js             # Session ID, signaling connection, UI events
    │   ├── host.js                 # Host: screen capture, WebRTC answer, input handling
    │   ├── viewer.js               # Viewer: WebRTC offer, stream display, input capture
    │   └── filetransfer.js         # Chunked file send/receive, progress UI
    │
    └── assets/
        ├── icon.svg                # Gear icon (app + tray)
        └── tray-icon.svg           # Tray-only icon
```

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| Node.js | 18 LTS or later | `node --version` |
| npm | 9 or later | bundled with Node |
| Python | 3.x | required by `robotjs` native build |
| Xcode CLI Tools | latest | **macOS only** — `xcode-select --install` |
| Visual Studio Build Tools | 2019+ | **Windows only** — C++ workload required for `robotjs` |

---

## Installation

> **Clone or download** the `remote-desktop/` folder, then follow the steps below.

### Step 1 — Install signaling server dependencies

```bash
cd remote-desktop/server
npm install
```

Expected output:
```
added 56 packages in 3s
```

### Step 2 — Install client (Electron app) dependencies

```bash
cd remote-desktop/client
npm install
```

> ⚠️ `robotjs` compiles native bindings during install. This takes 1–3 minutes.  
> If the build fails, see [Troubleshooting → robotjs won't build](#robotjs-wont-build).

Expected output:
```
added 312 packages in 90s
```

---

## Running the App

### Terminal 1 — Start the signaling server

```bash
cd remote-desktop/server
npm start
```

You should see:
```
Secure System signaling server listening on port 3478
```

Verify the server is healthy:
```bash
curl http://localhost:3478/health
# {"ok":true,"sessions":0,"uptime":4.2}
```

### Terminal 2 — Start the Electron app

```bash
cd remote-desktop/client
npm start
```

The **Secure System** window opens with:
- A **gear icon ⚙️** in the top-left titlebar
- Your auto-generated **9-digit session ID** in the left sidebar
- Status: `Ready`

> 💡 To run a second instance on the **same machine** for testing, open a third terminal and run `npm start` again from `client/`. Each instance generates its own session ID.

---

## How to Use

### App Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️  Secure System                            ─  □  ✕           │  ← Custom titlebar
├────────────────────┬────────────────────────────────────────────┤
│                    │                                            │
│  YOUR ID           │                                            │
│  ┌──────────────┐  │          (Welcome Screen)                  │
│  │ 123 456 789  │  │                                            │
│  └──────────────┘  │   Connect to a remote computer or wait     │
│  [Copy]            │   for someone to connect using your ID.    │
│                    │                                            │
│  Password (opt.)   │                                            │
│  [____________]    │                                            │
│                    │                                            │
│  ─────────────     │                                            │
│  CONNECT TO        │                                            │
│  [  Remote ID  ]   │                                            │
│  [  Password   ]   │                                            │
│  [  Connect   ]    │                                            │
│                    │                                            │
│  Status: Ready  ●  │                                            │
│                    │                                            │
│  ─────────────     │                                            │
│  FILE TRANSFER     │                                            │
│  [  Send Files ]   │                                            │
│  ┌──────────────┐  │                                            │
│  │  Drop files  │  │                                            │
│  │  here...     │  │                                            │
│  └──────────────┘  │                                            │
│                    │                                            │
└────────────────────┴────────────────────────────────────────────┘
```

---

### Host Mode (Share Your Screen)

**You want someone else to connect to your machine.**

1. **Launch Secure System** on your machine.

2. **Find your Session ID** in the left sidebar — e.g., `123 456 789`.
   - Click **Copy** to copy it to clipboard.
   - Share this ID with the person who will connect.

3. *(Optional)* **Set a password** in the password field. If set, the viewer must enter this password to connect.

4. **Wait** — when the viewer connects, you'll see:
   - A desktop notification: `Connected with viewer 987 654 321`
   - Status dot turns **green**: `Connected to 987654321`
   - Your screen is now being streamed.

5. **Stop sharing** — click **Disconnect** in the sidebar, or right-click the tray icon and choose **Disconnect**.

> 🖥️ The **primary display** is automatically captured. Multi-monitor support: the first screen in `desktopCapturer.getSources()` is used.

---

### Viewer Mode (Connect to Remote)

**You want to control someone else's machine.**

1. **Launch Secure System** on your machine.

2. **Enter the remote Session ID** in the `Connect to Remote` field.
   - Format: `123456789` or `123 456 789` (spaces are ignored)
   - Press **Enter** or click **Connect**.

3. **Enter a password** if the host set one.

4. **Connected!** The remote desktop appears in the main panel.

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️  Secure System                            ─  □  ✕           │
├────────────────────┬────────────────────────────────────────────┤
│                    │  [Disconnect] [Files] [Fullscreen] [Ctrl+  │  ← Toolbar
│  123 456 789       │                                Alt+Del]    │
│  ...               │  ┌──────────────────────────────────────┐  │
│  Status:           │  │                                      │  │
│  Connected ●       │  │    Remote Desktop (live video)       │  │
│                    │  │                                      │  │
│                    │  │    ← mouse & keyboard pass-through → │  │
│                    │  │                                      │  │
│                    │  └──────────────────────────────────────┘  │
└────────────────────┴────────────────────────────────────────────┘
```

**Toolbar buttons:**

| Button | Action |
|--------|--------|
| `Disconnect` | End the remote session |
| `Files` | Scroll to the file transfer panel |
| `Fullscreen` | Expand remote video to full screen (press `Esc` to exit) |
| `Ctrl+Alt+Del` | Send the Ctrl+Alt+Del key combination to the remote machine |

**Input controls:**

| Input | Behaviour |
|-------|-----------|
| Mouse movement | Moves cursor on the remote machine in real-time |
| Left / right / middle click | Sent to the remote at the exact proportional coordinate |
| Double click | Triggers double-click on the remote |
| Scroll wheel | Scrolls on the remote |
| Keyboard (click video first) | All keystrokes forwarded — including Ctrl, Alt, Shift, arrows, function keys |

> 💡 Click the video area first to give it keyboard focus, then type normally.

---

### File Transfer

Files can be transferred **in both directions** while a session is active.

#### Sending files

**Method 1 — File picker:**
1. Click **Send Files** in the left sidebar.
2. Select one or more files in the dialog.
3. Transfer starts immediately.

**Method 2 — Drag and drop:**
1. Drag files from your OS file manager.
2. Drop them onto the **dashed drop zone** in the sidebar.
3. Transfer starts immediately.

#### Receiving files

- Received files are automatically saved to `~/Downloads/SecureSystem/` (created if it doesn't exist).
- Progress is shown in the transfer list.

#### Transfer UI

```
FILE TRANSFER
[Send Files]
┌────────────────────────────┐
│  Drop files here...        │  ← drag-drop zone
└────────────────────────────┘

▼ Transfer list:
┌────────────────────────────┐
│ report.pdf                 │
│ Sending • 2.4 MB           │
│ ████████░░░░░░░░  55%      │
├────────────────────────────┤
│ screenshot.png             │
│ Received                   │
│ ████████████████ 100%      │
│ Saved to ~/Downloads/...   │
└────────────────────────────┘
```

> ⚡ Chunk size is **64 KB**. Transfer speed depends on your network and WebRTC throughput.

---

## Configuration

### Client environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGNALING_SERVER_URL` | `http://localhost:3478` | URL of the signaling server |

**Running on the same local network (different machines):**

```bash
# Terminal on Machine B (viewer) — point at Machine A's IP
SIGNALING_SERVER_URL=http://192.168.1.100:3478 npm start
```

**Running in production (remote server):**

```bash
SIGNALING_SERVER_URL=https://signaling.yourdomain.com npm start
```

### Server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3478` | Port for the signaling server |

```bash
PORT=8080 npm start
```

---

## Platform Setup

### macOS Setup

Remote desktop control requires two **Privacy & Security** permissions. Without them, screen sharing or input injection will silently fail.

#### 1. Screen Recording permission

> Required for the **Host** to capture the screen.

1. Open **System Settings** → **Privacy & Security** → **Screen Recording**
2. Click the `+` button and add your `Electron` / `Secure System` app.
3. Toggle it **ON**.
4. Restart the app.

```
System Settings
└── Privacy & Security
    └── Screen Recording
        └── ☑  Electron (or Secure System)   ← enable this
```

#### 2. Accessibility permission

> Required for the **Host** to receive mouse/keyboard events from the viewer.

1. Open **System Settings** → **Privacy & Security** → **Accessibility**
2. Click the `+` button and add `Electron` / `Secure System`.
3. Toggle it **ON**.

```
System Settings
└── Privacy & Security
    └── Accessibility
        └── ☑  Electron (or Secure System)   ← enable this
```

> ⚠️ If running via `npm start` (Electron in dev mode), the app presents as `Electron` in the privacy panels. After packaging as a `.app`, it will appear as `Secure System`.

#### Firewall

If macOS asks "Do you want the application to accept incoming network connections?", click **Allow**.

---

### Windows Setup

#### Build tools (required for `robotjs`)

Install **Visual Studio Build Tools** with the **C++ workload**:

1. Download from [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Select **Desktop development with C++**
3. Install and restart.

Or via `winget`:
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

#### Firewall rules

When running the signaling server, Windows Firewall may prompt for access. Click **Allow access** for both private and public networks.

#### UAC / Protected windows

To control UAC prompts or Task Manager on a remote machine, the app must run **as Administrator**:

```powershell
# Right-click Command Prompt → "Run as administrator"
cd remote-desktop\client
npm start
```

---

## Building for Distribution

### macOS (`.dmg`)

```bash
cd client
npm run build:mac
```

Output: `client/dist/Secure System-1.0.0.dmg`

> **Prerequisite:** You need `.icns` icon files for proper macOS packaging.  
> Convert `assets/icon.svg` to `icon.icns`:
> ```bash
> mkdir icon.iconset
> # Generate PNGs at 16x16, 32x32, 64x64, 128x128, 256x256, 512x512, 1024x1024
> iconutil -c icns icon.iconset -o assets/icon.icns
> ```

### Windows (`.exe` installer)

On a Windows machine or via cross-compilation:

```bash
cd client
npm run build:win
```

Output: `client/dist/Secure System Setup 1.0.0.exe`

> **Prerequisite:** Provide `assets/icon.ico` (multi-resolution ICO file).  
> Use [icoconvert.com](https://icoconvert.com) or ImageMagick:
> ```bash
> convert assets/icon.svg -resize 256x256 assets/icon.ico
> ```

### Both platforms from macOS (with Docker)

```bash
cd client
docker run --rm -v "$(pwd):/project" electronuserland/builder:wine \
  /bin/bash -c "cd /project && npm install && npm run build:win"
```

---

## Signaling Protocol Reference

The signaling server relays WebRTC handshake messages. It never sees screen content or file data.

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `register` | `{ sessionId: "123456789" }` | Register your 9-digit ID |
| `offer` | `{ targetId, offer, from, password }` | Send WebRTC offer to target |
| `answer` | `{ targetId, answer, from }` | Send WebRTC answer to target |
| `ice` | `{ targetId, candidate, from }` | Relay ICE candidate |
| `reject` | `{ targetId, reason, from }` | Reject incoming connection |
| `heartbeat` | *(none)* | Keep session alive (sent every 20 s) |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `registered` | `{ sessionId }` | Confirm session registration |
| `offer` | `{ from, offer, password }` | Incoming connection request |
| `answer` | `{ answer, from }` | Remote accepted, here's the answer |
| `ice` | `{ candidate, from }` | Incoming ICE candidate |
| `rejected` | `{ reason, from }` | Remote rejected your connection |
| `error` | `{ message }` | Server-side error |

### Session lifecycle

```
Viewer                      Server                       Host
  │                           │                            │
  │── register ──────────────▶│◀─────────────── register ─│
  │◀─ registered ─────────────│─────────────── registered ▶│
  │                           │                            │
  │── offer (targetId=Host) ─▶│── offer (from=Viewer) ───▶│
  │                           │◀─ answer (targetId=Viewer)─│
  │◀─ answer ─────────────────│                            │
  │                           │                            │
  │── ice ───────────────────▶│──────────────────── ice ──▶│
  │◀─ ice ────────────────────│◀──────────────────── ice ──│
  │                           │                            │
  │◀══════════ WebRTC P2P connection established ══════════▶│
  │                (video + data — direct, no server)       │
```

---

## Troubleshooting

### `robotjs` won't build

**Symptom:**
```
npm ERR! gyp ERR! build error
```

**macOS fix:**
```bash
xcode-select --install
npm install --build-from-source
```

**Windows fix:**
```powershell
npm install --global --production windows-build-tools
# Then retry:
npm install
```

**Skip `robotjs` (input injection disabled):**

If you only need screen viewing without remote control, edit `client/package.json` and remove `"robotjs"` from `dependencies`, then `npm install` again. The app will start — input events will be silently ignored on the host side.

---

### App opens but status stays "Disconnected from signaling server"

**Cause:** The signaling server isn't running or the URL is wrong.

```bash
# Verify server is up:
curl http://localhost:3478/health
# Expected: {"ok":true,"sessions":0,"uptime":...}
```

If using a remote server:
```bash
SIGNALING_SERVER_URL=http://YOUR_SERVER_IP:3478 npm start
```

---

### Black/blank screen when connecting (Host side)

**macOS:** Screen Recording permission not granted.

1. Go to **System Settings → Privacy & Security → Screen Recording**
2. Enable `Electron` or `Secure System`
3. Quit the app completely and restart

**Check if the permission is active:**
```bash
# Should return 1 if granted:
osascript -e 'tell application "System Events" to get name of every process'
```

---

### Mouse/keyboard not working on remote machine

**macOS:** Accessibility permission not granted.

1. Go to **System Settings → Privacy & Security → Accessibility**
2. Enable `Electron` or `Secure System`
3. Restart the app

**Windows:** Try running as Administrator (see [Windows Setup](#windows-setup)).

---

### "Target session is offline" error

**Cause:** The remote machine's session ID isn't registered on the signaling server.

**Check:**
- Both machines must be connected to the **same signaling server**
- Verify with `curl http://SIGNALING_URL/health` — `sessions` count should be ≥ 2
- The remote machine's status bar must show `Ready` (green dot)

---

### File transfer stuck at 0%

**Cause:** File transfer uses the WebRTC data channel. If the peer connection hasn't fully established, the DataChannel won't be open yet.

**Fix:** Wait until the status shows `Connected` (green dot) before sending files.

---

### High latency / laggy video

WebRTC performance tuning:

1. **Same network:** Ensure both machines are on the same LAN — WebRTC prefers direct LAN ICE candidates.
2. **TURN server:** If on different networks without a direct path, WebRTC will relay via STUN. Add a TURN server by editing `viewer.js` and `host.js` SimplePeer config:
   ```javascript
   this.peer = new window.SimplePeer({
     initiator: true,
     trickle: true,
     config: {
       iceServers: [
         { urls: 'stun:stun.l.google.com:19302' },
         { urls: 'turn:YOUR_TURN_SERVER', username: 'user', credential: 'pass' }
       ]
     }
   });
   ```
3. **Frame rate:** Reduce max frame rate in `main.js` → `start-screen-capture` handler:
   ```javascript
   maxFrameRate: 15   // reduce from 30
   ```

---

### Electron fails to start: "Cannot find module 'electron'"

```bash
cd client
npm install
```

---

### Port 3478 already in use

```bash
# Find what's using it:
lsof -i :3478        # macOS/Linux
netstat -ano | findstr :3478   # Windows

# Use a different port:
PORT=4000 npm start   # in server/
SIGNALING_SERVER_URL=http://localhost:4000 npm start   # in client/
```

---

## FAQ

**Q: Does this work over the internet (not just LAN)?**

> Yes, as long as both machines can reach the signaling server. WebRTC will attempt a direct P2P connection first. If NAT traversal fails (e.g., symmetric NAT), you'll need a TURN relay server. For most home/office routers, direct P2P works.

**Q: Is the video/data encrypted?**

> Yes. WebRTC enforces **DTLS-SRTP** encryption for all media streams and data channels. The signaling server only sees session IDs and SDP metadata — never screen content or file bytes.

**Q: Can I run the signaling server on a remote VPS?**

> Yes. Deploy `server/` to any Node.js host (Heroku, Railway, DigitalOcean, etc.) and set `SIGNALING_SERVER_URL` to its public URL on each client.
> ```bash
> # Example with Railway
> railway up   # in server/
> ```

**Q: Can multiple viewers connect to the same host at once?**

> The current implementation supports **one viewer per host** at a time. When a second offer arrives, it replaces the first connection.

**Q: The session ID changes every time I restart. Can I have a fixed ID?**

> Session IDs are stored in `localStorage`. They persist across restarts. However, if you clear app data or run in a fresh Electron profile, a new ID is generated.

**Q: How do I use this across a corporate VPN?**

> Run the signaling server on a machine accessible via VPN. Point all clients at its VPN IP. WebRTC ICE will use the VPN-assigned addresses.

**Q: Does audio get streamed too?**

> The current implementation streams **video only** (audio: false in the capture constraints). To enable audio, change `audio: false` to `audio: true` in `main.js` → `start-screen-capture`.

---

<div align="center">

Built with ⚙️ Electron · WebRTC · Socket.IO · robotjs

</div>
