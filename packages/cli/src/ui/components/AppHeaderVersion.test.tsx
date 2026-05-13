/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { AppHeader } from './AppHeader.js';
import { describe, it, expect, vi } from 'vitest';

// Mock dependencies to avoid complex setup
vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    isAppleTerminal: () => false,
  };
});

describe('AppHeader Version Rendering', () => {
  it('renders nightly version with a small tag instead of long string', async () => {
    const version = '0.42.0-nightly.20260428.g59b2dea0e';
    const { lastFrame } = await renderWithProviders(
      <AppHeader version={version} />
    );

    // Desired: Gemini CLI v0.42.0 [nightly]
    expect(lastFrame()).toContain('Gemini CLI v0.42.0 [nightly]');
    expect(lastFrame()).not.toContain(version);
  });

  it('renders preview version with a small tag', async () => {
    const version = '0.42.0-preview.1';
    const { lastFrame } = await renderWithProviders(
      <AppHeader version={version} />
    );

    expect(lastFrame()).toContain('Gemini CLI v0.42.0 [preview]');
    expect(lastFrame()).not.toContain(version);
  });

  it('renders standard version without tag', async () => {
    const version = '0.42.0';
    const { lastFrame } = await renderWithProviders(
      <AppHeader version={version} />
    );

    expect(lastFrame()).toContain('Gemini CLI v0.42.0');
    expect(lastFrame()).not.toContain('[');
  });
});
