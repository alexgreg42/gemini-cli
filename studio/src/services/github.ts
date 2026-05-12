/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  private: boolean;
}

function githubError(status: number, body: { message?: string }): Error {
  const msg = body?.message ?? '';
  if (status === 401) return new Error('Token GitHub invalide ou expiré.');
  if (status === 403) {
    if (msg.includes('rate limit'))
      return new Error(
        'Limite de requêtes GitHub atteinte. Réessayez dans une minute.',
      );
    return new Error(
      'Accès refusé. Vérifiez les permissions du token (scope: repo).',
    );
  }
  if (status === 404) return new Error('Dépôt ou fichier introuvable.');
  if (status === 409)
    return new Error(
      'Conflit : le fichier a été modifié entre-temps. Rechargez et réessayez.',
    );
  if (status === 422) return new Error(`Données invalides : ${msg}`);
  return new Error(msg || `GitHub erreur ${status}`);
}

export const fetchGitHubRepos = async (
  token: string,
): Promise<GitHubRepo[]> => {
  const response = await fetch(
    'https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner',
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw githubError(response.status, body);
  }
  return response.json();
};

export const commitFileToGitHub = async (
  token: string,
  fullName: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<void> => {
  // Use TextEncoder for proper Unicode → base64 conversion
  const bytes = new TextEncoder().encode(content);
  const binary = String.fromCharCode(...bytes);
  const encoded = btoa(binary);

  const body: Record<string, string> = { message, content: encoded };
  if (sha) body.sha = sha;

  const response = await fetch(
    `https://api.github.com/repos/${fullName}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw githubError(response.status, err);
  }
};

export const getFileSha = async (
  token: string,
  fullName: string,
  path: string,
): Promise<string | undefined> => {
  const response = await fetch(
    `https://api.github.com/repos/${fullName}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) return undefined;
  const data = (await response.json()) as { sha?: string };
  return data.sha;
};

export const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  CSS: '#563d7c',
  HTML: '#e34c26',
  Shell: '#89e051',
  Ruby: '#701516',
};
