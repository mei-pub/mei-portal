'use client';

import { syncAppTokens } from '@/lib/token-sync';

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`响应格式错误：HTTP ${res.status}`);
  }
  if (!res.ok) {
    const err = data as { error?: string; message?: string };
    throw new Error(err.error || err.message || `请求失败：HTTP ${res.status}`);
  }
  return data as T;
}

export async function ensureAppSession(app: string): Promise<void> {
  // 统一身份改造：不再有按应用补发登录态的 repenetrate，只需刷新统一令牌到 localStorage
  await syncAppTokens().catch(() => {});
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Append the settings-page disk source config (pansou_plugins /
 * pansou_channels / pansou_disk_types) to a search request.
 * Keys are only sent once the user has saved the settings page — absent keys
 * keep the backend defaults (all enabled sources); a saved empty list means
 * the user explicitly disabled every source in that dimension.
 */
export function appendDiskSourceParams(params: URLSearchParams): void {
  if (typeof window === 'undefined') return;
  const readList = (key: string): string[] | null => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string' && v.trim()) : [];
    } catch {
      return [];
    }
  };
  const plugins = readList('pansou_plugins');
  const channels = readList('pansou_channels');
  const diskTypes = readList('pansou_disk_types');
  if (plugins === null && channels === null && diskTypes === null) return;
  if (plugins !== null) params.set('plugins', plugins.join(','));
  if (channels !== null) params.set('channels', channels.join(','));
  if (diskTypes !== null) params.set('cloud_types', diskTypes.join(','));
}

export function getAiDrawToken(): string {
  try {
    const parsed = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return String(parsed?.state?.token || '');
  } catch {
    return '';
  }
}

export function getMediagoApiKey(): string {
  try {
    const parsed = JSON.parse(localStorage.getItem('appstore-storage') || '{}');
    return String(parsed?.state?.apiKey || '');
  } catch {
    return '';
  }
}

export async function authorizedJsonFetch<T>(
  url: string,
  app: 'ai-draw' | 'mediago',
  init?: RequestInit,
): Promise<T> {
  await ensureAppSession(app);
  await syncAppTokens();
  const token = app === 'ai-draw' ? getAiDrawToken() : getMediagoApiKey();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set(app === 'ai-draw' ? 'Authorization' : 'X-API-Key', app === 'ai-draw' ? `Bearer ${token}` : token);
  }
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return jsonFetch<T>(url, { ...init, headers });
}
