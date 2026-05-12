/**
 * Gemini CLI Studio — Electron main process
 */
/* eslint-disable */
const { app, BrowserWindow, shell, Menu, ipcMain, protocol } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
    backgroundColor: '#0a0a0c',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    title: 'Gemini CLI Studio',
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Google OAuth via system browser ──────────────────────────────────────────
// Opens the Google OAuth flow in the default browser, same as `gemini auth login`.
// The CLI stores credentials in ~/.gemini/. We read them back and send to renderer.

const GEMINI_CREDENTIALS_PATH = path.join(
  os.homedir(),
  '.gemini',
  'oauth_creds.json',
);

ipcMain.handle('oauth:start', async () => {
  return new Promise((resolve, reject) => {
    // Try to use the installed `gemini` CLI to trigger OAuth login
    const geminiBin = process.platform === 'win32' ? 'gemini.cmd' : 'gemini';
    const child = execFile(
      geminiBin,
      ['auth', 'login', '--no-interactive'],
      { timeout: 120000 },
      (err) => {
        if (err) {
          // Fallback: open Google OAuth in browser manually
          const clientId =
            '681255809680-s8ksldpdn5oc5j2o7bkgp5bk9vr1nrre.apps.googleusercontent.com';
          const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
          const scope = encodeURIComponent(
            'https://www.googleapis.com/auth/generative-language.retriever ' +
              'https://www.googleapis.com/auth/cloud-platform',
          );
          const authUrl =
            `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${clientId}&redirect_uri=${redirectUri}` +
            `&response_type=code&scope=${scope}&access_type=offline`;
          shell.openExternal(authUrl);
          resolve({ status: 'browser_opened', authUrl });
        } else {
          resolve({ status: 'success' });
        }
      },
    );
    child.stdout?.on('data', (d) => console.log('[gemini oauth]', d.toString()));
    child.stderr?.on('data', (d) => console.error('[gemini oauth err]', d.toString()));
  });
});

ipcMain.handle('oauth:read-credentials', () => {
  try {
    if (fs.existsSync(GEMINI_CREDENTIALS_PATH)) {
      const raw = fs.readFileSync(GEMINI_CREDENTIALS_PATH, 'utf-8');
      return { ok: true, data: JSON.parse(raw) };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('oauth:logout', () => {
  try {
    if (fs.existsSync(GEMINI_CREDENTIALS_PATH)) {
      fs.unlinkSync(GEMINI_CREDENTIALS_PATH);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
