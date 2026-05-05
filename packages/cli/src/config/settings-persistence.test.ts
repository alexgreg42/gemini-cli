/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as fs from 'node:fs';

// Mock 'os' and 'fs' before importing settings
vi.mock('node:os', () => ({
  homedir: () => '/mock/home',
  platform: () => 'linux',
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  realpathSync: vi.fn((p) => p),
  PathLike: {},
}));

import { loadSettings, USER_SETTINGS_PATH, SettingScope } from './settings.js';

describe('Settings Persistence', () => {
  const MOCK_WORKSPACE_DIR = '/mock/workspace';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should persist a nested setting and preserve comments', () => {
    const initialContent = `{
      // This is a comment
      "ui": {
        "theme": "dark"
      }
    }`;

    let currentContent = initialContent;

    (fs.existsSync as Mock).mockImplementation((p) => p === USER_SETTINGS_PATH);
    (fs.readFileSync as Mock).mockImplementation((p) => {
      if (p === USER_SETTINGS_PATH) return currentContent;
      return '{}';
    });
    (fs.writeFileSync as Mock).mockImplementation((p, content) => {
      if (p === USER_SETTINGS_PATH) currentContent = content;
    });

    // 1. Load
    const settings = loadSettings(MOCK_WORKSPACE_DIR);
    expect(settings.merged.ui?.theme).toBe('dark');

    // 2. Modify
    settings.setValue(SettingScope.User, 'ui.theme', 'light');

    // 3. Verify content
    expect(currentContent).toContain('"theme": "light"');
    expect(currentContent).toContain('// This is a comment');

    // 4. Modify another key
    settings.setValue(SettingScope.User, 'model.name', 'gemini-2.0-flash');

    // 5. Verify both are present
    expect(currentContent).toContain('"theme": "light"');
    expect(currentContent).toContain('"name": "gemini-2.0-flash"');
    expect(currentContent).toContain('// This is a comment');
  });
});
