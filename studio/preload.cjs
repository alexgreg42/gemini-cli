/**
 * Electron preload — secure IPC bridge between renderer and main
 */
/* eslint-disable */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // OAuth
  oauthStart: () => ipcRenderer.invoke('oauth:start'),
  oauthStatus: () => ipcRenderer.invoke('oauth:status'),
  oauthLogout: () => ipcRenderer.invoke('oauth:logout'),

  // Gemini via Code Assist API (no API key — uses OAuth token)
  geminiGenerate: (params) => ipcRenderer.invoke('gemini:generate', params),

  // CLI background process
  cliStart: () => ipcRenderer.invoke('cli:start'),
  cliSend: (params) => ipcRenderer.invoke('cli:send', params),
  cliStop: () => ipcRenderer.invoke('cli:stop'),
  cliStatus: () => ipcRenderer.invoke('cli:status'),

  // Returns an unsubscribe function that removes only this specific listener
  onCliOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('cli:output', handler);
    return () => ipcRenderer.removeListener('cli:output', handler);
  },
});
