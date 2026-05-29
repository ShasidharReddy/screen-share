const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  dialog,
  Tray,
  Menu,
  Notification,
  nativeImage,
  screen
} = require('electron');

let robot = null;
try {
  robot = require('robotjs');
} catch (error) {
  console.warn('robotjs unavailable:', error.message);
}

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'SecureSystem');
const APP_ICON = path.join(__dirname, 'assets', 'icon.svg');
let mainWindow;
let tray;

process.env.SIGNALING_SERVER_URL = process.env.SIGNALING_SERVER_URL || 'http://localhost:3478';

function ensureDownloadDir() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function resolveDownloadTarget(relativeName) {
  const safeSegments = String(relativeName || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');

  if (!safeSegments.length) {
    throw new Error('Invalid destination path.');
  }

  return path.join(DOWNLOAD_DIR, ...safeSegments);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0D1117',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getTrayIcon() {
  let icon = nativeImage.createFromPath(APP_ICON);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6AEdCg8nXWamzQAAAB1pVFh0Q29tbWVudAAAAAAAQ3JlYXRlZCB3aXRoIEdJTVBkLmUHAAAAI0lEQVQ4y2NgGAWjgP///w8MDAwMJBsw6oJRF4y6YBQAAP//AAYDABAIAAAAASUVORK5CYII='
    );
  }
  return icon;
}

function createTray() {
  tray = new Tray(getTrayIcon().resize({ width: 18, height: 18 }));
  tray.setToolTip('Secure System');

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Disconnect',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'disconnect');
          mainWindow.show();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(buildMenu());
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

app.whenReady().then(() => {
  ensureDownloadDir();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-signaling-url', () => process.env.SIGNALING_SERVER_URL);
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false
  });

  const primaryDisplayId = screen.getPrimaryDisplay().id;
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    thumbnail: source.thumbnail.toDataURL(),
    primary: String(source.display_id || '') === String(primaryDisplayId)
  }));
});

ipcMain.handle('start-screen-capture', async (_event, sourceId) => ({
  sourceId,
  constraints: {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        minWidth: 1280,
        maxWidth: 3840,
        minHeight: 720,
        maxHeight: 2160,
        minFrameRate: 15,
        maxFrameRate: 30
      }
    }
  }
}));

ipcMain.handle('open-file-dialog', async () => {
  if (!mainWindow) {
    return [];
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map((filePath) => {
    const stats = fs.statSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stats.size
    };
  });
});

ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-file-info', async (_event, filePath) => {
  const stat = await fs.promises.stat(filePath);
  return { size: stat.size, name: path.basename(filePath) };
});

ipcMain.handle('read-file-chunk', async (_event, { filePath, offset, length }) => {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fd.read(buf, 0, length, offset);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead);
  } finally {
    await fd.close();
  }
});

ipcMain.handle('read-dir-recursive', async (_event, dirPath) => {
  const results = [];

  async function walk(dir, prefix) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else {
        const stat = await fs.promises.stat(full);
        results.push({ path: full, name: rel, size: stat.size });
      }
    }
  }

  await walk(dirPath, '');
  return results;
});

ipcMain.handle('prepare-save-file', async (_event, name) => {
  ensureDownloadDir();
  const destination = resolveDownloadTarget(name);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, Buffer.alloc(0));
  return destination;
});

ipcMain.handle('write-file-chunk', async (_event, { name, buffer, offset }) => {
  const destination = resolveDownloadTarget(name);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const fd = await fs.promises.open(destination, 'r+');
  try {
    const data = Buffer.from(buffer);
    await fd.write(data, 0, data.byteLength, offset);
    return destination;
  } finally {
    await fd.close();
  }
});

ipcMain.handle('complete-save-file', async (_event, name) => resolveDownloadTarget(name));

ipcMain.handle('save-file', async (_event, { name, buffer }) => {
  ensureDownloadDir();
  const destination = resolveDownloadTarget(name);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, Buffer.from(buffer));
  return destination;
});

ipcMain.on('window-control', (_event, action) => {
  if (!mainWindow) {
    return;
  }

  if (action === 'minimize') {
    mainWindow.minimize();
  }

  if (action === 'maximize') {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }

  if (action === 'close') {
    mainWindow.close();
  }
});

ipcMain.on('inject-mouse', (_event, payload) => {
  if (!robot) {
    return;
  }

  const display = screen.getPrimaryDisplay();
  const absX = Math.round((payload.x || 0) * display.size.width);
  const absY = Math.round((payload.y || 0) * display.size.height);

  if (payload.type === 'move') {
    robot.moveMouse(absX, absY);
  }

  if (payload.type === 'click') {
    if (typeof payload.x === 'number' && typeof payload.y === 'number') {
      robot.moveMouse(absX, absY);
    }
    robot.mouseClick(payload.button || 'left', payload.double || false);
  }

  if (payload.type === 'toggle') {
    if (typeof payload.x === 'number' && typeof payload.y === 'number') {
      robot.moveMouse(absX, absY);
    }
    robot.mouseToggle(payload.state || 'down', payload.button || 'left');
  }

  if (payload.type === 'scroll') {
    robot.scrollMouse(Number(payload.deltaX || 0), Number(payload.deltaY || 0));
  }
});

ipcMain.on('inject-keyboard', (_event, payload) => {
  if (!robot) {
    return;
  }

  if (payload.type === 'keyTap') {
    robot.keyTap(payload.key, payload.modifiers || []);
  }

  if (payload.type === 'keyToggle') {
    robot.keyToggle(payload.key, payload.state || 'down', payload.modifiers || []);
  }

  if (payload.type === 'typeString') {
    robot.typeString(payload.key || '');
  }
});

ipcMain.on('show-notification', (_event, { title, body }) => {
  showNotification(title, body);
});
