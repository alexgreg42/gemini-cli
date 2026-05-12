/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  MessageSquare,
  Settings,
  Code,
  Terminal,
  FileText,
  Cpu,
  Search,
  MoreVertical,
  Paperclip,
  Sparkles,
  GitBranch,
  GitCommit,
  RefreshCw,
  X,
  ChevronRight,
  Star,
  Lock,
  Globe,
  Upload,
  CheckCircle,
  AlertCircle,
  Plus,
  ChevronDown,
  Zap,
  Eye,
  Layers,
  Trash2,
  Key,
  LogIn,
  LogOut,
  UserCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import {
  sendMessageToGemini,
  AVAILABLE_MODELS,
  type Message,
  type AttachedFile,
} from './services/gemini';
import {
  fetchGitHubRepos,
  commitFileToGitHub,
  getFileSha,
  type GitHubRepo,
  LANG_COLORS,
} from './services/github';
import { loadSettings, saveSettings } from './services/settings';
import {
  loadAuthState,
  saveAuthState,
  startGoogleOAuth,
  checkOAuthStatus,
  logoutGoogle,
  isElectron,
  type AuthState,
} from './services/auth';

// ─── Chat History ────────────────────────────────────────────────────────────

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

const HISTORY_KEY = 'gemini_chat_history';

const loadHistory = (): ChatSession[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ChatSession[]) : [];
  } catch {
    return [];
  }
};

const persistSession = (session: ChatSession) => {
  const history = loadHistory().filter((s) => s.id !== session.id);
  history.unshift(session);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
};

const removeSession = (id: string) => {
  const history = loadHistory().filter((s) => s.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
};

const newSession = (): ChatSession => ({
  id: crypto.randomUUID(),
  title: 'Nouveau chat',
  messages: [
    {
      role: 'model',
      content:
        'Bonjour ! Je suis Gemini. Comment puis-je vous aider avec votre projet ?',
      timestamp: Date.now(),
    },
  ],
  updatedAt: Date.now(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

type RightTab = 'github' | 'files' | 'cli';
type CommitStatus = 'idle' | 'loading' | 'success' | 'error';

// ─── Tier badge ──────────────────────────────────────────────────────────────

const TierIcon = ({ tier }: { tier: string }) => {
  if (tier === 'free') return <Zap size={11} color="#10b981" />;
  if (tier === 'preview') return <Eye size={11} color="#8b5cf6" />;
  return <Layers size={11} color="#f59e0b" />;
};

const TierLabel: Record<string, string> = {
  free: 'Gratuit',
  preview: 'Preview',
  limited: 'Limité',
};

// ─── App ─────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  // Settings
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(loadSettings);

  // Auth
  const [authState, setAuthState] = useState<AuthState>(loadAuthState);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthMessage, setOauthMessage] = useState('');

  // CLI background process
  const [cliRunning, setCliRunning] = useState(false);
  const [cliLog, setCliLog] = useState<string[]>([]);
  const [cliInput, setCliInput] = useState('');

  // Session / history
  const [session, setSession] = useState<ChatSession>(newSession);
  const [history, setHistory] = useState<ChatSession[]>(loadHistory);

  // Chat
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Model selector
  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);

  // File upload
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GitHub
  const [githubToken, setGithubToken] = useState(
    () => settings.githubToken || localStorage.getItem('github_token') || '',
  );
  const [tokenInput, setTokenInput] = useState('');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoSearch, setRepoSearch] = useState('');

  // Commit
  const [showCommit, setShowCommit] = useState(false);
  const [commitPath, setCommitPath] = useState('');
  const [commitContent, setCommitContent] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [commitStatus, setCommitStatus] = useState<CommitStatus>('idle');
  const [commitError, setCommitError] = useState('');

  // Right panel
  const [rightTab, setRightTab] = useState<RightTab>('github');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    Prism.highlightAll();
  }, [session.messages]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-check OAuth on startup (picks up existing ~/.gemini/oauth_creds.json)
  useEffect(() => {
    checkOAuthStatus().then((state) => {
      if (state.isAuthenticated) setAuthState(state);
    });
  }, []);  

  useEffect(() => {
    if (githubToken && repos.length === 0) loadRepos(githubToken);
  }, [githubToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GitHub ─────────────────────────────────────────────────────────────────

  const loadRepos = useCallback(async (token: string) => {
    setReposLoading(true);
    setReposError('');
    try {
      const data = await fetchGitHubRepos(token);
      setRepos(data);
      localStorage.setItem('github_token', token);
    } catch (err: unknown) {
      setReposError(
        err instanceof Error ? err.message : 'Erreur de connexion GitHub',
      );
    } finally {
      setReposLoading(false);
    }
  }, []);

  const handleConnectGitHub = () => {
    const t = tokenInput.trim();
    if (!t) return;
    setGithubToken(t);
    loadRepos(t);
    setTokenInput('');
  };

  // ── Google OAuth ───────────────────────────────────────────────────────────

  const handleGoogleLogin = async () => {
    setOauthLoading(true);
    setOauthMessage('');
    const result = await startGoogleOAuth();
    if (result.ok) {
      const newState: AuthState = {
        mode: 'google_oauth',
        isAuthenticated: true,
      };
      saveAuthState(newState);
      setAuthState(newState);
      setOauthMessage('Connecté avec Google !');
    } else {
      setOauthMessage(result.message ?? 'Erreur de connexion.');
    }
    setOauthLoading(false);
  };

  const handleCheckOAuth = async () => {
    setOauthLoading(true);
    const newState = await checkOAuthStatus();
    setAuthState(newState);
    if (newState.isAuthenticated) {
      setOauthMessage(`Connecté : ${newState.email ?? 'compte Google'}`);
    } else {
      setOauthMessage('Aucune session Google trouvée. Connectez-vous.');
    }
    setOauthLoading(false);
  };

  const handleGoogleLogout = async () => {
    await logoutGoogle();
    setAuthState({ mode: 'api_key', isAuthenticated: false });
    setOauthMessage('Déconnecté.');
  };

  // ── CLI process ────────────────────────────────────────────────────────────

  const handleCliStart = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.cliStart();
    if (result.ok) {
      setCliRunning(true);
      setCliLog((l) => [...l, '▶ CLI démarré']);
      window.electronAPI.onCliOutput((data) => {
        setCliLog((l) => [...l.slice(-200), data.text.trimEnd()]);
        if (data.type === 'exit') setCliRunning(false);
      });
    } else {
      setCliLog((l) => [...l, `✗ ${result.error ?? 'Erreur démarrage CLI'}`]);
    }
  };

  const handleCliStop = async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.cliStop();
    setCliRunning(false);
    setCliLog((l) => [...l, '■ CLI arrêté']);
  };

  const handleCliSend = async () => {
    if (!window.electronAPI || !cliInput.trim()) return;
    await window.electronAPI.cliSend({ text: cliInput });
    setCliLog((l) => [...l, `> ${cliInput}`]);
    setCliInput('');
  };

  const handleDisconnectGitHub = () => {
    setGithubToken('');
    setRepos([]);
    setSelectedRepo(null);
    localStorage.removeItem('github_token');
  };

  // ── File upload ────────────────────────────────────────────────────────────

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const newFiles: AttachedFile[] = await Promise.all(
      files.map(
        (file) =>
          new Promise<AttachedFile>((resolve) => {
            const reader = new FileReader();
            const isImage = file.type.startsWith('image/');
            if (isImage) {
              reader.readAsDataURL(file);
              reader.onload = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve({
                  name: file.name,
                  mimeType: file.type,
                  content: base64,
                  isImage: true,
                  size: file.size,
                });
              };
            } else {
              reader.readAsText(file);
              reader.onload = () => {
                resolve({
                  name: file.name,
                  mimeType: file.type || 'text/plain',
                  content: reader.result as string,
                  isImage: false,
                  size: file.size,
                });
              };
            }
          }),
      ),
    );

    setAttachedFiles((prev) => [...prev, ...newFiles]);
    e.target.value = '';
    setRightTab('files');
  };

  // ── Chat ───────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    const updatedMessages = [...session.messages, userMsg];
    const currentInput = input;
    const currentFiles = [...attachedFiles];

    setSession((s) => ({ ...s, messages: updatedMessages }));
    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      const response = await sendMessageToGemini(
        currentInput,
        session.messages,
        currentFiles,
        settings.selectedModel,
      );
      const modelMsg: Message = {
        role: 'model',
        content: response,
        timestamp: Date.now(),
      };
      const finalMessages = [...updatedMessages, modelMsg];

      const title =
        session.messages.length <= 1
          ? currentInput.slice(0, 40) + (currentInput.length > 40 ? '…' : '')
          : session.title;

      const updatedSession: ChatSession = {
        ...session,
        title,
        messages: finalMessages,
        updatedAt: Date.now(),
      };
      setSession(updatedSession);
      persistSession(updatedSession);
      setHistory(loadHistory());
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Erreur inconnue';
      const errMsg: Message = {
        role: 'model',
        content: `❌ ${msg}`,
        timestamp: Date.now(),
      };
      setSession((s) => ({
        ...s,
        messages: [...updatedMessages, errMsg],
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startNewChat = () => {
    const s = newSession();
    setSession(s);
    setInput('');
    setAttachedFiles([]);
  };

  const loadChatSession = (s: ChatSession) => {
    setSession(s);
    setInput('');
    setAttachedFiles([]);
  };

  const deleteChatSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeSession(id);
    setHistory(loadHistory());
    if (session.id === id) startNewChat();
  };

  // ── Commit ─────────────────────────────────────────────────────────────────

  const handleCommit = async () => {
    if (
      !githubToken ||
      !selectedRepo ||
      !commitPath ||
      !commitContent ||
      !commitMessage
    )
      return;
    setCommitStatus('loading');
    setCommitError('');
    try {
      const sha = await getFileSha(
        githubToken,
        selectedRepo.full_name,
        commitPath,
      );
      await commitFileToGitHub(
        githubToken,
        selectedRepo.full_name,
        commitPath,
        commitContent,
        commitMessage,
        sha,
      );
      setCommitStatus('success');
      setTimeout(() => {
        setShowCommit(false);
        setCommitStatus('idle');
        setCommitPath('');
        setCommitContent('');
        setCommitMessage('');
      }, 2000);
    } catch (err: unknown) {
      setCommitStatus('error');
      setCommitError(err instanceof Error ? err.message : 'Erreur commit');
    }
  };

  const useLastResponse = () => {
    const last = [...session.messages]
      .reverse()
      .find((m) => m.role === 'model');
    if (last) setCommitContent(last.content);
  };

  // ── Settings ───────────────────────────────────────────────────────────────

  const openSettings = () => {
    setSettingsDraft(loadSettings());
    setShowSettings(true);
  };

  const saveAndCloseSettings = () => {
    const saved = saveSettings(settingsDraft);
    setSettings(saved);
    if (saved.githubToken && saved.githubToken !== githubToken) {
      setGithubToken(saved.githubToken);
      setRepos([]);
      loadRepos(saved.githubToken);
    }
    setShowSettings(false);
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const filteredRepos = repos.filter(
    (r) =>
      repoSearch === '' ||
      r.name.toLowerCase().includes(repoSearch.toLowerCase()),
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const activeModel =
    AVAILABLE_MODELS.find((m) => m.id === settings.selectedModel) ??
    AVAILABLE_MODELS[0];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      {/* ── Left Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <Sparkles size={22} />
            <span>Gemini Studio</span>
          </div>
          <button
            className="new-chat-btn"
            onClick={startNewChat}
            title="Nouveau chat"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="sidebar-content">
          <div className="nav-item active" onClick={startNewChat}>
            <MessageSquare size={18} />
            <span>Nouveau Chat</span>
          </div>
          <div className="nav-item">
            <Code size={18} />
            <span>Index Projet</span>
          </div>
          <div className="nav-item">
            <Terminal size={18} />
            <span>CLI Commands</span>
          </div>
          <div className="nav-item">
            <FileText size={18} />
            <span>Fichiers Contexte</span>
          </div>

          {history.length > 0 && (
            <>
              <div className="section-label">Historique</div>
              {history.map((s) => (
                <div
                  key={s.id}
                  className={`nav-item history-item${session.id === s.id ? ' active' : ''}`}
                  onClick={() => loadChatSession(s)}
                >
                  <MessageSquare size={14} />
                  <span className="history-title">{s.title}</span>
                  <button
                    className="history-delete"
                    onClick={(e) => deleteChatSession(s.id, e)}
                    title="Supprimer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="nav-item" onClick={openSettings}>
            <Settings size={18} />
            <span>Paramètres</span>
          </div>
        </div>
      </aside>

      {/* ── Main Chat ── */}
      <main className="main-content">
        {/* Header */}
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Cpu size={20} color="var(--accent-blue)" />
            {/* Model selector */}
            <div className="model-selector" ref={modelRef}>
              <button
                className="model-trigger"
                onClick={() => setModelOpen((o) => !o)}
              >
                <TierIcon tier={activeModel.tier} />
                <span>{activeModel.name}</span>
                <ChevronDown size={14} className={modelOpen ? 'rotated' : ''} />
              </button>
              <AnimatePresence>
                {modelOpen && (
                  <motion.div
                    className="model-dropdown"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                  >
                    {AVAILABLE_MODELS.map((m) => (
                      <button
                        key={m.id}
                        className={`model-option${m.id === settings.selectedModel ? ' selected' : ''}`}
                        onClick={() => {
                          const saved = saveSettings({ selectedModel: m.id });
                          setSettings(saved);
                          setModelOpen(false);
                        }}
                      >
                        <div className="model-option-left">
                          <TierIcon tier={m.tier} />
                          <div>
                            <div className="model-option-name">{m.name}</div>
                            <div className="model-option-desc">
                              {m.description}
                            </div>
                          </div>
                        </div>
                        <span className={`tier-badge tier-${m.tier}`}>
                          {TierLabel[m.tier]}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="status-dot" />
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button className="action-btn" title="Rechercher">
              <Search size={20} />
            </button>
            <button
              className="action-btn"
              onClick={openSettings}
              title="Paramètres"
            >
              <Settings size={20} />
            </button>
            <button className="action-btn">
              <MoreVertical size={20} />
            </button>
          </div>
        </header>

        {/* Auth banner — shown when no Google auth and no API key */}
        {!authState.isAuthenticated && !settings.geminiApiKey && (
          <div
            style={{
              margin: '16px 24px 0',
              padding: '16px 20px',
              background: 'rgba(99,102,241,0.12)',
              border: '1px solid rgba(99,102,241,0.35)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <LogIn size={22} color="#818cf8" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div
                style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '14px' }}
              >
                Connexion Google requise
              </div>
              <div
                style={{ color: '#94a3b8', fontSize: '12px', marginTop: '2px' }}
              >
                Connecte ton compte Google pour utiliser Gemini gratuitement
                (sans clé API)
              </div>
            </div>
            <button
              onClick={() => {
                setShowSettings(true);
              }}
              style={{
                padding: '8px 16px',
                background: '#6366f1',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Se connecter
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="chat-window">
          <AnimatePresence initial={false}>
            {session.messages.map((msg, i) => (
              <motion.div
                key={msg.timestamp + i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`message ${msg.role}`}
              >
                <div className="avatar">
                  {msg.role === 'user' ? (
                    <span>U</span>
                  ) : (
                    <Sparkles size={18} color="white" />
                  )}
                </div>
                <div className="message-content">
                  {msg.content.split('```').map((part, index) => {
                    if (index % 2 === 1) {
                      const lines = part.split('\n');
                      const lang = lines[0].trim() || 'javascript';
                      const code = lines.slice(1).join('\n');
                      return (
                        <pre key={index} className={`language-${lang}`}>
                          <code className={`language-${lang}`}>{code}</code>
                        </pre>
                      );
                    }
                    return (
                      <div key={index} style={{ whiteSpace: 'pre-wrap' }}>
                        {part}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <div className="message model">
              <div className="avatar">
                <Sparkles size={18} color="white" />
              </div>
              <div
                className="message-content"
                style={{ display: 'flex', gap: '4px', padding: '12px 20px' }}
              >
                <span className="dot animate-bounce">.</span>
                <span
                  className="dot animate-bounce"
                  style={{ animationDelay: '0.2s' }}
                >
                  .
                </span>
                <span
                  className="dot animate-bounce"
                  style={{ animationDelay: '0.4s' }}
                >
                  .
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div className="attached-chips">
            {attachedFiles.map((f, i) => (
              <div key={i} className="file-chip">
                <FileText size={13} />
                <span>{f.name}</span>
                <span className="chip-size">{formatSize(f.size)}</span>
                <button
                  className="chip-remove"
                  onClick={() =>
                    setAttachedFiles((p) => p.filter((_, j) => j !== i))
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="input-area">
          <div className="input-container">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileAttach}
              style={{ display: 'none' }}
              multiple
              accept="*/*"
            />
            <button
              className="action-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Joindre un fichier"
            >
              <Paperclip size={20} />
            </button>
            <textarea
              ref={textareaRef}
              placeholder="Message Gemini… (Shift+Entrée pour nouvelle ligne)"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = `${t.scrollHeight}px`;
              }}
            />
            <button
              className={`action-btn send-btn${!input.trim() ? ' opacity-50' : ''}`}
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
            >
              <Send size={18} />
            </button>
          </div>
          <div className="disclaimer">
            Gemini peut fournir des informations incorrectes. Vérifiez les faits
            importants.
          </div>
        </div>
      </main>

      {/* ── Right Panel ── */}
      <aside className="right-panel">
        <div className="right-tabs">
          <button
            className={`right-tab${rightTab === 'github' ? ' active' : ''}`}
            onClick={() => setRightTab('github')}
          >
            <GitBranch size={15} />
            <span>GitHub</span>
            {repos.length > 0 && <span className="badge">{repos.length}</span>}
          </button>
          <button
            className={`right-tab${rightTab === 'files' ? ' active' : ''}`}
            onClick={() => setRightTab('files')}
          >
            <Upload size={15} />
            <span>Fichiers</span>
            {attachedFiles.length > 0 && (
              <span className="badge">{attachedFiles.length}</span>
            )}
          </button>
          {isElectron() && (
            <button
              className={`right-tab${rightTab === 'cli' ? ' active' : ''}`}
              onClick={() => setRightTab('cli')}
            >
              <Terminal size={15} />
              <span>CLI</span>
              {cliRunning && (
                <span className="badge" style={{ background: '#10b981' }}>
                  ON
                </span>
              )}
            </button>
          )}
        </div>

        {/* GitHub Tab */}
        {rightTab === 'github' && (
          <div className="panel-body">
            {!githubToken ? (
              <div className="token-form">
                <p className="panel-hint">
                  Connectez GitHub avec un{' '}
                  <strong>Personal Access Token</strong> (scope&nbsp;:{' '}
                  <code>repo</code>).
                </p>
                <input
                  type="password"
                  className="panel-input"
                  placeholder="ghp_xxxxxxxxxxxx"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnectGitHub()}
                />
                <button
                  className="panel-btn primary"
                  onClick={handleConnectGitHub}
                >
                  <GitBranch size={14} /> Connecter
                </button>
                <p
                  className="panel-hint"
                  style={{ fontSize: '0.72rem', marginTop: 4 }}
                >
                  Ou configurez le token dans les{' '}
                  <span
                    style={{ color: 'var(--accent-blue)', cursor: 'pointer' }}
                    onClick={openSettings}
                  >
                    Paramètres ⚙
                  </span>
                </p>
              </div>
            ) : (
              <>
                <div className="panel-toolbar">
                  <input
                    className="panel-input small"
                    placeholder="Rechercher un repo…"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                  />
                  <button
                    className="icon-btn"
                    onClick={() => loadRepos(githubToken)}
                    title="Actualiser"
                    disabled={reposLoading}
                  >
                    <RefreshCw
                      size={14}
                      className={reposLoading ? 'spin' : ''}
                    />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={handleDisconnectGitHub}
                    title="Déconnecter"
                  >
                    <X size={14} />
                  </button>
                </div>

                {reposError && (
                  <div className="panel-error">
                    <AlertCircle size={13} /> {reposError}
                  </div>
                )}

                {reposLoading ? (
                  <div className="panel-loading">
                    <RefreshCw size={18} className="spin" />
                    <span>Chargement…</span>
                  </div>
                ) : (
                  <div className="repo-list">
                    {filteredRepos.map((repo) => (
                      <div
                        key={repo.id}
                        className={`repo-item${selectedRepo?.id === repo.id ? ' selected' : ''}`}
                        onClick={() =>
                          setSelectedRepo(
                            selectedRepo?.id === repo.id ? null : repo,
                          )
                        }
                      >
                        <div className="repo-header">
                          <div className="repo-name">
                            {repo.private ? (
                              <Lock size={11} />
                            ) : (
                              <Globe size={11} />
                            )}
                            <span>{repo.name}</span>
                          </div>
                          <div className="repo-stars">
                            <Star size={10} />
                            <span>{repo.stargazers_count}</span>
                          </div>
                        </div>
                        {repo.description && (
                          <div className="repo-desc">{repo.description}</div>
                        )}
                        <div className="repo-footer">
                          {repo.language && (
                            <span className="repo-lang">
                              <span
                                className="lang-dot"
                                style={{
                                  background:
                                    LANG_COLORS[repo.language] ?? '#8b949e',
                                }}
                              />
                              {repo.language}
                            </span>
                          )}
                          <ChevronRight size={11} className="repo-arrow" />
                        </div>
                      </div>
                    ))}
                    {filteredRepos.length === 0 && (
                      <div className="panel-empty">Aucun dépôt trouvé</div>
                    )}
                  </div>
                )}

                {/* Commit section */}
                {selectedRepo && (
                  <div className="commit-section">
                    <div className="commit-repo-label">
                      <GitCommit size={13} />
                      <span>{selectedRepo.name}</span>
                    </div>
                    {!showCommit ? (
                      <button
                        className="panel-btn primary"
                        onClick={() => setShowCommit(true)}
                      >
                        <GitCommit size={13} /> Commit &amp; Push
                      </button>
                    ) : (
                      <div className="commit-form">
                        <input
                          className="panel-input small"
                          placeholder="Chemin (ex: src/index.ts)"
                          value={commitPath}
                          onChange={(e) => setCommitPath(e.target.value)}
                        />
                        <div className="commit-content-row">
                          <textarea
                            className="panel-textarea"
                            placeholder="Contenu du fichier…"
                            value={commitContent}
                            onChange={(e) => setCommitContent(e.target.value)}
                            rows={6}
                          />
                          <button
                            className="use-response-btn"
                            onClick={useLastResponse}
                            title="Injecter la dernière réponse Gemini"
                          >
                            <Sparkles size={11} />
                          </button>
                        </div>
                        <input
                          className="panel-input small"
                          placeholder="Message de commit"
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                        />
                        <div className="commit-actions">
                          <button
                            className="panel-btn secondary"
                            onClick={() => {
                              setShowCommit(false);
                              setCommitStatus('idle');
                            }}
                          >
                            Annuler
                          </button>
                          <button
                            className="panel-btn primary"
                            onClick={handleCommit}
                            disabled={
                              commitStatus === 'loading' ||
                              !commitPath ||
                              !commitContent ||
                              !commitMessage
                            }
                          >
                            {commitStatus === 'loading' ? (
                              <RefreshCw size={12} className="spin" />
                            ) : commitStatus === 'success' ? (
                              <CheckCircle size={12} />
                            ) : (
                              <GitCommit size={12} />
                            )}
                            {commitStatus === 'success'
                              ? 'Envoyé !'
                              : 'Envoyer'}
                          </button>
                        </div>
                        {commitStatus === 'error' && (
                          <div className="panel-error">
                            <AlertCircle size={12} /> {commitError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Files Tab */}
        {rightTab === 'files' && (
          <div className="panel-body">
            <button
              className="panel-btn primary"
              style={{ marginBottom: '12px' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={14} /> Joindre des fichiers
            </button>
            {attachedFiles.length === 0 ? (
              <div className="panel-empty">
                Aucun fichier joint.
                <br />
                Ils seront envoyés avec votre prochain message.
              </div>
            ) : (
              <div className="file-list">
                {attachedFiles.map((f, i) => (
                  <div key={i} className="file-list-item">
                    <div className="file-list-info">
                      {f.isImage ? (
                        <img
                          src={`data:${f.mimeType};base64,${f.content}`}
                          alt={f.name}
                          className="file-thumb"
                        />
                      ) : (
                        <div className="file-icon">
                          <FileText size={18} />
                        </div>
                      )}
                      <div className="file-meta">
                        <span className="file-name">{f.name}</span>
                        <span className="file-size">{formatSize(f.size)}</span>
                      </div>
                    </div>
                    <button
                      className="icon-btn danger"
                      onClick={() =>
                        setAttachedFiles((p) => p.filter((_, j) => j !== i))
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CLI Tab */}
        {rightTab === 'cli' && isElectron() && (
          <div className="panel-body" style={{ gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {!cliRunning ? (
                <button className="panel-btn primary" onClick={handleCliStart}>
                  <Zap size={13} /> Démarrer CLI
                </button>
              ) : (
                <button className="panel-btn secondary" onClick={handleCliStop}>
                  <X size={13} /> Arrêter CLI
                </button>
              )}
            </div>
            <div className="cli-log">
              {cliLog.length === 0 ? (
                <span className="cli-placeholder">
                  Le CLI Gemini s&apos;exécute ici en arrière-plan.
                </span>
              ) : (
                cliLog.map((line, i) => (
                  <div key={i} className="cli-line">
                    {line}
                  </div>
                ))
              )}
            </div>
            {cliRunning && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="panel-input small"
                  style={{ flex: 1 }}
                  placeholder="Envoyer une commande au CLI..."
                  value={cliInput}
                  onChange={(e) => setCliInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCliSend()}
                />
                <button className="icon-btn" onClick={handleCliSend}>
                  <Send size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── Settings Modal ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) =>
              e.target === e.currentTarget && setShowSettings(false)
            }
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Settings size={18} color="var(--accent-blue)" />
                  <span className="modal-title">Paramètres</span>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setShowSettings(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="modal-body">
                {/* Google OAuth */}
                <div className="setting-group">
                  <label className="setting-label">
                    <UserCheck size={14} /> Connexion Google (tokens gratuits
                    illimités)
                  </label>
                  <div className="auth-card">
                    {authState.isAuthenticated &&
                    authState.mode === 'google_oauth' ? (
                      <div className="auth-connected">
                        <div className="auth-status-row">
                          <CheckCircle size={16} color="#10b981" />
                          <span style={{ color: '#10b981', fontWeight: 600 }}>
                            Connecté avec Google
                          </span>
                        </div>
                        <p className="setting-hint" style={{ margin: '6px 0' }}>
                          Vous utilisez les tokens gratuits illimités via Google
                          Code Assist.
                        </p>
                        <button
                          className="panel-btn secondary"
                          style={{
                            width: 'auto',
                            padding: '6px 14px',
                            marginTop: 4,
                          }}
                          onClick={handleGoogleLogout}
                        >
                          <LogOut size={13} /> Déconnecter
                        </button>
                      </div>
                    ) : (
                      <div className="auth-disconnected">
                        <p className="setting-hint">
                          Connectez-vous avec votre compte Google pour utiliser
                          Gemini gratuitement avec des tokens illimités — comme
                          le CLI natif avec <code>gemini auth login</code>.
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            marginTop: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          <button
                            className="panel-btn primary"
                            style={{ width: 'auto', padding: '7px 16px' }}
                            onClick={handleGoogleLogin}
                            disabled={oauthLoading}
                          >
                            {oauthLoading ? (
                              <RefreshCw size={13} className="spin" />
                            ) : (
                              <LogIn size={13} />
                            )}
                            Se connecter avec Google
                          </button>
                          <button
                            className="panel-btn secondary"
                            style={{ width: 'auto', padding: '7px 14px' }}
                            onClick={handleCheckOAuth}
                            disabled={oauthLoading}
                          >
                            <UserCheck size={13} /> Vérifier la connexion
                          </button>
                        </div>
                      </div>
                    )}
                    {oauthMessage && (
                      <div
                        className={`oauth-msg${authState.isAuthenticated ? ' success' : ''}`}
                      >
                        {oauthMessage}
                      </div>
                    )}
                  </div>
                </div>

                <div className="setting-divider">
                  <span>— ou utiliser une clé API —</span>
                </div>

                {/* API Key */}
                <div className="setting-group">
                  <label className="setting-label">
                    <Key size={14} /> Clé API Gemini
                  </label>
                  <input
                    type="password"
                    className="panel-input"
                    placeholder="AIza…"
                    value={settingsDraft.geminiApiKey}
                    onChange={(e) =>
                      setSettingsDraft((d) => ({
                        ...d,
                        geminiApiKey: e.target.value,
                      }))
                    }
                  />
                  <p className="setting-hint">
                    Obtenez votre clé sur{' '}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent-blue)' }}
                    >
                      Google AI Studio
                    </a>
                  </p>
                </div>

                {/* GitHub Token */}
                <div className="setting-group">
                  <label className="setting-label">
                    <GitBranch size={14} /> GitHub Personal Access Token
                  </label>
                  <input
                    type="password"
                    className="panel-input"
                    placeholder="ghp_…"
                    value={settingsDraft.githubToken}
                    onChange={(e) =>
                      setSettingsDraft((d) => ({
                        ...d,
                        githubToken: e.target.value,
                      }))
                    }
                  />
                  <p className="setting-hint">
                    Scope requis : <code>repo</code>. Créez-en un sur{' '}
                    <a
                      href="https://github.com/settings/tokens/new"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent-blue)' }}
                    >
                      GitHub
                    </a>
                  </p>
                </div>

                {/* Model */}
                <div className="setting-group">
                  <label className="setting-label">
                    <Cpu size={14} /> Modèle par défaut
                  </label>
                  <div className="model-setting-list">
                    {AVAILABLE_MODELS.map((m) => (
                      <button
                        key={m.id}
                        className={`model-setting-item${settingsDraft.selectedModel === m.id ? ' selected' : ''}`}
                        onClick={() =>
                          setSettingsDraft((d) => ({
                            ...d,
                            selectedModel: m.id,
                          }))
                        }
                      >
                        <div className="model-option-left">
                          <TierIcon tier={m.tier} />
                          <div>
                            <div className="model-option-name">{m.name}</div>
                            <div className="model-option-desc">
                              {m.description}
                            </div>
                          </div>
                        </div>
                        <span className={`tier-badge tier-${m.tier}`}>
                          {TierLabel[m.tier]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  className="panel-btn secondary"
                  style={{ width: 'auto', padding: '8px 20px' }}
                  onClick={() => setShowSettings(false)}
                >
                  Annuler
                </button>
                <button
                  className="panel-btn primary"
                  style={{ width: 'auto', padding: '8px 20px' }}
                  onClick={saveAndCloseSettings}
                >
                  <CheckCircle size={14} /> Enregistrer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Global CSS ── */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .animate-bounce { animation: bounce 1s infinite; }
        .spin { animation: spin .8s linear infinite; }
        .opacity-50 { opacity: .5; }
        .rotated { transform: rotate(180deg); transition: transform .2s; }

        /* ── Sidebar ── */
        .sidebar-header { padding: 20px 16px; border-bottom: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: space-between; }
        .new-chat-btn { background: rgba(59,130,246,.15); border: 1px solid rgba(59,130,246,.3); border-radius: 8px; padding: 6px; color: var(--accent-blue); cursor: pointer; display: flex; align-items: center; transition: all .2s; }
        .new-chat-btn:hover { background: rgba(59,130,246,.25); }
        .section-label { margin: 20px 0 4px; color: var(--text-secondary); font-size: .72rem; font-weight: 600; text-transform: uppercase; padding: 0 12px; }
        .sidebar-footer { padding: 16px; border-top: 1px solid var(--glass-border); }
        .history-item { position: relative; }
        .history-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; }
        .history-delete { display: none; background: none; border: none; cursor: pointer; color: var(--text-secondary); padding: 2px; border-radius: 4px; }
        .history-delete:hover { color: #ef4444; }
        .history-item:hover .history-delete { display: flex; }

        /* ── Status dot ── */
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }

        /* ── Model selector ── */
        .model-selector { position: relative; }
        .model-trigger { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,.06); border: 1px solid var(--glass-border); border-radius: 8px; padding: 6px 12px; color: var(--text-primary); cursor: pointer; font-size: .85rem; font-family: inherit; transition: all .2s; }
        .model-trigger:hover { background: rgba(255,255,255,.1); }
        .model-dropdown { position: absolute; top: calc(100% + 8px); left: 0; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 12px; padding: 6px; min-width: 280px; z-index: 200; box-shadow: 0 16px 40px rgba(0,0,0,.5); }
        .model-option { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 8px; background: none; border: none; color: var(--text-primary); cursor: pointer; transition: background .15s; font-family: inherit; }
        .model-option:hover { background: rgba(255,255,255,.06); }
        .model-option.selected { background: rgba(59,130,246,.12); }
        .model-option-left { display: flex; align-items: center; gap: 10px; }
        .model-option-name { font-size: .85rem; font-weight: 500; text-align: left; }
        .model-option-desc { font-size: .72rem; color: var(--text-secondary); text-align: left; }
        .tier-badge { font-size: .68rem; font-weight: 600; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
        .tier-free { background: rgba(16,185,129,.15); color: #10b981; }
        .tier-preview { background: rgba(139,92,246,.15); color: #a78bfa; }
        .tier-limited { background: rgba(245,158,11,.15); color: #fbbf24; }

        /* ── Attached chips ── */
        .attached-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 24px 0; }
        .file-chip { display: flex; align-items: center; gap: 5px; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 20px; padding: 3px 10px; font-size: .78rem; color: var(--text-primary); }
        .chip-size { color: var(--text-secondary); font-size: .7rem; }
        .chip-remove { background: none; border: none; cursor: pointer; color: var(--text-secondary); display: flex; align-items: center; padding: 0; margin-left: 2px; }
        .chip-remove:hover { color: #ef4444; }

        /* ── Input ── */
        .disclaimer { text-align: center; margin-top: 10px; font-size: .68rem; color: var(--text-secondary); }

        /* ── Right panel ── */
        .right-panel { width: 300px; background: var(--bg-secondary); border-left: 1px solid var(--glass-border); display: flex; flex-direction: column; }
        .right-tabs { display: flex; border-bottom: 1px solid var(--glass-border); }
        .right-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 13px 8px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); cursor: pointer; font-size: .82rem; font-family: inherit; transition: all .2s; }
        .right-tab:hover { color: var(--text-primary); }
        .right-tab.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); }
        .badge { background: var(--accent-blue); color: #fff; font-size: .62rem; font-weight: 700; border-radius: 10px; padding: 1px 6px; }

        .panel-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .panel-hint { font-size: .78rem; color: var(--text-secondary); line-height: 1.5; }
        .panel-hint strong { color: var(--text-primary); }
        .panel-hint code { background: rgba(255,255,255,.07); padding: 1px 5px; border-radius: 4px; font-size: .75rem; }
        .panel-input { width: 100%; background: rgba(255,255,255,.05); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 12px; color: var(--text-primary); font-size: .83rem; font-family: inherit; outline: none; }
        .panel-input:focus { border-color: var(--accent-blue); }
        .panel-input.small { padding: 6px 10px; font-size: .78rem; }
        .panel-textarea { width: 100%; background: rgba(255,255,255,.05); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 10px; color: var(--text-primary); font-size: .76rem; font-family: var(--font-mono); resize: vertical; outline: none; }
        .panel-textarea:focus { border-color: var(--accent-blue); }
        .panel-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: .82rem; font-family: inherit; cursor: pointer; border: none; transition: all .2s; width: 100%; }
        .panel-btn.primary { background: var(--accent-gradient); color: #fff; }
        .panel-btn.primary:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); }
        .panel-btn.primary:disabled { opacity: .5; cursor: not-allowed; }
        .panel-btn.secondary { background: rgba(255,255,255,.07); color: var(--text-secondary); border: 1px solid var(--glass-border); }
        .panel-btn.secondary:hover { color: var(--text-primary); }
        .panel-toolbar { display: flex; gap: 6px; align-items: center; }
        .panel-toolbar .panel-input { flex: 1; }
        .icon-btn { background: rgba(255,255,255,.05); border: 1px solid var(--glass-border); border-radius: 6px; padding: 6px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s; }
        .icon-btn:hover { color: var(--text-primary); background: rgba(255,255,255,.1); }
        .icon-btn.danger:hover { color: #ef4444; }
        .icon-btn:disabled { opacity: .4; cursor: not-allowed; }
        .panel-error { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); border-radius: 8px; padding: 8px 10px; font-size: .76rem; color: #f87171; display: flex; align-items: center; gap: 6px; }
        .panel-loading { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: .82rem; padding: 16px 0; justify-content: center; }
        .panel-empty { color: var(--text-secondary); font-size: .8rem; text-align: center; padding: 20px 4px; line-height: 1.7; }
        .token-form { display: flex; flex-direction: column; gap: 10px; }

        /* ── Repos ── */
        .repo-list { display: flex; flex-direction: column; gap: 5px; }
        .repo-item { background: rgba(255,255,255,.03); border: 1px solid var(--glass-border); border-radius: 8px; padding: 9px 11px; cursor: pointer; transition: all .2s; }
        .repo-item:hover { background: rgba(255,255,255,.06); }
        .repo-item.selected { border-color: var(--accent-blue); background: rgba(59,130,246,.08); }
        .repo-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; }
        .repo-name { display: flex; align-items: center; gap: 5px; font-size: .82rem; font-weight: 500; }
        .repo-stars { display: flex; align-items: center; gap: 3px; font-size: .72rem; color: var(--text-secondary); }
        .repo-desc { font-size: .72rem; color: var(--text-secondary); margin-bottom: 5px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .repo-footer { display: flex; align-items: center; justify-content: space-between; }
        .repo-lang { display: flex; align-items: center; gap: 4px; font-size: .7rem; color: var(--text-secondary); }
        .lang-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .repo-arrow { color: var(--text-secondary); opacity: 0; transition: opacity .2s; }
        .repo-item:hover .repo-arrow { opacity: 1; }

        /* ── Commit ── */
        .commit-section { border-top: 1px solid var(--glass-border); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .commit-repo-label { display: flex; align-items: center; gap: 6px; font-size: .8rem; color: var(--accent-blue); font-weight: 500; }
        .commit-form { display: flex; flex-direction: column; gap: 7px; }
        .commit-content-row { position: relative; }
        .use-response-btn { position: absolute; top: 6px; right: 6px; background: rgba(59,130,246,.15); border: 1px solid rgba(59,130,246,.3); border-radius: 4px; padding: 3px 5px; cursor: pointer; color: var(--accent-blue); display: flex; align-items: center; transition: all .2s; }
        .use-response-btn:hover { background: rgba(59,130,246,.25); }
        .commit-actions { display: flex; gap: 7px; }
        .commit-actions .panel-btn { flex: 1; }

        /* ── File list ── */
        .file-list { display: flex; flex-direction: column; gap: 7px; }
        .file-list-item { display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,.03); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 10px; }
        .file-list-info { display: flex; align-items: center; gap: 9px; overflow: hidden; }
        .file-thumb { width: 38px; height: 38px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
        .file-icon { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.06); border-radius: 4px; color: var(--text-secondary); flex-shrink: 0; }
        .file-meta { display: flex; flex-direction: column; overflow: hidden; }
        .file-name { font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .file-size { font-size: .7rem; color: var(--text-secondary); }

        /* ── Settings Modal ── */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); backdrop-filter: blur(6px); z-index: 500; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .modal { background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 16px; width: 100%; max-width: 480px; box-shadow: 0 24px 60px rgba(0,0,0,.6); display: flex; flex-direction: column; max-height: 90vh; }
        .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--glass-border); }
        .modal-title { font-size: 1rem; font-weight: 600; }
        .modal-body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; }
        .modal-footer { display: flex; gap: 10px; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--glass-border); }
        .setting-group { display: flex; flex-direction: column; gap: 8px; }
        .setting-label { display: flex; align-items: center; gap: 7px; font-size: .83rem; font-weight: 500; color: var(--text-primary); }
        .setting-hint { font-size: .73rem; color: var(--text-secondary); }
        .setting-hint code { background: rgba(255,255,255,.07); padding: 1px 5px; border-radius: 4px; }
        .model-setting-list { display: flex; flex-direction: column; gap: 5px; }
        .model-setting-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,.03); border: 1px solid var(--glass-border); color: var(--text-primary); cursor: pointer; transition: all .2s; font-family: inherit; }
        .model-setting-item:hover { background: rgba(255,255,255,.06); }
        .model-setting-item.selected { border-color: var(--accent-blue); background: rgba(59,130,246,.1); }

        /* ── CLI terminal ── */
        .cli-log { flex: 1; min-height: 120px; max-height: 340px; overflow-y: auto; background: #0a0a0c; border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px; font-family: var(--font-mono); font-size: .72rem; }
        .cli-line { color: #a3e635; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
        .cli-placeholder { color: var(--text-secondary); font-size: .78rem; font-family: inherit; }

        /* ── Auth card ── */
        .auth-card { background: rgba(255,255,255,.03); border: 1px solid var(--glass-border); border-radius: 10px; padding: 14px; }
        .auth-status-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .auth-connected, .auth-disconnected { display: flex; flex-direction: column; }
        .oauth-msg { margin-top: 10px; font-size: .78rem; color: var(--text-secondary); padding: 7px 10px; background: rgba(255,255,255,.04); border-radius: 7px; }
        .oauth-msg.success { color: #10b981; background: rgba(16,185,129,.1); }
        .setting-divider { text-align: center; color: var(--text-secondary); font-size: .72rem; position: relative; margin: 4px 0; }
        .setting-divider::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--glass-border); z-index: 0; }
        .setting-divider span { position: relative; background: var(--bg-secondary); padding: 0 10px; z-index: 1; }
      `,
        }}
      />
    </div>
  );
};

export default App;
