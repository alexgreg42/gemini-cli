/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import {
  type SessionFile,
  type Storage,
  loadConversationRecord,
} from '@google/gemini-cli-core';

import { GeminiCliSession } from './session.js';
import type { GeminiCliAgentOptions } from './types.js';

/**
 * The main entry point for the Gemini CLI SDK.
 * Provides access to chat sessions, file management, and agent orchestration.
 */
export class GeminiCliAgent {
  private readonly storage: Storage;
  private readonly options: GeminiCliAgentOptions;

  constructor(options: GeminiCliAgentOptions) {
    this.options = options;
    this.storage = options.storage;
  }

  /**
   * Creates a new chat session.
   * @returns A new GeminiCliSession instance.
   */
  async createSession(): Promise<GeminiCliSession> {
    const session = new GeminiCliSession(this.storage, this.options, this);
    await session.initialize();
    return session;
  }

  /**
   * Resumes an existing chat session by ID.
   * @param sessionId - The full or partial session ID to resume.
   * @returns A GeminiCliSession instance for the specified session.
   * @throws Error if the session cannot be found or is ambiguous.
   */
  async resumeSession(sessionId: string): Promise<GeminiCliSession> {
    const storage = this.storage;
    const sessions = await storage.listProjectChatFiles();

    if (sessions.length === 0) {
      throw new Error('No sessions found in this project.');
    }

    const truncatedId = sessionId.slice(0, 8);
    // Optimization: filenames include first 8 chars of sessionId.
    // Filter sessions that might match.
    const candidates = sessions.filter((s: { filePath: string }) =>
      s.filePath.includes(truncatedId),
    );

    // If optimization fails (e.g. old files), check all?
    const filesToCheck = candidates.length > 0 ? candidates : sessions;

    for (const sessionFile of filesToCheck) {
      const absolutePath = path.join(
        storage.getProjectTempDir(),
        sessionFile.filePath,
      );

      try {
        const record = await loadConversationRecord(absolutePath);
        if (record.sessionId === sessionId) {
          const session = new GeminiCliSession(
            this.storage,
            this.options,
            this,
            record,
          );
          await session.initialize();
          return session;
        }
      } catch (error) {
        // Skip unreadable or corrupted session files.
        console.warn(`[SDK] Failed to load session record from ${absolutePath}:`, error);
      }
    }

    throw new Error(`Session with ID "${sessionId}" not found.`);
  }

  /**
   * Lists all chat sessions in the current project.
   * @returns A list of session files.
   */
  async listSessions(): Promise<SessionFile[]> {
    return this.storage.listProjectChatFiles();
  }
}
