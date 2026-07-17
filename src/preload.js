'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe bridge: the renderer never touches Node directly.
contextBridge.exposeInMainWorld('newon', {
  onNowPlaying: (cb) => ipcRenderer.on('nowplaying', (_e, data) => cb(data)),
  onLyrics: (cb) => ipcRenderer.on('lyrics', (_e, data) => cb(data)),
  platform: process.platform
});
