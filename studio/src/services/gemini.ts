/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';
import { loadSettings } from './settings';

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

export const sendMessageToGemini = async (
  prompt: string,
  history: Message[],
  attachedFiles: AttachedFile[] = [],
  modelId?: string,
): Promise<string> => {
  const settings = loadSettings();
  const apiKey = settings.geminiApiKey;

  if (!apiKey) {
    throw new Error(
      'Clé API Gemini manquante. Configurez-la dans les Paramètres ⚙.',
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId ?? settings.selectedModel,
  });

  const chat = model.startChat({
    history: history.map((msg) => ({
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
  return result.response.text();
};
