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
  try {
    await fetch('/api/auth/repenetrate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app }),
    });
  } catch {}
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
