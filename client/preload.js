const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  startCapture: (sourceId) => ipcRenderer.invoke('start-screen-capture', sourceId),
  getSignalingUrl: () => ipcRenderer.invoke('get-signaling-url'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
  readFileChunk: (filePath, offset, length) => ipcRenderer.invoke('read-file-chunk', { filePath, offset, length }),
  readDirRecursive: (dirPath) => ipcRenderer.invoke('read-dir-recursive', dirPath),
  prepareSaveFile: (name) => ipcRenderer.invoke('prepare-save-file', name),
  writeFileChunk: (name, buffer, offset) => ipcRenderer.invoke('write-file-chunk', { name, buffer, offset }),
  completeSaveFile: (name) => ipcRenderer.invoke('complete-save-file', name),
  saveFile: (name, buffer) => ipcRenderer.invoke('save-file', { name, buffer }),
  injectMouse: (payload) => ipcRenderer.send('inject-mouse', payload),
  injectKeyboard: (payload) => ipcRenderer.send('inject-keyboard', payload),
  windowControl: (action) => ipcRenderer.send('window-control', action),
  notify: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  onTrayAction: (callback) => {
    ipcRenderer.removeAllListeners('tray-action');
    ipcRenderer.on('tray-action', (_event, action) => callback(action));
  }
});
