/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AppSettings {
  geminiApiKey: string;
  githubToken: string;
  selectedModel: string;
}

const KEY = 'gemini_studio_settings';

const defaults: AppSettings = {
  geminiApiKey: (import.meta.env.VITE_GEMINI_API_KEY as string) ?? '',
  githubToken: (import.meta.env.VITE_GITHUB_TOKEN as string) ?? '',
  selectedModel: 'gemini-2.5-flash',
};

export const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...defaults };
};

export const saveSettings = (patch: Partial<AppSettings>): AppSettings => {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
};
