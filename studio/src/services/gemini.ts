/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenerativeAI, type Part } from '@google/generative-ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

export const geminiModel = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
});

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
): Promise<string> => {
  if (!API_KEY) {
    throw new Error(
      'Gemini API Key manquante. Ajoutez VITE_GEMINI_API_KEY dans le fichier .env',
    );
  }

  const chat = geminiModel.startChat({
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
