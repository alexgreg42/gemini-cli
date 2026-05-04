/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
  type Mocked,
} from 'vitest';
import { GeminiAgent } from './acpRpcDispatcher.js';
import * as acp from '@agentclientprotocol/sdk';
import { promises as fs } from 'node:fs';
import {
  AuthType,
  type Config,
  type MessageBus,
  type Storage,
} from '@google/gemini-cli-core';
import type { LoadedSettings } from '../config/settings.js';
import { loadCliConfig, type CliArgs } from '../config/config.js';
import { loadSettings, SettingScope } from '../config/settings.js';

const { mockGetAccessToken, mockGetTokenInfo, mockLoadApiKey } = vi.hoisted(
  () => ({
    mockGetAccessToken: vi.fn(),
    mockGetTokenInfo: vi.fn(),
    mockLoadApiKey: vi.fn(),
  }),
);

vi.mock('../config/config.js', () => ({
  loadCliConfig: vi.fn(),
}));

vi.mock('../config/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/settings.js')>();
  return {
    ...actual,
    loadSettings: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    setCredentials = vi.fn();
    getAccessToken = mockGetAccessToken;
    getTokenInfo = mockGetTokenInfo;
  }
  return {
    OAuth2Client: MockOAuth2Client,
    Compute: MockOAuth2Client,
  };
});

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    loadApiKey: mockLoadApiKey,
    OAUTH_CLIENT_ID: 'test-client-id',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
  };
});

describe('GeminiAgent - RPC Dispatcher', () => {
  let mockConfig: Mocked<Config>;
  let mockSettings: Mocked<LoadedSettings>;
  let mockArgv: CliArgs;
  let mockConnection: Mocked<acp.AgentSideConnection>;
  let agent: GeminiAgent;

  beforeEach(() => {
    mockConfig = {
      refreshAuth: vi.fn(),
      initialize: vi.fn(),
      waitForMcpInit: vi.fn(),
      getFileSystemService: vi.fn(),
      setFileSystemService: vi.fn(),
      getContentGeneratorConfig: vi.fn(),
      getClientName: vi.fn().mockReturnValue('xcode'),
      getActiveModel: vi.fn().mockReturnValue('gemini-pro'),
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getGeminiClient: vi.fn().mockReturnValue({
        startChat: vi.fn().mockResolvedValue({}),
      }),
      getMessageBus: vi.fn().mockReturnValue({
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      }),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      isPlanEnabled: vi.fn().mockReturnValue(true),
      getGemini31LaunchedSync: vi.fn().mockReturnValue(false),
      getHasAccessToPreviewModel: vi.fn().mockReturnValue(false),
      getCheckpointingEnabled: vi.fn().mockReturnValue(false),
      getDisableAlwaysAllow: vi.fn().mockReturnValue(false),
      validatePathAccess: vi.fn().mockReturnValue(null),
      getWorkspaceContext: vi.fn().mockReturnValue({
        addReadOnlyPath: vi.fn(),
      }),
      getPolicyEngine: vi.fn().mockReturnValue({
        addRule: vi.fn(),
      }),
      messageBus: {
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      } as unknown as MessageBus,
      storage: {
        getWorkspaceAutoSavedPolicyPath: vi.fn(),
        getAutoSavedPolicyPath: vi.fn(),
      } as unknown as Storage,

      get config() {
        return this;
      },
    } as unknown as Mocked<Config>;
    mockSettings = {
      merged: {
        security: { auth: { selectedType: 'login_with_google' } },
        mcpServers: {},
      },
      setValue: vi.fn(),
    } as unknown as Mocked<LoadedSettings>;
    mockArgv = {} as unknown as CliArgs;
    mockConnection = {
      sessionUpdate: vi.fn(),
      requestPermission: vi.fn(),
    } as unknown as Mocked<acp.AgentSideConnection>;

    (loadCliConfig as unknown as Mock).mockResolvedValue(mockConfig);
    (loadSettings as unknown as Mock).mockImplementation(() => ({
      merged: {
        security: {
          auth: { selectedType: AuthType.LOGIN_WITH_GOOGLE },
          enablePermanentToolApproval: true,
        },
        mcpServers: {},
      },
      setValue: vi.fn(),
    }));

    agent = new GeminiAgent(mockConfig, mockSettings, mockArgv, mockConnection);
  });

  it('should initialize correctly', async () => {
    const response = await agent.initialize({
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      protocolVersion: 1,
    });

    expect(response.protocolVersion).toBe(acp.PROTOCOL_VERSION);
    expect(response.authMethods).toHaveLength(4);
    const gatewayAuth = response.authMethods?.find(
      (m) => m.id === AuthType.GATEWAY,
    );
    expect(gatewayAuth?._meta).toEqual({
      gateway: {
        protocol: 'google',
        restartRequired: 'false',
      },
    });
    const geminiAuth = response.authMethods?.find(
      (m) => m.id === AuthType.USE_GEMINI,
    );
    expect(geminiAuth?._meta).toEqual({
      'api-key': {
        provider: 'google',
      },
    });
    expect(response.agentCapabilities?.loadSession).toBe(true);
  });

  it('should authenticate correctly', async () => {
    await agent.authenticate({
      methodId: AuthType.LOGIN_WITH_GOOGLE,
    });

    expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
      AuthType.LOGIN_WITH_GOOGLE,
      undefined,
      undefined,
      undefined,
    );
    expect(mockSettings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'security.auth.selectedType',
      AuthType.LOGIN_WITH_GOOGLE,
    );
  });

  it('should authenticate correctly with api-key in _meta', async () => {
    await agent.authenticate({
      methodId: AuthType.USE_GEMINI,
      _meta: {
        'api-key': 'test-api-key',
      },
    } as unknown as acp.AuthenticateRequest);

    expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
      AuthType.USE_GEMINI,
      'test-api-key',
      undefined,
      undefined,
    );
    expect(mockSettings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'security.auth.selectedType',
      AuthType.USE_GEMINI,
    );
  });

  it('should authenticate correctly with gateway method', async () => {
    await agent.authenticate({
      methodId: AuthType.GATEWAY,
      _meta: {
        gateway: {
          baseUrl: 'https://example.com',
          headers: { Authorization: 'Bearer token' },
        },
      },
    } as unknown as acp.AuthenticateRequest);

    expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
      AuthType.GATEWAY,
      undefined,
      'https://example.com',
      { Authorization: 'Bearer token' },
    );
    expect(mockSettings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'security.auth.selectedType',
      AuthType.GATEWAY,
    );
  });

  it('should throw acp.RequestError when gateway payload is malformed', async () => {
    await expect(
      agent.authenticate({
        methodId: AuthType.GATEWAY,
        _meta: {
          gateway: {
            baseUrl: 123,
            headers: { Authorization: 'Bearer token' },
          },
        },
      } as unknown as acp.AuthenticateRequest),
    ).rejects.toThrow(/Malformed gateway payload/);
  });

  it('should cancel a session', async () => {
    const mockSession = {
      cancelPendingPrompt: vi.fn(),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    await agent.cancel({ sessionId: 'test-session-id' });

    expect(mockSession.cancelPendingPrompt).toHaveBeenCalled();
  });

  it('should throw error when cancelling non-existent session', async () => {
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
    };

    await expect(agent.cancel({ sessionId: 'unknown' })).rejects.toThrow(
      'Session not found',
    );
  });

  it('should delegate prompt to session', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const result = await agent.prompt({
      sessionId: 'test-session-id',
      prompt: [],
    });

    expect(mockSession.prompt).toHaveBeenCalled();
    expect(result).toMatchObject({ stopReason: 'end_turn' });
  });

  it('should delegate setMode to session', async () => {
    const mockSession = {
      setMode: vi.fn().mockReturnValue({}),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const result = await agent.setSessionMode({
      sessionId: 'test-session-id',
      modeId: 'plan',
    });

    expect(mockSession.setMode).toHaveBeenCalledWith('plan');
    expect(result).toEqual({});
  });

  it('should throw error when setting mode on non-existent session', async () => {
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
    };

    await expect(
      agent.setSessionMode({
        sessionId: 'unknown',
        modeId: 'plan',
      }),
    ).rejects.toThrow('Session not found: unknown');
  });

  it('should delegate setModel to session (unstable)', async () => {
    const mockSession = {
      setModel: vi.fn().mockReturnValue({}),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const result = await agent.unstable_setSessionModel({
      sessionId: 'test-session-id',
      modelId: 'gemini-2.0-pro-exp',
    });

    expect(mockSession.setModel).toHaveBeenCalledWith('gemini-2.0-pro-exp');
    expect(result).toEqual({});
  });

  it('should throw error when setting model on non-existent session (unstable)', async () => {
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
    };

    await expect(
      agent.unstable_setSessionModel({
        sessionId: 'unknown',
        modelId: 'gemini-2.0-pro-exp',
      }),
    ).rejects.toThrow('Session not found: unknown');
  });

  describe('extMethod - auth/status', () => {
    beforeEach(() => {
      vi.stubEnv('GEMINI_API_KEY', '');
      vi.stubEnv('GOOGLE_API_KEY', '');
      vi.stubEnv('GOOGLE_CLOUD_PROJECT', '');
      vi.stubEnv('GOOGLE_CLOUD_LOCATION', '');
      vi.stubEnv('XCODE_VERSION_ACTUAL', '1500'); // Default to Xcode for auth/status tests
      mockConfig.getClientName.mockReturnValue('xcode');
      mockLoadApiKey.mockReset();
      mockGetAccessToken.mockReset();
      mockGetTokenInfo.mockReset();
      vi.mocked(fs.readFile).mockReset();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it('should throw RequestError for unknown custom method', async () => {
      await expect(agent.extMethod('unknown/method', {})).rejects.toThrow(
        'Method not found: unknown/method',
      );
    });

    it('should throw RequestError when called from a non-Xcode client', async () => {
      vi.stubEnv('XCODE_VERSION_ACTUAL', '');
      mockConfig.getClientName.mockReturnValue('vscode');

      await expect(agent.extMethod('auth/status', {})).rejects.toThrow(
        'Method not found: auth/status',
      );
    });

    it('should return Unauthorized when gemini-api-key is missing or empty', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.USE_GEMINI,
        apiKey: '',
      });
      mockLoadApiKey.mockResolvedValue(null);

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Unauthorized',
        methodId: null,
      });
    });

    it('should return Authorized when API key is present in process.env', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.USE_GEMINI,
      });
      vi.stubEnv('GEMINI_API_KEY', 'env-api-key');

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Authorized',
        methodId: AuthType.USE_GEMINI,
      });
    });

    it('should return Authorized when API key is loaded from keychain cache', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.USE_GEMINI,
      });
      mockLoadApiKey.mockResolvedValue('keychain-api-key');

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Authorized',
        methodId: AuthType.USE_GEMINI,
      });
    });

    it('should return Authorized for valid oauth-personal token info', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ refresh_token: 'valid-token' }),
      );
      mockGetAccessToken.mockResolvedValue({ token: 'access-token' });
      mockGetTokenInfo.mockResolvedValue({ scopes: [] });

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Authorized',
        methodId: AuthType.LOGIN_WITH_GOOGLE,
      });
    });

    it('should return Unauthorized for expired/invalid oauth-personal refresh', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ refresh_token: 'invalid-token' }),
      );
      mockGetAccessToken.mockRejectedValue(new Error('invalid grant'));

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Unauthorized',
        methodId: null,
      });
    });

    it('should return Authorized for Vertex AI when env variables are configured', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.USE_VERTEX_AI,
      });
      vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'my-project');
      vi.stubEnv('GOOGLE_CLOUD_LOCATION', 'us-central1');

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Authorized',
        methodId: AuthType.USE_VERTEX_AI,
      });
    });

    it('should throw RequestError when credentials store file contains malformed JSON', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      vi.mocked(fs.readFile).mockResolvedValue('{ malformed: json ');

      await expect(agent.extMethod('auth/status', {})).rejects.toThrow(
        /Corrupted credentials store file/,
      );
    });

    it('should return Authorized for COMPUTE_ADC when process.env.GOOGLE_APPLICATION_CREDENTIALS is valid', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.COMPUTE_ADC,
      });
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/path/to/adc.json');
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ type: 'service_account' }),
      );

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Authorized',
        methodId: AuthType.COMPUTE_ADC,
      });
    });

    it('should return Authorized for COMPUTE_ADC when GCE metadata server responds successfully', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.COMPUTE_ADC,
      });
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '');
      mockGetAccessToken.mockResolvedValue({ token: 'compute-access-token' });

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Authorized',
        methodId: AuthType.COMPUTE_ADC,
      });
    });

    it('should return Unauthorized for COMPUTE_ADC when environment is unconfigured or check fails', async () => {
      mockConfig.getContentGeneratorConfig.mockReturnValue({
        authType: AuthType.COMPUTE_ADC,
      });
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '');
      mockGetAccessToken.mockRejectedValue(new Error('Not GCE env'));

      const result = await agent.extMethod('auth/status', {});

      expect(result).toEqual({
        status: 'Unauthorized',
        methodId: null,
      });
    });
  });
});
