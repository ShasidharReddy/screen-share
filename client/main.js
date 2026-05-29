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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#1A1A2E',
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

ipcMain.handle('start-screen-capture', async (_event, sourceId) => {
  return {
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
  };
});

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

ipcMain.handle('read-file', async (_event, filePath) => {
  const fileBuffer = await fs.promises.readFile(filePath);
  return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
});

ipcMain.handle('save-file', async (_event, { name, buffer }) => {
  ensureDownloadDir();
  const safeName = path.basename(name);
  const destination = path.join(DOWNLOAD_DIR, safeName);
  const data = Buffer.from(buffer);
  await fs.promises.writeFile(destination, data);
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
