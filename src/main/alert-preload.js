const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alertApi', {
  onShow: (cb) => ipcRenderer.on('alert:show', (_e, a) => cb(a)),
  close: () => ipcRenderer.send('alert:close'),
  open: (view) => ipcRenderer.send('alert:open', String(view || 'monitor'))
});
