/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as osActual from 'node:os';

// Mock 'os'
vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof osActual>();
  return {
    ...actualOs,
    homedir: vi.fn(() => '/mock/home/user'),
    platform: vi.fn(() => 'linux'),
  };
});

// Mock trustedFolders
vi.mock('./trustedFolders.js', () => ({
  isWorkspaceTrusted: vi
    .fn()
    .mockReturnValue({ isTrusted: true, source: 'file' }),
}));

import { isWorkspaceTrusted } from './trustedFolders.js';
import { loadSettings, SettingScope } from './settings.js';

vi.mock('fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof fs>();
  return {
    ...actualFs,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    realpathSync: (p: string) => p,
  };
});

const mockCoreEvents = vi.hoisted(() => ({
  emitFeedback: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  emitSettingsChanged: vi.fn(),
}));

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    coreEvents: mockCoreEvents,
    CoreEvent: actual.CoreEvent,
  };
});

import { updateSettingsFilePreservingFormat } from '../utils/commentJson.js';
vi.mock('../utils/commentJson.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../utils/commentJson.js')>();
  return {
    ...actual,
    updateSettingsFilePreservingFormat: vi.fn(),
  };
});

describe('Issue 25428 Regression', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isWorkspaceTrusted).mockReturnValue({
      isTrusted: true,
      source: 'file',
    });
    vi.mocked(osActual.homedir).mockReturnValue('/mock/home/user');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it('should load settings from a file with trailing commas', () => {
    const contentWithComma = '{ "ui": { "compactToolOutput": true, } }';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(contentWithComma);

    const settings = loadSettings('/mock/workspace-' + Math.random());

    expect(settings.user.settings.ui?.compactToolOutput).toBe(true);
  });

  it('should migrate settings granularly without nuking sibling keys', () => {
    const initialContent = {
      experimental: {
        plan: true,
        keepMe: 'important',
      },
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(initialContent));

    const settings = loadSettings('/mock/workspace-' + Math.random());

    expect(settings.user.settings.general?.plan?.enabled).toBe(true);
    expect(
      (settings.user.settings.experimental as Record<string, unknown>)?.[
        'plan'
      ],
    ).toBeUndefined();
    expect(
      (settings.user.settings.experimental as Record<string, unknown>)?.[
        'keepMe'
      ],
    ).toBe('important');

    expect(updateSettingsFilePreservingFormat).toHaveBeenCalled();
    const lastCall = vi
      .mocked(updateSettingsFilePreservingFormat)
      .mock.calls.at(-1);
    const savedSettings = lastCall![1];

    const experimental = savedSettings['experimental'] as Record<
      string,
      unknown
    >;
    expect(experimental['keepMe']).toBe('important');
    expect(experimental['plan']).toBeUndefined();
  });

  it('should update specific settings without affecting raw siblings', () => {
    const initialContent = {
      ui: {
        compactToolOutput: true,
        footer: {
          hideSandboxStatus: false,
        },
      },
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(initialContent));

    const settings = loadSettings('/mock/workspace-' + Math.random());

    settings.setValue(SettingScope.User, 'ui.footer.hideSandboxStatus', true);

    expect(updateSettingsFilePreservingFormat).toHaveBeenCalled();
    const lastCall = vi
      .mocked(updateSettingsFilePreservingFormat)
      .mock.calls.at(-1);
    const savedSettings = lastCall![1];

    const ui = savedSettings['ui'] as Record<string, unknown>;
    expect(ui['compactToolOutput']).toBe(true);
    const footer = ui['footer'] as Record<string, unknown>;
    expect(footer['hideSandboxStatus']).toBe(true);
  });
});
