/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import { loadSettings } from './settings';
import { loadAuthState } from './auth';

export interface GeminiModel {
  id: string;
  name: string;
  tier: 'free' | 'preview' | 'limited';
  description: string;
}

export const AVAILABLE_MODELS: GeminiModel[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    tier: 'free',
    description: 'Rapide · Gratuit',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    tier: 'free',
    description: 'Ultra rapide · Gratuit',
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    tier: 'preview',
    description: 'Nouvelle gen · Gratuit',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    tier: 'limited',
    description: 'Pro · Limité',
  },
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro Preview',
    tier: 'preview',
    description: 'Preview Pro · Limité',
  },
];

export interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface AttachedFile {
  name: string;
  mimeType: string;
  content: string;
  isImage: boolean;
  size: number;
}

// 10 MB per file, 30 MB total across all files
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 30 * 1024 * 1024;

export function validateAttachedFiles(files: AttachedFile[]): void {
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      throw new Error(
        `Le fichier "${f.name}" dépasse la limite de 10 MB (${(f.size / 1048576).toFixed(1)} MB).`,
      );
    }
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_SIZE) {
    throw new Error(
      `La taille totale des fichiers (${(total / 1048576).toFixed(1)} MB) dépasse la limite de 30 MB.`,
    );
  }
}

// APIs require history to start with a 'user' message — strip any leading model turns
function toApiHistory(history: Message[]): Message[] {
  const first = history.findIndex((m) => m.role === 'user');
  return first === -1 ? [] : history.slice(first);
}

// ── Route: OAuth via Electron (Code Assist API — no API key) ─────────────────

async function sendViaElectronOAuth(
  prompt: string,
  history: Message[],
  attachedFiles: AttachedFile[],
  modelId: string,
): Promise<string> {
  const api = window.electronAPI;
  if (!api) throw new Error('Electron API not available');

  const fileContext = attachedFiles
    .filter((f) => !f.isImage)
    .map((f) => `[Fichier: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const fullPrompt = fileContext ? `${fileContext}\n\n${prompt}` : prompt;

  const messages: Array<{ role: string; content: string }> = [
    ...toApiHistory(history),
    { role: 'user', content: fullPrompt },
  ];

  const result = await api.geminiGenerate({ messages, model: modelId });

  if (!result.ok) {
    throw new Error(result.error ?? 'Erreur API Code Assist');
  }
  const text = result.text ?? '';
  if (!text) throw new Error('Le modèle a retourné une réponse vide.');
  return text;
}

// ── Route: API key (standard Gemini SDK) ─────────────────────────────────────

async function sendViaApiKey(
  prompt: string,
  history: Message[],
  attachedFiles: AttachedFile[],
  modelId: string,
  apiKey: string,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });

  const chat = model.startChat({
    history: toApiHistory(history).map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    })),
  });

  const parts: Part[] = [];

  for (const file of attachedFiles) {
    if (file.isImage) {
      parts.push({
        inlineData: { mimeType: file.mimeType, data: file.content },
      });
    } else {
      parts.push({
        text: `[Fichier: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\`\n`,
      });
    }
  }

  parts.push({ text: prompt });

  const result = await chat.sendMessage(parts);
  const text = result.response.text();
  if (!text) throw new Error('Le modèle a retourné une réponse vide.');
  return text;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const sendMessageToGemini = async (
  prompt: string,
  history: Message[],
  attachedFiles: AttachedFile[] = [],
  modelId?: string,
): Promise<string> => {
  validateAttachedFiles(attachedFiles);

  const settings = loadSettings();
  const authState = loadAuthState();
  const resolvedModel = modelId ?? settings.selectedModel;

  // Prefer OAuth (no API key) when running in Electron and authenticated
  if (
    authState.mode === 'google_oauth' &&
    authState.isAuthenticated &&
    typeof window !== 'undefined' &&
    window.electronAPI?.isElectron
  ) {
    return sendViaElectronOAuth(prompt, history, attachedFiles, resolvedModel);
  }

  // Fallback: API key mode
  const apiKey = settings.geminiApiKey;
  if (!apiKey) {
    throw new Error(
      'Aucune authentification configurée.\n' +
        'Connectez-vous avec Google (⚙ Paramètres) ou ajoutez une clé API.',
    );
  }

  return sendViaApiKey(prompt, history, attachedFiles, resolvedModel, apiKey);
};
