/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentResponse,
  type CountTokensResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  EmbedContentResponse,
  type EmbedContentParameters,
} from '@google/genai';
import { promises } from 'node:fs';
import type { ContentGenerator } from './contentGenerator.js';
import type { UserTierId, GeminiUserTier } from '../code_assist/types.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import type { LlmRole } from '../telemetry/types.js';
import type { FakeResponse } from './fakeContentGenerator.js';

/**
 * A ContentGenerator that responds with canned responses, but unlike FakeContentGenerator,
 * it is "non-strict": it will find and use the first available response that matches
 * the requested method, rather than strictly following the input order.
 *
 * This is useful for testing asynchronous or non-deterministic background tasks
 * (like token calibration or background snapshots) that might fire out-of-order.
 */
export class NonStrictFakeContentGenerator implements ContentGenerator {
  userTier?: UserTierId;
  userTierName?: string;
  paidTier?: GeminiUserTier;

  constructor(private readonly responses: FakeResponse[]) {}

  static async fromFile(
    filePath: string,
  ): Promise<NonStrictFakeContentGenerator> {
    const fileContent = await promises.readFile(filePath, 'utf-8');
    const responses = fileContent
      .split('\n')
      .filter((line) => line.trim() !== '')
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      .map((line) => JSON.parse(line) as FakeResponse);
    return new NonStrictFakeContentGenerator(responses);
  }

  private getNextResponse<
    M extends FakeResponse['method'],
    R = Extract<FakeResponse, { method: M }>['response'],
  >(method: M, request: unknown): R {
    const index = this.responses.findIndex((r) => r.method === method);
    if (index === -1) {
      throw new Error(
        `No more mock responses for ${method}, got request:\n` +
          safeJsonStringify(request),
      );
    }
    const response = this.responses.splice(index, 1)[0];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return response.response as R;
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    role: LlmRole,
  ): Promise<GenerateContentResponse> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return Object.setPrototypeOf(
      this.getNextResponse('generateContent', request),
      GenerateContentResponse.prototype,
    );
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const responses = this.getNextResponse('generateContentStream', request);
    async function* stream() {
      for (const response of responses) {
        yield Object.setPrototypeOf(
          response,
          GenerateContentResponse.prototype,
        );
      }
    }
    return stream();
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    return this.getNextResponse('countTokens', request);
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return Object.setPrototypeOf(
      this.getNextResponse('embedContent', request),
      EmbedContentResponse.prototype,
    );
  }
}
