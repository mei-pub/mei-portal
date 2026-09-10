'use client';
// 最近使用记录 —— 用 localStorage 维护，门户首页置顶展示
import { useCallback, useEffect, useState } from 'react';

const KEY = 'mei-recents';
const MAX = 6;

export function useRecents() {
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      // 旧值损坏/非数组时忽略，避免 record() 里 prev.filter 抛错
      if (Array.isArray(parsed)) setRecents(parsed.filter((x) => typeof x === 'string'));
    } catch (e) {
      /* ignore */
    }
  }, []);

  const record = useCallback((id: string) => {
    setRecents((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  }, []);

  return { recents, record };
}
