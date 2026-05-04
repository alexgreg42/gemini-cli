/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type AgentLoopContext,
  AuthType,
  clearCachedCredentialFile,
  getVersion,
  loadApiKey,
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  Storage,
} from '@google/gemini-cli-core';
import * as acp from '@agentclientprotocol/sdk';
import { OAuth2Client, Compute } from 'google-auth-library';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { SettingScope, type LoadedSettings } from '../config/settings.js';
import type { CliArgs } from '../config/config.js';
import { getAcpErrorMessage } from './acpErrors.js';
import { AcpSessionManager, type AuthDetails } from './acpSessionManager.js';
import { hasMeta } from './acpUtils.js';

export class GeminiAgent {
  private apiKey: string | undefined;
  private baseUrl: string | undefined;
  private customHeaders: Record<string, string> | undefined;
  private sessionManager: AcpSessionManager;

  constructor(
    private context: AgentLoopContext,
    private settings: LoadedSettings,
    argv: CliArgs,
    connection: acp.AgentSideConnection,
  ) {
    this.sessionManager = new AcpSessionManager(settings, argv, connection);
  }

  dispose(): void {
    this.sessionManager.dispose();
  }

  async initialize(
    args: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    if (args.clientCapabilities) {
      this.sessionManager.setClientCapabilities(args.clientCapabilities);
    }

    const authMethods = [
      {
        id: AuthType.LOGIN_WITH_GOOGLE,
        name: 'Log in with Google',
        description: 'Log in with your Google account',
      },
      {
        id: AuthType.USE_GEMINI,
        name: 'Gemini API key',
        description: 'Use an API key with Gemini Developer API',
        _meta: {
          'api-key': {
            provider: 'google',
          },
        },
      },
      {
        id: AuthType.USE_VERTEX_AI,
        name: 'Vertex AI',
        description: 'Use an API key with Vertex AI GenAI API',
      },
      {
        id: AuthType.GATEWAY,
        name: 'AI API Gateway',
        description: 'Use a custom AI API Gateway',
        _meta: {
          gateway: {
            protocol: 'google',
            restartRequired: 'false',
          },
        },
      },
    ];

    await this.context.config.initialize();
    const version = await getVersion();
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      authMethods,
      agentInfo: {
        name: 'gemini-cli',
        title: 'Gemini CLI',
        version,
      },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: true,
        },
      },
    };
  }

  async authenticate(req: acp.AuthenticateRequest): Promise<void> {
    const { methodId } = req;
    const method = z.nativeEnum(AuthType).parse(methodId);
    const selectedAuthType = this.settings.merged.security.auth.selectedType;

    // Only clear credentials when switching to a different auth method
    if (selectedAuthType && selectedAuthType !== method) {
      await clearCachedCredentialFile();
    }
    // Check for api-key in _meta
    const meta = hasMeta(req) ? req._meta : undefined;
    const apiKey =
      typeof meta?.['api-key'] === 'string' ? meta['api-key'] : undefined;

    // Refresh auth with the requested method
    // This will reuse existing credentials if they're valid,
    // or perform new authentication if needed
    try {
      if (apiKey) {
        this.apiKey = apiKey;
      }

      // Extract gateway details if present
      const gatewaySchema = z.object({
        baseUrl: z.string().optional(),
        headers: z.record(z.string()).optional(),
      });

      let baseUrl: string | undefined;
      let headers: Record<string, string> | undefined;

      if (meta?.['gateway']) {
        const result = gatewaySchema.safeParse(meta['gateway']);
        if (result.success) {
          baseUrl = result.data.baseUrl;
          headers = result.data.headers;
        } else {
          throw new acp.RequestError(
            -32602,
            `Malformed gateway payload: ${result.error.message}`,
          );
        }
      }

      this.baseUrl = baseUrl;
      this.customHeaders = headers;

      await this.context.config.refreshAuth(
        method,
        apiKey ?? this.apiKey,
        baseUrl,
        headers,
      );
    } catch (e) {
      throw new acp.RequestError(-32000, getAcpErrorMessage(e));
    }
    this.settings.setValue(
      SettingScope.User,
      'security.auth.selectedType',
      method,
    );
  }

  private getAuthDetails(): AuthDetails {
    return {
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      customHeaders: this.customHeaders,
    };
  }

  async newSession(
    params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    return this.sessionManager.newSession(params, this.getAuthDetails());
  }

  async loadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    return this.sessionManager.loadSession(params, this.getAuthDetails());
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    await session.cancelPendingPrompt();
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    return session.prompt(params);
  }

  async setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    return session.setMode(params.modeId);
  }

  async unstable_setSessionModel(
    params: acp.SetSessionModelRequest,
  ): Promise<acp.SetSessionModelResponse> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new acp.RequestError(
        -32602,
        `Session not found: ${params.sessionId}`,
      );
    }
    return session.setModel(params.modelId);
  }

  async extMethod(
    method: string,
    _params: unknown,
  ): Promise<Record<string, unknown>> {
    if (method === 'auth/status') {
      const clientName = this.context.config.getClientName()?.toLowerCase();
      const isXcode =
        clientName?.includes('xcode') || !!process.env['XCODE_VERSION_ACTUAL'];
      if (!isXcode) {
        throw new acp.RequestError(-32601, `Method not found: ${method}`);
      }
      return this.handleAuthStatus();
    }
    throw new acp.RequestError(-32601, `Method not found: ${method}`);
  }

  private async handleAuthStatus(): Promise<{
    status: string;
    methodId: string | null;
  }> {
    const currentConfig = this.context.config.getContentGeneratorConfig();
    const authType =
      currentConfig?.authType ||
      this.settings.merged.security.auth.selectedType ||
      AuthType.USE_GEMINI;

    let isAuth = false;

    if (authType === AuthType.USE_GEMINI) {
      const apiKey =
        this.apiKey ||
        currentConfig?.apiKey ||
        process.env['GEMINI_API_KEY'] ||
        (await loadApiKey());
      isAuth = !!apiKey && apiKey.trim() !== '';
    } else if (authType === AuthType.LOGIN_WITH_GOOGLE) {
      isAuth = await this.checkOAuthValid();
    } else if (authType === AuthType.USE_VERTEX_AI) {
      const googleApiKey = process.env['GOOGLE_API_KEY'];
      const googleCloudProject =
        process.env['GOOGLE_CLOUD_PROJECT'] ||
        process.env['GOOGLE_CLOUD_PROJECT_ID'];
      const googleCloudLocation = process.env['GOOGLE_CLOUD_LOCATION'];
      isAuth = !!googleApiKey || !!(googleCloudProject && googleCloudLocation);
    } else if (authType === AuthType.GATEWAY) {
      const apiKey =
        this.apiKey || currentConfig?.apiKey || process.env['GEMINI_API_KEY'];
      isAuth = !!apiKey || !!this.baseUrl || !!currentConfig?.baseUrl;
    } else if (authType === AuthType.COMPUTE_ADC) {
      isAuth = await this.checkADCValid();
    }

    return {
      status: isAuth ? 'Authorized' : 'Unauthorized',
      methodId: isAuth ? authType : null,
    };
  }

  private async checkOAuthValid(): Promise<boolean> {
    let fileContent: string;
    try {
      const filePath = Storage.getOAuthCredsPath();
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') {
        return false;
      }
      return false;
    }

    let credentials: OAuthCredentialsPayload;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      credentials = JSON.parse(fileContent) as OAuthCredentialsPayload;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new acp.RequestError(
          -32603,
          `Internal error: Corrupted credentials store file: ${err.message}`,
        );
      }
      return false;
    }

    if (
      !credentials ||
      (!credentials.refresh_token && !credentials.access_token)
    ) {
      return false;
    }

    try {
      const client = new OAuth2Client({
        clientId: OAUTH_CLIENT_ID,
        clientSecret: OAUTH_CLIENT_SECRET,
      });

      client.setCredentials(credentials);

      const { token } = await client.getAccessToken();
      if (!token) {
        return false;
      }

      await client.getTokenInfo(token);
      return true;
    } catch {
      return false;
    }
  }

  private async checkADCValid(): Promise<boolean> {
    try {
      const envAdcPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
      if (envAdcPath) {
        try {
          const content = await fs.readFile(envAdcPath, 'utf-8');
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const parsed = JSON.parse(content) as Record<string, unknown>;
          if (
            parsed &&
            (parsed['type'] === 'service_account' ||
              parsed['type'] === 'authorized_user')
          ) {
            return true;
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new acp.RequestError(
              -32603,
              `Internal error: Corrupted ADC environment credentials file: ${e.message}`,
            );
          }
          return false;
        }
      }

      const computeClient = new Compute();
      const token = await Promise.race([
        computeClient.getAccessToken(),
        new Promise<null>((_, reject) =>
          setTimeout(
            () => reject(new Error('ADC metadata check timeout')),
            1000,
          ),
        ),
      ]);
      return !!token;
    } catch {
      return false;
    }
  }
}

interface OAuthCredentialsPayload {
  refresh_token?: string;
  access_token?: string;
  type?: string;
}
