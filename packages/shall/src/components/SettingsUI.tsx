'use client';

import type { ReactNode } from 'react';
import MeiIcon from '@/components/MeiIcon';

export function SettingsTabs({
  items,
  active,
  onChange,
}: {
  items: Array<{ id: string; label: string; icon?: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mei-tabs">
      {items.map((item) => (
        <button
          key={item.id}
          className={active === item.id ? 'active' : ''}
          onClick={() => onChange(item.id)}
        >
          {item.icon ? <MeiIcon icon={item.icon} size={14} /> : null}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function SettingsPage({
  icon,
  title,
  description,
  actions,
  tabs,
  children,
}: {
  icon: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mei-page">
      <header className="mei-page-head">
        <div className="mei-page-title">
          <span className="mei-page-icon">
            <MeiIcon icon={icon} size={19} />
          </span>
          <div>
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="mei-page-actions">{actions}</div> : null}
      </header>
      {tabs ? <div className="mei-page-tabs">{tabs}</div> : null}
      <div className="mei-page-body">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  wide,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`mei-section${wide ? ' wide' : ''}`}>
      <div className="mei-section-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="mei-section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsField({
  label,
  hint,
  children,
  span,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  span?: boolean;
}) {
  return (
    <label className={`mei-field${span ? ' span' : ''}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`mei-input${props.className ? ` ${props.className}` : ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`mei-select${props.className ? ` ${props.className}` : ''}`} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  hideLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  hideLabel?: boolean;
}) {
  return (
    <button type="button" className={`mei-toggle-row${checked ? ' on' : ''}${hideLabel ? ' compact' : ''}`} onClick={() => onChange(!checked)} aria-label={hideLabel ? label : undefined}>
      {hideLabel ? null : (
        <span className="mei-toggle-text">
          <strong>{label}</strong>
          {description ? <small>{description}</small> : null}
        </span>
      )}
      <span className="mei-toggle"><span /></span>
    </button>
  );
}

export function SettingsButton({
  variant = 'secondary',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return (
    <button {...props} className={`mei-action ${variant}${props.className ? ` ${props.className}` : ''}`}>
      {children}
    </button>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <span className={`mei-pill ${tone}`}>{children}</span>;
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mei-empty">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
export function Alert({ tone = 'info', title, description }: { tone?: 'success' | 'error' | 'info' | 'warning'; title: string; description?: string }) {
  return (
    <div className={`mei-alert ${tone}`}>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
export function FileInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="file" className={`mei-file-input${props.className ? ` ${props.className}` : ''}`} />;
}
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="mei-sticky-bar">{children}</div>;
}

export const settingsUiStyles = `
.mei-page{max-width:1180px;margin:0 auto;padding:4px 0 48px;}
.mei-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:20px;}
.mei-page-title{display:flex;align-items:center;gap:14px;min-width:0;}
.mei-page-icon{width:44px;height:44px;border-radius:15px;display:inline-flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(140deg,#6366f1,#8b5cf6 55%,#0ea5e9);box-shadow:0 12px 28px rgba(79,70,229,.22);}
.mei-page-title h1{margin:0;font-size:24px;letter-spacing:-.5px;font-weight:850;}
.mei-page-title p{margin:3px 0 0;font-size:12.5px;color:var(--mei-text-muted);}
.mei-page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center;}
.mei-page-tabs{margin-bottom:16px;}
.mei-page-body{display:flex;flex-direction:column;gap:16px;align-items:stretch;}
.mei-page-tabs ~ .mei-page-body{}
.mei-tabs{display:flex;gap:4px;padding:4px;background:rgba(255,255,255,.92);border:1px solid var(--mei-border);border-radius:14px;margin-bottom:18px;box-shadow:var(--mei-shadow-sm);overflow-x:auto;}
.mei-tabs button{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 16px;border:none;border-radius:11px;background:transparent;font-size:12.5px;font-weight:700;color:var(--mei-text-muted);cursor:pointer;white-space:nowrap;transition:var(--mei-transition);}
.mei-tabs button:hover{background:rgba(99,102,241,.06);color:var(--mei-primary);}
.mei-tabs button.active{background:linear-gradient(135deg,rgba(99,102,241,.14),rgba(139,92,246,.1));color:var(--mei-primary);font-weight:800;box-shadow:0 2px 8px rgba(99,102,241,.1);}
.mei-section{background:rgba(255,255,255,.94);border:1px solid var(--mei-border);border-radius:20px;padding:20px;box-shadow:var(--mei-shadow-sm);min-width:0;}
.mei-section.wide{grid-column:1/-1;}
.mei-section-head{display:flex;justify-content:space-between;gap:14px;margin-bottom:15px;}
.mei-section-head h2{margin:0;font-size:15px;font-weight:800;letter-spacing:-.2px;}
.mei-section-head p{margin:4px 0 0;font-size:12px;color:var(--mei-text-muted);}
.mei-section-actions{display:flex;gap:8px;align-items:center;flex-shrink:0;}
.mei-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;}
.mei-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr));}
.mei-field{display:flex;flex-direction:column;gap:6px;min-width:0;}
.mei-field.span{grid-column:1/-1;}
.mei-field>span{font-size:12px;font-weight:750;color:var(--mei-text-muted);}
.mei-field small{font-size:11px;color:var(--mei-text-faint);line-height:1.5;}
.mei-input,.mei-select{width:100%;height:38px;padding:0 12px;border-radius:12px;border:1px solid var(--mei-border-strong);background:rgba(255,255,255,.82);color:var(--mei-text);font-size:13px;outline:none;transition:var(--mei-transition);font-family:inherit;}
.mei-input:focus,.mei-select:focus{border-color:var(--mei-primary);box-shadow:0 0 0 3px rgba(99,102,241,.13);}
.mei-input:disabled,.mei-select:disabled{opacity:.6;cursor:not-allowed;}
textarea.mei-input{height:auto;min-height:86px;padding:10px 12px;line-height:1.55;resize:vertical;}
.mei-toggle-row{width:100%;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px;border:1px solid var(--mei-border);border-radius:14px;background:rgba(255,255,255,.58);cursor:pointer;text-align:left;transition:var(--mei-transition);}
.mei-toggle-row:hover{border-color:rgba(99,102,241,.35);background:rgba(99,102,241,.05);}
.mei-toggle-row.on{border-color:rgba(99,102,241,.34);background:rgba(99,102,241,.07);}
.mei-toggle-text{display:flex;flex-direction:column;gap:3px;min-width:0;}
.mei-toggle-text strong{font-size:13px;font-weight:730;}
.mei-toggle-text small{font-size:11.5px;color:var(--mei-text-muted);line-height:1.45;}
.mei-toggle{width:42px;height:24px;border-radius:99px;background:#d8dde9;position:relative;flex-shrink:0;transition:var(--mei-transition);}
.mei-toggle span{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(23,32,56,.22);transition:var(--mei-transition);}
.mei-toggle-row.on .mei-toggle{background:var(--mei-primary);}
.mei-toggle-row.on .mei-toggle span{transform:translateX(18px);}
.mei-toggle-row.compact{width:auto;padding:0;border:none;background:transparent;justify-content:center;}
.mei-toggle-row.compact:hover{background:transparent;}
.mei-action{height:36px;padding:0 15px;border-radius:12px;border:1px solid transparent;font-size:12.5px;font-weight:720;cursor:pointer;transition:var(--mei-transition);display:inline-flex;align-items:center;gap:7px;white-space:nowrap;}
.mei-action.primary{background:var(--mei-primary);color:#fff;box-shadow:0 10px 22px rgba(79,70,229,.22);}
.mei-action.primary:hover{filter:brightness(.96);transform:translateY(-1px);}
.mei-action.secondary{background:rgba(255,255,255,.78);border-color:var(--mei-border-strong);color:var(--mei-text);}
.mei-action.secondary:hover{border-color:rgba(99,102,241,.38);color:var(--mei-primary);}
.mei-action.ghost{background:transparent;color:var(--mei-text-muted);}
.mei-action.danger{background:rgba(220,38,38,.09);color:#dc2626;}
.mei-action:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.mei-pill{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:99px;font-size:11px;font-weight:800;}
.mei-pill.neutral{background:rgba(100,116,139,.1);color:#64748b;}
.mei-pill.success{background:rgba(16,185,129,.11);color:#059669;}
.mei-pill.warning{background:rgba(245,158,11,.13);color:#d97706;}
.mei-pill.danger{background:rgba(220,38,38,.1);color:#dc2626;}
.mei-empty{padding:28px;border-radius:16px;border:1px dashed var(--mei-border-strong);text-align:center;background:rgba(255,255,255,.5);}
.mei-empty strong{font-size:13.5px;}
.mei-empty p{margin:6px 0 0;font-size:12px;color:var(--mei-text-muted);}
.mei-alert{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:14px;font-size:12.5px;margin-bottom:14px;}
.mei-alert strong{font-weight:800;}
.mei-alert p{margin:0;font-size:11.5px;opacity:.85;}
.mei-alert.success{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);color:#065f46;}
.mei-alert.error{background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.18);color:#991b1b;}
.mei-alert.info{background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15);color:#3730a3;}
.mei-alert.warning{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);color:#92400e;}
.mei-file-input{width:100%;font-size:12.5px;padding:8px 0;border:none;background:transparent;cursor:pointer;}
.mei-file-input::-webkit-file-upload-button{height:32px;padding:0 14px;border:1px solid var(--mei-border-strong);border-radius:10px;background:rgba(255,255,255,.8);color:var(--mei-text);font-size:12.5px;font-weight:700;cursor:pointer;margin-right:10px;transition:var(--mei-transition);}
.mei-file-input::-webkit-file-upload-button:hover{border-color:rgba(99,102,241,.35);color:var(--mei-primary);}
.mei-file-input::file-selector-button{height:32px;padding:0 14px;border:1px solid var(--mei-border-strong);border-radius:10px;background:rgba(255,255,255,.8);color:var(--mei-text);font-size:12.5px;font-weight:700;cursor:pointer;margin-right:10px;transition:var(--mei-transition);}
.mei-file-input::file-selector-button:hover{border-color:rgba(99,102,241,.35);color:var(--mei-primary);}
.mei-sticky-bar{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:10px;padding:14px 0;margin-top:8px;background:linear-gradient(to top,rgba(255,255,255,.96),rgba(255,255,255,0));z-index:10;}
.mei-footer-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:12px;flex-wrap:wrap;}
.mei-toggle-stack{display:flex;flex-direction:column;gap:9px;}
.mei-source-stack{display:flex;flex-direction:column;gap:9px;}
.mei-cloud-info{padding:14px;border-radius:14px;background:rgba(255,255,255,.5);border:1px solid var(--mei-border);}
.mei-cloud-info strong{font-size:13px;font-weight:800;display:block;}
.mei-cloud-info p{margin:5px 0 0;font-size:11.5px;color:var(--mei-text-muted);line-height:1.5;}
.mei-channel-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:13px;}
.mei-source-stats{display:flex;gap:8px;flex-wrap:wrap;}
.mei-table{width:100%;border-collapse:separate;border-spacing:0 6px;font-size:12.5px;}
.mei-table th{text-align:left;padding:0 12px 4px;font-size:10.5px;color:var(--mei-text-faint);letter-spacing:.7px;text-transform:uppercase;}
.mei-table td{padding:11px 12px;background:rgba(255,255,255,.66);border-top:1px solid var(--mei-border);border-bottom:1px solid var(--mei-border);}
.mei-table tr td:first-child{border-left:1px solid var(--mei-border);border-radius:13px 0 0 13px;}
.mei-table tr td:last-child{border-right:1px solid var(--mei-border);border-radius:0 13px 13px 0;}
.mei-logs{max-height:calc(100vh - 300px);overflow:auto;border:1px solid var(--mei-border);border-radius:16px;background:rgba(15,23,42,.025);}
.mei-log{display:grid;grid-template-columns:150px 70px 1fr;gap:10px;padding:9px 12px;border-bottom:1px solid var(--mei-border);font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;}
.mei-log:last-child{border-bottom:none;}
.mei-log.warning{background:rgba(245,158,11,.07);color:#92400e;}
.mei-log.error{background:rgba(220,38,38,.07);color:#991b1b;}
@media(max-width:900px){.mei-grid{grid-template-columns:1fr;}.mei-page-head{align-items:flex-start;flex-direction:column;}.mei-log{grid-template-columns:1fr;gap:4px;}}
`;
