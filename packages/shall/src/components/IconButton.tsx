'use client';
// 通用图标按钮 —— 玻璃质感，复用于各顶栏工具按钮
import { ButtonHTMLAttributes, ReactNode } from 'react';

export default function IconButton({
  children,
  title,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      title={title}
      {...rest}
      style={{
        width: 34,
        height: 34,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--mei-bg-elevated)',
        border: '1px solid var(--mei-border)',
        borderRadius: 'var(--mei-radius-sm)',
        color: 'var(--mei-text-muted)',
        cursor: 'pointer',
        transition: 'var(--mei-transition)',
        ...rest.style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--mei-text)';
        e.currentTarget.style.borderColor = 'var(--mei-primary-soft)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--mei-text-muted)';
        e.currentTarget.style.borderColor = 'var(--mei-border)';
      }}
    >
      {children}
    </button>
  );
}
