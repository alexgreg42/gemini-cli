/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openFileInEditor, EditorNotConfiguredError } from './editorUtils.js';
import {
  spawnSync,
  spawn,
  type SpawnSyncReturns,
  type ChildProcess,
} from 'node:child_process';
import {
  CoreEvent,
  coreEvents,
  getEditorCommand,
} from '@google/gemini-cli-core';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...original,
    coreEvents: {
      emit: vi.fn(),
      emitFeedback: vi.fn(),
    },
  };
});

describe('editorUtils', () => {
  beforeEach(() => {
    vi.stubEnv('VISUAL', '');
    vi.stubEnv('EDITOR', '');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw EditorNotConfiguredError if no editor is configured', async () => {
    await expect(openFileInEditor('test.txt', null, undefined)).rejects.toThrow(
      EditorNotConfiguredError,
    );
  });

  it('should use preferredEditorType if provided (terminal editor)', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
    } as SpawnSyncReturns<Buffer>);
    await openFileInEditor('test.txt', null, undefined, 'vim');
    expect(spawnSync).toHaveBeenCalledWith(
      getEditorCommand('vim'),
      expect.arrayContaining(['test.txt']),
      expect.anything(),
    );
    expect(coreEvents.emit).toHaveBeenCalledWith(
      CoreEvent.ExternalEditorClosed,
    );
  });

  it('should use preferredEditorType if provided (GUI editor)', async () => {
    const mockChild = {
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === 'close') cb(0);
        return mockChild;
      }),
    };
    vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);
    await openFileInEditor('test.txt', null, undefined, 'vscode');
    expect(spawn).toHaveBeenCalledWith(
      getEditorCommand('vscode'),
      expect.arrayContaining(['--wait', 'test.txt']),
      expect.anything(),
    );
    expect(coreEvents.emit).toHaveBeenCalledWith(
      CoreEvent.ExternalEditorClosed,
    );
  });

  it('should handle editor exit with non-zero status', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
    } as SpawnSyncReturns<Buffer>);
    await expect(
      openFileInEditor('test.txt', null, undefined, 'vim'),
    ).rejects.toThrow('External editor exited with status 1');
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      expect.any(String),
      expect.any(Error),
    );
  });
});
