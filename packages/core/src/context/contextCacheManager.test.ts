/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextCacheManager } from './contextCacheManager.js';
import { Storage } from '../config/storage.js';
import * as fs from 'node:fs';

vi.mock('node:fs');
vi.mock('../config/storage.js');

describe('ContextCacheManager', () => {
  let manager: ContextCacheManager;
  const mockMetadataPath = '/test/metadata.json';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Storage.getContextCacheMetadataPath).mockReturnValue(
      mockMetadataPath,
    );
    manager = new ContextCacheManager();
  });

  it('should calculate stable SHA-256 hash', () => {
    const si = 'You are a helpful assistant.';
    const hash1 = manager.calculateHash(si);
    const hash2 = manager.calculateHash(si);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should return undefined if cache not found', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(manager.getCache('nonexistent')).toBeUndefined();
  });

  it('should return entry if valid cache found', () => {
    const hash = 'testhash';
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const entry = {
      cacheName: 'cachedContents/123',
      model: 'gemini-pro',
      expiresAt: futureDate,
      tokenCount: 1000,
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        version: '1.0',
        entries: { [hash]: entry },
      }),
    );

    const result = manager.getCache(hash);
    expect(result).toEqual(entry);
  });

  it('should purge and return undefined if cache expired', () => {
    const hash = 'expiredhash';
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    const entry = {
      cacheName: 'cachedContents/expired',
      model: 'gemini-pro',
      expiresAt: pastDate,
      tokenCount: 1000,
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        version: '1.0',
        entries: { [hash]: entry },
      }),
    );

    const result = manager.getCache(hash);
    expect(result).toBeUndefined();
    expect(fs.writeFileSync).toHaveBeenCalled();
    const saved = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(saved.entries[hash]).toBeUndefined();
  });

  it('should save metadata when setCache is called', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const hash = 'newhash';
    const entry = {
      cacheName: 'cachedContents/new',
      model: 'gemini-pro',
      expiresAt: new Date().toISOString(),
      tokenCount: 1000,
    };

    manager.setCache(hash, entry);
    expect(fs.writeFileSync).toHaveBeenCalled();
    const saved = JSON.parse(
      vi.mocked(fs.writeFileSync).mock.calls[0][1] as string,
    );
    expect(saved.entries[hash]).toEqual(entry);
  });
});
