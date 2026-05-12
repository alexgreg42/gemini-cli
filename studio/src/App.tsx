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
  Github,
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import {
  sendMessageToGemini,
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

type RightTab = 'github' | 'files';
type CommitStatus = 'idle' | 'loading' | 'success' | 'error';

const App: React.FC = () => {
  // Chat state
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'model',
      content:
        'Bonjour ! Je suis Gemini Flash. Comment puis-je vous aider avec votre projet ?',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // File upload state
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GitHub state
  const [githubToken, setGithubToken] = useState<string>(
    () =>
      import.meta.env.VITE_GITHUB_TOKEN ||
      localStorage.getItem('github_token') ||
      '',
  );
  const [tokenInput, setTokenInput] = useState('');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoSearch, setRepoSearch] = useState('');

  // Commit state
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    Prism.highlightAll();
  }, [messages]);

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

  useEffect(() => {
    if (githubToken && repos.length === 0) {
      loadRepos(githubToken);
    }
  }, [githubToken, repos.length, loadRepos]);

  const handleConnectGitHub = () => {
    if (!tokenInput.trim()) return;
    setGithubToken(tokenInput.trim());
    loadRepos(tokenInput.trim());
    setTokenInput('');
  };

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
                const dataUrl = reader.result as string;
                const base64 = dataUrl.split(',')[1];
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

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input;
    const currentFiles = [...attachedFiles];
    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      const response = await sendMessageToGemini(
        currentInput,
        messages,
        currentFiles,
      );
      setMessages((prev) => [
        ...prev,
        { role: 'model', content: response, timestamp: Date.now() },
      ]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Erreur inconnue';
      setMessages((prev) => [
        ...prev,
        { role: 'model', content: `Erreur : ${msg}`, timestamp: Date.now() },
      ]);
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
    const last = [...messages].reverse().find((m) => m.role === 'model');
    if (last) setCommitContent(last.content);
  };

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

  return (
    <div className="app-container">
      {/* Left Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <Sparkles size={24} />
            <span>Gemini Studio</span>
          </div>
        </div>

        <div className="sidebar-content">
          <div className="nav-item active">
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

          <div className="section-label">Historique</div>
          <div className="nav-item">
            <MessageSquare size={16} />
            <span style={{ fontSize: '0.85rem' }}>Fix terminal bug</span>
          </div>
          <div className="nav-item">
            <MessageSquare size={16} />
            <span style={{ fontSize: '0.85rem' }}>Refactor core logic</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="nav-item">
            <Settings size={18} />
            <span>Paramètres</span>
          </div>
        </div>
      </aside>

      {/* Main Chat */}
      <main className="main-content">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Cpu size={20} color="var(--accent-blue)" />
            <span style={{ fontWeight: 600 }}>Gemini Flash</span>
            <div className="status-dot" />
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <button className="action-btn">
              <Search size={20} />
            </button>
            <button className="action-btn">
              <MoreVertical size={20} />
            </button>
          </div>
        </header>

        <div className="chat-window">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
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
                    <Sparkles size={20} color="white" />
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
                <Sparkles size={20} color="white" className="animate-pulse" />
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

        {/* Attached files chips */}
        {attachedFiles.length > 0 && (
          <div className="attached-chips">
            {attachedFiles.map((f, i) => (
              <div key={i} className="file-chip">
                <FileText size={13} />
                <span>{f.name}</span>
                <span className="chip-size">{formatSize(f.size)}</span>
                <button onClick={() => removeFile(i)} className="chip-remove">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

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
              placeholder="Message Gemini..."
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
            Gemini Flash peut fournir des informations incorrectes. Vérifiez les
            faits importants.
          </div>
        </div>
      </main>

      {/* Right Panel */}
      <aside className="right-panel">
        <div className="right-tabs">
          <button
            className={`right-tab${rightTab === 'github' ? ' active' : ''}`}
            onClick={() => setRightTab('github')}
          >
            <Github size={16} />
            <span>GitHub</span>
          </button>
          <button
            className={`right-tab${rightTab === 'files' ? ' active' : ''}`}
            onClick={() => setRightTab('files')}
          >
            <Upload size={16} />
            <span>Fichiers</span>
            {attachedFiles.length > 0 && (
              <span className="badge">{attachedFiles.length}</span>
            )}
          </button>
        </div>

        {/* GitHub Tab */}
        {rightTab === 'github' && (
          <div className="panel-body">
            {!githubToken ? (
              <div className="token-form">
                <p className="panel-hint">
                  Connectez votre compte GitHub avec un{' '}
                  <strong>Personal Access Token</strong> (scope:{' '}
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
                  <Github size={15} /> Connecter
                </button>
              </div>
            ) : (
              <>
                <div className="panel-toolbar">
                  <input
                    className="panel-input small"
                    placeholder="Rechercher un repo..."
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
                      size={15}
                      className={reposLoading ? 'spin' : ''}
                    />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => {
                      setGithubToken('');
                      setRepos([]);
                      localStorage.removeItem('github_token');
                    }}
                    title="Déconnecter"
                  >
                    <X size={15} />
                  </button>
                </div>

                {reposError && <div className="panel-error">{reposError}</div>}

                {reposLoading ? (
                  <div className="panel-loading">
                    <RefreshCw size={20} className="spin" />
                    <span>Chargement des repos...</span>
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
                              <Lock size={12} />
                            ) : (
                              <Globe size={12} />
                            )}
                            <span>{repo.name}</span>
                          </div>
                          <div className="repo-stars">
                            <Star size={11} />
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
                          <ChevronRight size={12} className="repo-arrow" />
                        </div>
                      </div>
                    ))}
                    {filteredRepos.length === 0 && !reposLoading && (
                      <div className="panel-empty">Aucun dépôt trouvé</div>
                    )}
                  </div>
                )}

                {/* Commit section */}
                {selectedRepo && (
                  <div className="commit-section">
                    <div className="commit-repo-label">
                      <GitCommit size={14} />
                      <span>{selectedRepo.name}</span>
                    </div>
                    {!showCommit ? (
                      <button
                        className="panel-btn primary"
                        onClick={() => setShowCommit(true)}
                      >
                        <GitCommit size={14} /> Commit &amp; Push
                      </button>
                    ) : (
                      <div className="commit-form">
                        <input
                          className="panel-input small"
                          placeholder="Chemin du fichier (ex: src/index.ts)"
                          value={commitPath}
                          onChange={(e) => setCommitPath(e.target.value)}
                        />
                        <div className="commit-content-row">
                          <textarea
                            className="panel-textarea"
                            placeholder="Contenu du fichier..."
                            value={commitContent}
                            onChange={(e) => setCommitContent(e.target.value)}
                            rows={6}
                          />
                          <button
                            className="use-response-btn"
                            onClick={useLastResponse}
                            title="Utiliser la dernière réponse Gemini"
                          >
                            <Sparkles size={12} />
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
                              <RefreshCw size={13} className="spin" />
                            ) : commitStatus === 'success' ? (
                              <CheckCircle size={13} />
                            ) : (
                              <GitCommit size={13} />
                            )}
                            {commitStatus === 'success'
                              ? 'Commité !'
                              : 'Envoyer'}
                          </button>
                        </div>
                        {commitStatus === 'error' && (
                          <div className="panel-error">
                            <AlertCircle size={13} /> {commitError}
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
                Les fichiers seront envoyés avec votre prochain message.
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
                          <FileText size={20} />
                        </div>
                      )}
                      <div className="file-meta">
                        <span className="file-name">{f.name}</span>
                        <span className="file-size">{formatSize(f.size)}</span>
                      </div>
                    </div>
                    <button
                      className="icon-btn danger"
                      onClick={() => removeFile(i)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        .animate-bounce { animation: bounce 1s infinite; }
        .spin { animation: spin 1s linear infinite; }
        .opacity-50 { opacity: 0.5; }

        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
        .section-label { margin-top: 32px; color: var(--text-secondary); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; padding: 0 12px; margin-bottom: 4px; }
        .sidebar-footer { padding: 24px; border-top: 1px solid var(--glass-border); }
        .disclaimer { text-align: center; margin-top: 12px; font-size: 0.7rem; color: var(--text-secondary); }

        /* Attached chips */
        .attached-chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 24px 0; }
        .file-chip { display: flex; align-items: center; gap: 6px; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: 20px; padding: 4px 10px; font-size: 0.8rem; color: var(--text-primary); }
        .chip-size { color: var(--text-secondary); font-size: 0.72rem; }
        .chip-remove { background: none; border: none; cursor: pointer; color: var(--text-secondary); display: flex; align-items: center; padding: 0; margin-left: 2px; }
        .chip-remove:hover { color: #ef4444; }

        /* Right panel */
        .right-panel { width: 300px; background: var(--bg-secondary); border-left: 1px solid var(--glass-border); display: flex; flex-direction: column; }
        .right-tabs { display: flex; border-bottom: 1px solid var(--glass-border); }
        .right-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 14px 8px; background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 0.85rem; font-family: inherit; transition: all 0.2s; border-bottom: 2px solid transparent; position: relative; }
        .right-tab:hover { color: var(--text-primary); }
        .right-tab.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); }
        .badge { background: var(--accent-blue); color: white; font-size: 0.65rem; font-weight: 700; border-radius: 10px; padding: 1px 6px; margin-left: 2px; }

        .panel-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .panel-hint { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; }
        .panel-hint strong { color: var(--text-primary); }
        .panel-hint code { background: rgba(255,255,255,0.07); padding: 1px 5px; border-radius: 4px; font-size: 0.78rem; }
        .panel-input { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 12px; color: var(--text-primary); font-size: 0.85rem; font-family: inherit; outline: none; }
        .panel-input:focus { border-color: var(--accent-blue); }
        .panel-input.small { padding: 6px 10px; font-size: 0.8rem; }
        .panel-textarea { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 10px; color: var(--text-primary); font-size: 0.78rem; font-family: var(--font-mono); resize: vertical; outline: none; }
        .panel-textarea:focus { border-color: var(--accent-blue); }
        .panel-btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 0.82rem; font-family: inherit; cursor: pointer; border: none; transition: all 0.2s; width: 100%; justify-content: center; }
        .panel-btn.primary { background: var(--accent-gradient); color: white; }
        .panel-btn.primary:hover { opacity: 0.9; transform: translateY(-1px); }
        .panel-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .panel-btn.secondary { background: rgba(255,255,255,0.07); color: var(--text-secondary); border: 1px solid var(--glass-border); }
        .panel-btn.secondary:hover { color: var(--text-primary); }
        .panel-toolbar { display: flex; gap: 6px; align-items: center; }
        .panel-toolbar .panel-input { flex: 1; }
        .icon-btn { background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 6px; padding: 6px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .icon-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.1); }
        .icon-btn.danger:hover { color: #ef4444; }
        .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .panel-error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 8px 10px; font-size: 0.78rem; color: #f87171; display: flex; align-items: center; gap: 6px; }
        .panel-loading { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: 0.85rem; padding: 16px 0; justify-content: center; }
        .panel-empty { color: var(--text-secondary); font-size: 0.82rem; text-align: center; padding: 20px 0; line-height: 1.6; }

        /* Repo list */
        .repo-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
        .repo-item { background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px 12px; cursor: pointer; transition: all 0.2s; }
        .repo-item:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.15); }
        .repo-item.selected { border-color: var(--accent-blue); background: rgba(59,130,246,0.08); }
        .repo-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .repo-name { display: flex; align-items: center; gap: 5px; font-size: 0.85rem; font-weight: 500; color: var(--text-primary); }
        .repo-stars { display: flex; align-items: center; gap: 3px; font-size: 0.75rem; color: var(--text-secondary); }
        .repo-desc { font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 6px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .repo-footer { display: flex; align-items: center; justify-content: space-between; }
        .repo-lang { display: flex; align-items: center; gap: 5px; font-size: 0.73rem; color: var(--text-secondary); }
        .lang-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .repo-arrow { color: var(--text-secondary); opacity: 0; transition: opacity 0.2s; }
        .repo-item:hover .repo-arrow { opacity: 1; }

        /* Commit section */
        .commit-section { border-top: 1px solid var(--glass-border); padding-top: 12px; display: flex; flex-direction: column; gap: 10px; }
        .commit-repo-label { display: flex; align-items: center; gap: 7px; font-size: 0.82rem; color: var(--accent-blue); font-weight: 500; }
        .commit-form { display: flex; flex-direction: column; gap: 8px; }
        .commit-content-row { position: relative; }
        .use-response-btn { position: absolute; top: 6px; right: 6px; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); border-radius: 4px; padding: 3px 5px; cursor: pointer; color: var(--accent-blue); display: flex; align-items: center; font-size: 0.7rem; transition: all 0.2s; }
        .use-response-btn:hover { background: rgba(59,130,246,0.25); }
        .commit-actions { display: flex; gap: 8px; }
        .commit-actions .panel-btn { flex: 1; }

        /* File list */
        .file-list { display: flex; flex-direction: column; gap: 8px; }
        .file-list-item { display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 10px; }
        .file-list-info { display: flex; align-items: center; gap: 10px; overflow: hidden; }
        .file-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
        .file-icon { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.06); border-radius: 4px; color: var(--text-secondary); flex-shrink: 0; }
        .file-meta { display: flex; flex-direction: column; overflow: hidden; }
        .file-name { font-size: 0.82rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .file-size { font-size: 0.72rem; color: var(--text-secondary); }

        /* Token form */
        .token-form { display: flex; flex-direction: column; gap: 10px; }
      `,
        }}
      />
    </div>
  );
};

export default App;
