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
const VALID_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite-preview-06-17',
  'gemini-2.5-pro',
];

const defaults: AppSettings = {
  geminiApiKey: '',
  githubToken: '',
  selectedModel: 'gemini-2.5-flash',
};

export const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        geminiApiKey:
          typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
        githubToken:
          typeof parsed.githubToken === 'string' ? parsed.githubToken : '',
        selectedModel:
          typeof parsed.selectedModel === 'string' &&
          VALID_MODELS.includes(parsed.selectedModel)
            ? parsed.selectedModel
            : defaults.selectedModel,
      };
    }
  } catch {
    // ignore malformed JSON
  }
  return { ...defaults };
};

export const saveSettings = (patch: Partial<AppSettings>): AppSettings => {
  const next = { ...loadSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
};
