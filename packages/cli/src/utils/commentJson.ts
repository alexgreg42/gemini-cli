/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import { parse as commentJsonParse, stringify } from 'comment-json';
export { commentJsonParse as parse, stringify };

/**
 * Updates a JSON file while preserving comments and formatting.
 *
 * This minimal version relies on the fact that the 'updates' object
 * already contains the comment-json metadata (Symbols) because we
 * avoided stripping them in settings.ts.
 */
export function updateSettingsFilePreservingFormat(
  filePath: string,
  updates: Record<string, unknown>,
): void {
  // Directly stringify the updates object which should have metadata
  const updatedContent = stringify(updates, null, 2);
  fs.writeFileSync(filePath, updatedContent, 'utf-8');
}
