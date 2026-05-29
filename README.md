# 🔒 Secure System — Remote Desktop (Electron)

> Full-featured AnyDesk-style remote desktop app built with Electron.  
> Works on **Windows ↔ Windows**, **Windows ↔ Mac**, **Mac ↔ Mac**.  
> Screen share, remote control, and file transfer (5GB+ per file, no limits).

---

## ⬇️ Download (Installers)

Go to **[Releases](https://github.com/ShasidharReddy/screen-share/releases/latest)**:

| OS | File to Download |
|---|---|
| 🍎 macOS (Apple Silicon + Intel) | `Secure System-*.dmg` |
| 🪟 Windows (Installer) | `Secure System Setup *.exe` |
| 🪟 Windows (Portable, no install) | `Secure System *.exe` |
| 🐧 Linux | `Secure System-*.AppImage` |

---

## 🚀 Quick Start

### Windows
1. Download `Secure System Setup x.x.x.exe`
2. Run the installer → **Secure System** appears in Start Menu
3. Launch it → the app opens
4. Share your **Session ID** from the left sidebar

### macOS
1. Download `Secure System-x.x.x.dmg`
2. Open the .dmg → drag **Secure System** to Applications
3. Double-click to launch
4. Your **Session ID** appears in the sidebar

> **macOS Security Pop-up?** Right-click → Open → Open Anyway

### Linux
```bash
chmod +x "Secure System-x.x.x.AppImage"
./"Secure System-x.x.x.AppImage"
```

---

## 🎯 How It Works

```
Person A (HOST)                    Person B (VIEWER)
─────────────────                  ──────────────────
1. Open Secure System              1. Open Secure System
2. Gets Session ID                 2. Enter Person A's Session ID
   e.g. abc12345                   3. Click "Connect"
3. Share ID with Person B          4. Waits for accept…
4. Sees incoming request           5. Sees Person A's screen live!
5. Clicks "✓ Accept"               6. Full mouse + keyboard control
```

### Signaling Server
Both peers need to connect to the **same signaling server**.

- **Default**: `http://localhost:3478` (local, for same-machine testing)
- **LAN use**: Run the signaling server on one machine, both connect to it

---

## 🛠️ Run from Source

### Requirements
- Node.js 18+
- npm 9+

### Install & Run

```bash
git clone https://github.com/ShasidharReddy/screen-share
cd screen-share/client

# Install dependencies
npm install

# Start signaling server (Terminal 1)
node server/server.js

# Start Electron app (Terminal 2)
npm start
```

---

## 📦 Build Installers

### macOS (.dmg)
```bash
cd client
npm run build:mac
# Output: dist/Secure System-1.0.0.dmg
```

### Windows (.exe)
```bash
cd client
npm run build:win
# Output: dist/Secure System Setup 1.0.0.exe
#         dist/Secure System 1.0.0.exe  (portable)
```

### Linux (.AppImage)
```bash
cd client
npm run build:linux
# Output: dist/Secure System-1.0.0.AppImage
```

### All platforms at once
```bash
npm run dist
```

> **Cross-compiling Windows from Mac**: Install Wine  
> `brew install --cask wine-stable`  
> `npm run build:win`

---

## 📡 Network Setup

### Same machine (testing)
```bash
# Terminal 1: signaling server
node server/server.js

# Terminal 2: app
npm start
# Open two windows, connect one to the other
```

### LAN (home/office)
```bash
# On machine A: start signaling server
SIGNALING_PORT=3478 node server/server.js

# On machine B: set env var before launching
SIGNALING_SERVER_URL=http://machineA-IP:3478 npm start
# OR set it in the app settings
```

---

## 📁 File & Folder Transfer

- **Drag & drop** files/folders onto the transfer zone
- Supports files up to **5GB+** — streamed in 256KB chunks
- Multiple simultaneous transfers
- Folder transfer preserves directory structure
- Files saved to `~/Downloads/SecureSystem-received/`

---

## 🖥️ Remote Control Features

| Feature | Status |
|---|---|
| Screen viewing (live) | ✅ WebRTC P2P |
| Mouse move/click | ✅ |
| Keyboard input | ✅ |
| File transfer (5GB+) | ✅ |
| Folder transfer | ✅ |
| Multiple viewers | ✅ |
| Clipboard sync | 🔜 |
| Audio streaming | 🔜 |

---

## 📂 Project Structure

```
screen-share/
├── client/
│   ├── main.js              # Electron main process
│   ├── preload.js           # IPC bridge
│   ├── package.json         # Dependencies + electron-builder config
│   ├── assets/
│   │   ├── icon.icns        # macOS icon
│   │   ├── icon.ico         # Windows icon
│   │   └── icon.png         # Linux icon
│   └── src/
│       ├── index.html       # App UI shell
│       ├── styles.css       # Dark theme
│       ├── renderer.js      # Main UI logic
│       ├── filetransfer.js  # 5GB+ streaming file transfer
│       ├── host.js          # Host mode (screen capture)
│       └── viewer.js        # Viewer mode (canvas render)
└── .github/workflows/
    └── release.yml          # Auto-build releases on git tag
```

---

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| "App can't be opened" (macOS) | Right-click → Open → Open Anyway |
| Windows SmartScreen warning | Click "More info" → "Run anyway" |
| Black screen in viewer | Grant Screen Capture permission in System Settings |
| Can't connect | Make sure both are on same signaling server URL |
| `robotjs` error | Run `npm rebuild` in `client/` folder |
| Signaling server not found | Check `SIGNALING_SERVER_URL` env var |
| WebRTC fails behind NAT | Add TURN server config in `renderer.js` |

### Logs
- macOS: `~/Library/Logs/Secure System/`
- Windows: `%APPDATA%\Secure System\logs\`
- Linux: `~/.config/Secure System/logs/`

---

## 🚢 Release a New Version

```bash
git tag v1.1.0
git push origin v1.1.0
# GitHub Actions builds macOS .dmg + Windows .exe + Linux .AppImage
# All uploaded automatically to GitHub Releases
```

---

## ⚠️ Permissions Required

| OS | Permission |
|---|---|
| macOS | Screen Recording + Accessibility (for input control) |
| Windows | No special permissions needed |
| Linux | X11 access (usually automatic) |

