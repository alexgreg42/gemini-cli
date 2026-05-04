/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../test-utils/render.js';
import { useTextBuffer } from './text-buffer.js';
import {
  openFileInEditor,
  EditorNotConfiguredError,
} from '../../utils/editorUtils.js';
import { coreEvents, CoreEvent } from '@google/gemini-cli-core';
import fs from 'node:fs';

vi.mock('node:fs', () => ({
  default: {
    mkdtempSync: vi.fn().mockReturnValue('/tmp/gemini-edit-123'),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('updated text'),
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
  },
}));

vi.mock('node:os', () => ({
  default: {
    tmpdir: vi.fn().mockReturnValue('/tmp'),
  },
}));

vi.mock('../../utils/editorUtils.js', () => ({
  openFileInEditor: vi.fn(),
  EditorNotConfiguredError: class extends Error {
    constructor() {
      super('No external editor configured');
      this.name = 'EditorNotConfiguredError';
    }
  },
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

describe('useTextBuffer external editor', () => {
  const viewport = { width: 80, height: 24 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit RequestEditorSelection when openFileInEditor throws EditorNotConfiguredError', async () => {
    vi.mocked(openFileInEditor).mockRejectedValue(
      new EditorNotConfiguredError(),
    );

    const { result } = await renderHook(() =>
      useTextBuffer({
        initialText: 'some text',
        viewport,
      }),
    );

    await act(async () => {
      await result.current.openInExternalEditor();
    });

    expect(coreEvents.emit).toHaveBeenCalledWith(
      CoreEvent.RequestEditorSelection,
    );
  });

  it('should update text when openFileInEditor succeeds', async () => {
    vi.mocked(openFileInEditor).mockResolvedValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue('updated text from editor');

    const { result } = await renderHook(() =>
      useTextBuffer({
        initialText: 'initial text',
        viewport,
      }),
    );

    await act(async () => {
      await result.current.openInExternalEditor();
    });

    expect(result.current.text).toBe('updated text from editor');
  });

  it('should log feedback error for other errors', async () => {
    const unexpectedError = new Error('Some unexpected error');
    vi.mocked(openFileInEditor).mockRejectedValue(unexpectedError);

    const { result } = await renderHook(() =>
      useTextBuffer({
        initialText: 'some text',
        viewport,
      }),
    );

    await act(async () => {
      await result.current.openInExternalEditor();
    });

    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      '[useTextBuffer] external editor error',
      unexpectedError,
    );
    expect(coreEvents.emit).not.toHaveBeenCalledWith(
      CoreEvent.RequestEditorSelection,
    );
  });
});
