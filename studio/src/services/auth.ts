/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type AuthMode = 'google_oauth' | 'api_key';

export interface AuthState {
  mode: AuthMode;
  email?: string;
  isAuthenticated: boolean;
}

const AUTH_KEY = 'gemini_auth_state';

export const loadAuthState = (): AuthState => {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) return JSON.parse(raw) as AuthState;
  } catch {
    // ignore
  }
  return { mode: 'api_key', isAuthenticated: false };
};

export const saveAuthState = (state: AuthState): void => {
  localStorage.setItem(AUTH_KEY, JSON.stringify(state));
};

// ── Electron API types ────────────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI?: {
      isElectron: true;
      // OAuth
      oauthStart: () => Promise<{
        ok: boolean;
        email?: string;
        error?: string;
      }>;
      oauthStatus: () => Promise<{
        authenticated: boolean;
        email?: string;
        expired?: boolean;
      }>;
      oauthLogout: () => Promise<{ ok: boolean }>;
      // Gemini Code Assist API
      geminiGenerate: (params: {
        messages: Array<{ role: string; content: string }>;
        model: string;
      }) => Promise<{
        ok: boolean;
        text?: string;
        error?: string;
        usage?: {
          promptTokens: number;
          responseTokens: number;
          totalTokens: number;
        };
      }>;
      // CLI background process
      cliStart: () => Promise<{
        ok: boolean;
        running?: boolean;
        error?: string;
      }>;
      cliSend: (params: {
        text: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      cliStop: () => Promise<{ ok: boolean }>;
      cliStatus: () => Promise<{ running: boolean }>;
      onCliOutput: (
        callback: (data: { type: string; text: string }) => void,
      ) => () => void;
    };
  }
}

export const isElectron = (): boolean =>
  typeof window !== 'undefined' && window.electronAPI?.isElectron === true;

// ── OAuth actions ─────────────────────────────────────────────────────────────

/**
 * Starts the Google OAuth login flow via Electron's local callback server.
 * This is the same flow as `gemini auth login` in the native CLI.
 */
export const startGoogleOAuth = async (): Promise<{
  ok: boolean;
  message?: string;
}> => {
  if (!isElectron() || !window.electronAPI) {
    return {
      ok: false,
      message:
        "La connexion Google nécessite l'application desktop. " +
        'Téléchargez et installez Gemini CLI Studio pour utiliser OAuth.',
    };
  }

  const result = await window.electronAPI.oauthStart();
  if (result.ok) {
    const state: AuthState = {
      mode: 'google_oauth',
      isAuthenticated: true,
      email: result.email,
    };
    saveAuthState(state);
    return {
      ok: true,
      message: `Connecté : ${result.email || 'compte Google'}`,
    };
  }
  return { ok: false, message: result.error ?? 'Erreur lors de la connexion.' };
};

/**
 * Checks the current OAuth status from Electron main (reads ~/.gemini/oauth_creds.json).
 */
export const checkOAuthStatus = async (): Promise<AuthState> => {
  if (!isElectron() || !window.electronAPI) {
    return loadAuthState();
  }
  const status = await window.electronAPI.oauthStatus();
  const state: AuthState = {
    mode: 'google_oauth',
    isAuthenticated: status.authenticated,
    email: status.email,
  };
  if (status.authenticated) saveAuthState(state);
  return state;
};

export const logoutGoogle = async (): Promise<void> => {
  if (isElectron() && window.electronAPI) {
    await window.electronAPI.oauthLogout();
  }
  saveAuthState({ mode: 'api_key', isAuthenticated: false });
};
