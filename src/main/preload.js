const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set([
  'chat:item', 'chat:status', 'chat:approval', 'job:update', 'job:log', 'job:frame', 'job:approval', 'job:attention',
  'pull:progress', 'ollama:progress', 'whisper:progress', 'settings:changed', 'busy',
  'studio:update', 'studio:status', 'study:step', 'study:frame', 'gpu:reading', 'gpu:state', 'nav'
]);

contextBridge.exposeInMainWorld('pa', {
  call: (method, arg) => ipcRenderer.invoke('api', method, arg),
  on: (event, cb) => {
    if (!EVENTS.has(event)) throw new Error('unknown event ' + event);
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(event, fn);
    return () => ipcRenderer.removeListener(event, fn);
  },
  // drag and drop: the real path of a dropped file (main validates every path it receives)
  pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; } }
});
