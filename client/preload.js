const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  startCapture: (sourceId) => ipcRenderer.invoke('start-screen-capture', sourceId),
  getSignalingUrl: () => ipcRenderer.invoke('get-signaling-url'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFile: (name, buffer) => ipcRenderer.invoke('save-file', { name, buffer }),
  injectMouse: (payload) => ipcRenderer.send('inject-mouse', payload),
  injectKeyboard: (payload) => ipcRenderer.send('inject-keyboard', payload),
  windowControl: (action) => ipcRenderer.send('window-control', action),
  notify: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  onTrayAction: (callback) => ipcRenderer.on('tray-action', (_event, action) => callback(action))
});
