/**
 * Gemini CLI Studio — Electron main process
 * Handles: OAuth (same flow as native CLI), Code Assist API proxy, CLI background process
 */
/* eslint-disable */
'use strict';

const {
  app,
  BrowserWindow,
  shell,
  Menu,
  ipcMain,
} = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

// ── Constants (same as the native CLI) ───────────────────────────────────────

const OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';
const SIGN_IN_SUCCESS_URL =
  'https://developers.google.com/gemini-code-assist/auth_success_gemini';
const SIGN_IN_FAILURE_URL =
  'https://developers.google.com/gemini-code-assist/auth_failure_gemini';

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const OAUTH_CREDS_PATH = path.join(GEMINI_DIR, 'oauth_creds.json');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;
let cliProcess = null;
let cliStarting = false;

// ── Window ────────────────────────────────────────────────────────────────────

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
      webSecurity: true,
    },
    backgroundColor: '#0a0a0c',
    show: false,
    autoHideMenuBar: true,
    title: 'Gemini CLI Studio',
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsPostJson(url, body, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: `Bearer ${token}`,
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function saveCreds(creds) {
  try {
    fs.mkdirSync(GEMINI_DIR, { recursive: true });
    fs.writeFileSync(OAUTH_CREDS_PATH, JSON.stringify(creds, null, 2), {
      mode: 0o600,
    });
    try { fs.chmodSync(OAUTH_CREDS_PATH, 0o600); } catch {}
  } catch (e) {
    console.error('[OAuth] Failed to save credentials:', e.message);
  }
}

function loadCreds() {
  try {
    if (fs.existsSync(OAUTH_CREDS_PATH)) {
      return JSON.parse(fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8'));
    }
  } catch {}
  return null;
}

function isTokenExpired(creds) {
  if (!creds || !creds.expiry_date) return true;
  // Consider expired 5 min before actual expiry
  return Date.now() >= creds.expiry_date - 5 * 60 * 1000;
}

async function refreshToken(creds) {
  if (!creds || !creds.refresh_token) throw new Error('No refresh token');
  const result = await httpsPost(TOKEN_ENDPOINT, {
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });
  if (result.status !== 200 || !result.body.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(result.body)}`);
  }
  const updated = {
    ...creds,
    access_token: result.body.access_token,
    expiry_date: Date.now() + (result.body.expires_in || 3600) * 1000,
    token_type: result.body.token_type || 'Bearer',
  };
  saveCreds(updated);
  return updated;
}

async function getValidAccessToken() {
  let creds = loadCreds();
  if (!creds || !creds.access_token) {
    throw new Error('Not authenticated. Please login with Google first.');
  }
  if (isTokenExpired(creds)) {
    creds = await refreshToken(creds);
  }
  return creds.access_token;
}

// ── IPC: OAuth ────────────────────────────────────────────────────────────────

ipcMain.handle('oauth:start', async () => {
  try {
    const port = await getAvailablePort();
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
    const state = crypto.randomBytes(32).toString('hex');

    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();

    // Start local callback server
    const loginPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Authentication timed out (5 min)')),
        5 * 60 * 1000,
      );

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
          if (!reqUrl.pathname.startsWith('/oauth2callback')) {
            res.writeHead(302, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            return;
          }

          if (reqUrl.searchParams.get('state') !== state) {
            res.writeHead(302, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            reject(new Error('State mismatch'));
            return;
          }

          const error = reqUrl.searchParams.get('error');
          if (error) {
            res.writeHead(302, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          const code = reqUrl.searchParams.get('code');
          if (!code) {
            reject(new Error('No authorization code received'));
            return;
          }

          // Exchange code for tokens
          const tokenResult = await httpsPost(TOKEN_ENDPOINT, {
            code,
            client_id: OAUTH_CLIENT_ID,
            client_secret: OAUTH_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          });

          if (tokenResult.status !== 200 || !tokenResult.body.access_token) {
            res.writeHead(302, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            reject(new Error('Token exchange failed'));
            return;
          }

          const tokens = tokenResult.body;
          const expiresIn = Number(tokens.expires_in);
          const creds = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_type: tokens.token_type || 'Bearer',
            expiry_date: Date.now() + (isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
            scope: tokens.scope,
          };
          saveCreds(creds);

          res.writeHead(302, { Location: SIGN_IN_SUCCESS_URL });
          res.end();
          resolve(creds);
        } catch (e) {
          reject(e);
        } finally {
          clearTimeout(timeout);
          server.close();
        }
      });

      server.listen(port, '127.0.0.1');
      server.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });

    // Open browser
    shell.openExternal(authUrl);

    await loginPromise;

    // Fetch user email
    let email = '';
    try {
      const token = await getValidAccessToken();
      const resp = await new Promise((resolve) => {
        const req = https.get(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          { headers: { Authorization: `Bearer ${token}` } },
          (res) => {
            let raw = '';
            res.on('data', (c) => (raw += c));
            res.on('end', () => resolve(JSON.parse(raw)));
          },
        );
        req.on('error', () => resolve({}));
      });
      email = resp.email || '';
      if (email) {
        const creds = loadCreds();
        if (creds) { creds.email = email; saveCreds(creds); }
      }
    } catch {}

    return { ok: true, email };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('oauth:status', () => {
  const creds = loadCreds();
  if (!creds || !creds.access_token) return { authenticated: false };
  return {
    authenticated: true,
    email: creds.email || '',
    expired: isTokenExpired(creds),
  };
});

ipcMain.handle('oauth:logout', async () => {
  try {
    // Optionally revoke token
    const creds = loadCreds();
    if (creds && creds.access_token) {
      https.get(
        `https://oauth2.googleapis.com/revoke?token=${creds.access_token}`,
        () => {},
      ).on('error', () => {});
    }
    if (fs.existsSync(OAUTH_CREDS_PATH)) fs.unlinkSync(OAUTH_CREDS_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Gemini API (Code Assist — no API key needed) ─────────────────────────

ipcMain.handle('gemini:generate', async (_event, { messages, model }) => {
  try {
    const token = await getValidAccessToken();

    // Build Code Assist request format
    const contents = messages.map((msg) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    // Strip 'models/' prefix if present — Code Assist API uses bare model IDs
    const resolvedModel = (model || 'gemini-2.5-flash').replace(/^models\//, '');
    // Only gemini-2.5+ models support thinkingConfig — 2.0 and older will 400 if sent
    const supportsThinking = /^gemini-2\.5|^gemini-3/.test(resolvedModel);
    const caRequest = {
      model: resolvedModel,
      user_prompt_id: crypto.randomUUID(),
      request: {
        contents,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.7,
          ...(supportsThinking && { thinkingConfig: { thinkingBudget: 0 } }),
        },
      },
    };

    const result = await httpsPostJson(
      `${CODE_ASSIST_BASE}:generateContent`,
      caRequest,
      token,
    );

    if (result.status !== 200) {
      const errBody = result.body;
      const errMsg = errBody?.error?.message || JSON.stringify(errBody);
      throw new Error(`Code Assist API error ${result.status}: ${errMsg}`);
    }

    // Extract text from response — handle both wrapped and unwrapped formats
    const body = result.body;
    if (body?.error) {
      throw new Error(`Code Assist API: ${body.error.message || JSON.stringify(body.error)}`);
    }
    const response = body.response || body;
    const candidate = response.candidates?.[0];
    if (!candidate) throw new Error('Aucune réponse du modèle (no candidates). Essayez un autre modèle.');
    const finishReason = candidate.finishReason;
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new Error(`Réponse bloquée par les filtres de sécurité (${finishReason}).`);
    }
    const text = candidate.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) throw new Error('Le modèle a retourné une réponse vide.');
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: CLI background process ───────────────────────────────────────────────

ipcMain.handle('cli:start', async () => {
  if (cliProcess || cliStarting) return { ok: true, running: true };
  cliStarting = true;

  try {
    const geminiBin = process.platform === 'win32' ? 'gemini.cmd' : 'gemini';
    const cliArgs = ['--model', 'gemini-2.5-flash', '--yolo'];

    cliProcess = spawn(geminiBin, cliArgs, {
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    cliProcess.stdout.on('data', (data) => {
      mainWindow?.webContents.send('cli:output', {
        type: 'stdout',
        text: data.toString(),
      });
    });

    cliProcess.stderr.on('data', (data) => {
      mainWindow?.webContents.send('cli:output', {
        type: 'stderr',
        text: data.toString(),
      });
    });

    cliProcess.on('close', (code) => {
      cliProcess = null;
      cliStarting = false;
      mainWindow?.webContents.send('cli:output', {
        type: 'exit',
        text: `CLI exited with code ${code}`,
      });
    });

    cliProcess.on('error', (err) => {
      cliProcess = null;
      cliStarting = false;
      mainWindow?.webContents.send('cli:output', {
        type: 'error',
        text: `CLI error: ${err.message}`,
      });
    });

    cliStarting = false;
    return { ok: true, running: true };
  } catch (e) {
    cliStarting = false;
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('cli:send', (_event, { text }) => {
  if (typeof text !== 'string' || text.length > 32_768) {
    return { ok: false, error: 'Invalid input' };
  }
  if (!cliProcess || !cliProcess.stdin.writable) {
    return { ok: false, error: 'CLI not running' };
  }
  try {
    cliProcess.stdin.write(text + '\n');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('cli:stop', () => {
  if (cliProcess) {
    cliProcess.kill();
    cliProcess = null;
  }
  return { ok: true };
});

ipcMain.handle('cli:status', () => ({
  running: cliProcess !== null && !cliProcess.killed,
}));

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (cliProcess) { try { cliProcess.kill(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});
