/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auth modes matching the CLI's AuthType enum.
 * - google_oauth : Login with Google (free unlimited tokens via Code Assist)
 * - api_key      : Gemini API key (paid / limited free tier)
 */
export type AuthMode = 'google_oauth' | 'api_key';

export interface AuthState {
  mode: AuthMode;
  /** Email of the logged-in Google account, if available */
  googleEmail?: string;
  /** True when an OAuth token is present */
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

// ── Google OAuth (via Electron IPC or browser redirect) ────────────────────

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      oauthStart: () => Promise<{ status: string; authUrl?: string }>;
      oauthReadCredentials: () => Promise<{ ok: boolean; data?: unknown }>;
      oauthLogout: () => Promise<{ ok: boolean }>;
    };
  }
}

export const isElectron = (): boolean =>
  typeof window !== 'undefined' && window.electronAPI?.isElectron === true;

/**
 * Starts the Google OAuth flow.
 * - In Electron: triggers the CLI's `gemini auth login` or opens browser.
 * - In browser: redirects to Google OAuth consent screen.
 * Returns a promise that resolves when the flow completes or opens.
 */
export const startGoogleOAuth = async (): Promise<{
  ok: boolean;
  message?: string;
}> => {
  if (isElectron() && window.electronAPI) {
    const result = await window.electronAPI.oauthStart();
    if (result.status === 'success') {
      const creds = await window.electronAPI.oauthReadCredentials();
      if (creds.ok) {
        const state: AuthState = {
          mode: 'google_oauth',
          isAuthenticated: true,
        };
        saveAuthState(state);
        return { ok: true };
      }
    }
    if (result.status === 'browser_opened') {
      return {
        ok: false,
        message:
          'Connexion ouverte dans le navigateur. Après autorisation, revenez ici et cliquez "Vérifier la connexion".',
      };
    }
    return { ok: false, message: 'Erreur lors du login Google.' };
  }

  // Browser mode: redirect to Google OAuth
  const CLIENT_ID =
    '681255809680-s8ksldpdn5oc5j2o7bkgp5bk9vr1nrre.apps.googleusercontent.com';
  const REDIRECT_URI = `${window.location.origin}/oauth-callback`;
  const SCOPE = [
    'https://www.googleapis.com/auth/generative-language.retriever',
    'openid',
    'email',
    'profile',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
  });

  window.open(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    '_blank',
    'width=500,height=620',
  );

  return {
    ok: false,
    message:
      'Fenêtre de connexion Google ouverte. Après autorisation, cliquez "Vérifier la connexion".',
  };
};

export const logoutGoogle = async (): Promise<void> => {
  if (isElectron() && window.electronAPI) {
    await window.electronAPI.oauthLogout();
  }
  saveAuthState({ mode: 'api_key', isAuthenticated: false });
};

/**
 * Checks whether the CLI has stored OAuth credentials on disk.
 * Only works in Electron (has filesystem access).
 */
export const checkOAuthCredentials = async (): Promise<boolean> => {
  if (isElectron() && window.electronAPI) {
    const result = await window.electronAPI.oauthReadCredentials();
    if (result.ok) {
      const state: AuthState = {
        mode: 'google_oauth',
        isAuthenticated: true,
      };
      saveAuthState(state);
      return true;
    }
  }
  return false;
};
