'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe bridge: the renderer never touches Node directly.
contextBridge.exposeInMainWorld('newon', {
  onNowPlaying: (cb) => ipcRenderer.on('nowplaying', (_e, data) => cb(data)),
  onLyrics: (cb) => ipcRenderer.on('lyrics', (_e, data) => cb(data)),
  checkScreenAccess: () => ipcRenderer.invoke('check-screen-access'),
  openScreenRecordingSettings: () => ipcRenderer.invoke('open-screen-recording-settings'),
  // Spotify Web API (log in once with your account).
  spotifyGetState: () => ipcRenderer.invoke('spotify-get-state'),
  spotifySetClient: (id) => ipcRenderer.invoke('spotify-set-client', id),
  spotifyConnect: () => ipcRenderer.invoke('spotify-connect'),
  spotifyDisconnect: () => ipcRenderer.invoke('spotify-disconnect'),
  onSpotifyState: (cb) => ipcRenderer.on('spotify-state', (_e, data) => cb(data)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  platform: process.platform
});
