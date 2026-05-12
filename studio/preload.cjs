/**
 * Electron preload — exposes safe IPC bridge to renderer
 */
/* eslint-disable */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  oauthStart: () => ipcRenderer.invoke('oauth:start'),
  oauthReadCredentials: () => ipcRenderer.invoke('oauth:read-credentials'),
  oauthLogout: () => ipcRenderer.invoke('oauth:logout'),
  isElectron: true,
});
