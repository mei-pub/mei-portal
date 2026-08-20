"use client";
// 图标选择器（对齐门户 ItemIconPicker 风格）：emoji 预设 / 图片地址 / 底色色板 + 预览
import { useState } from "react";

const EMOJI_PRESETS = ["📖", "📚", "📕", "📗", "📘", "📙", "🔖", "✒️", "🖋️", "🌙", "⭐", "🔥", "🌸", "🍃", "⚔️", "🏰", "🐉", "🦊", "👑", "💎", "🗡️", "🧙", "🚀", "💕"];
const COLOR_SWATCHES = ["", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#64748b"];

export default function IconPicker({
  icon, color, title, uploading, onIcon, onColor, onUpload,
}: {
  icon: string;
  color: string;
  title: string;
  uploading: boolean;
  onIcon: (v: string) => void;
  onColor: (v: string) => void;
  onUpload: (f: File) => void;
}) {
  const isUrl = /^https?:\/\//.test(icon) || icon.startsWith("data:");
  const [tab, setTab] = useState<"emoji" | "img">(isUrl ? "img" : "emoji");
  const previewBg = color || "#6366f1";

  return (
    <div className="mei-card" style={{ padding: 14 }}>
      {/* 预览 + 类型切换 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: previewBg, display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 14px rgba(23,32,56,0.18), inset 0 1px 0 rgba(255,255,255,0.25)",
            overflow: "hidden", fontSize: 26, color: "#fff", fontWeight: 700,
          }}
        >
          {isUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={icon} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : icon ? (
            icon
          ) : (
            (title || "书").slice(0, 1)
          )}
        </div>
        <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999, background: "rgba(23,32,56,0.06)" }}>
          {(["emoji", "img"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              style={{
                padding: "4px 14px", borderRadius: 999, border: "none", fontSize: 12, cursor: "pointer",
                background: tab === k ? "#fff" : "transparent",
                color: tab === k ? "var(--foreground)" : "var(--muted)",
                fontWeight: tab === k ? 650 : 400,
                boxShadow: tab === k ? "0 1px 4px rgba(23,32,56,0.12)" : "none",
              }}>
              {k === "emoji" ? "Emoji 图标" : "图片图标"}
            </button>
          ))}
        </div>
      </div>

      {tab === "emoji" ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {EMOJI_PRESETS.map((e) => (
            <button key={e} type="button"
              onClick={() => onIcon(icon === e ? "" : e)}
              style={{
                width: 34, height: 34, borderRadius: 9, fontSize: 17, cursor: "pointer",
                border: icon === e ? "2px solid var(--primary)" : "1px solid var(--border)",
                background: icon === e ? "var(--accent)" : "#fff",
              }}>
              {e}
            </button>
          ))}
          <input
            value={isUrl ? "" : icon}
            onChange={(e) => onIcon(e.target.value)}
            placeholder="或输入 emoji"
            className="mei-input"
            style={{ width: 110, padding: "6px 10px" }}
          />
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            value={isUrl ? icon : ""}
            onChange={(e) => onIcon(e.target.value)}
            placeholder="粘贴图片地址"
            className="mei-input"
            style={{ flex: 1, minWidth: 160 }}
          />
          <label className="mei-btn-ghost" style={{ cursor: "pointer", padding: "7px 14px", fontSize: 12 }}>
            {uploading ? "上传中…" : "上传"}
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          </label>
          {icon && (
            <button type="button" onClick={() => onIcon("")} style={{ border: "none", background: "none", color: "#ef4444", fontSize: 12, cursor: "pointer" }}>移除</button>
          )}
        </div>
      )}

      {/* 底色色板 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 2 }}>底色</span>
        {COLOR_SWATCHES.map((c) => (
          <button key={c || "default"} type="button"
            onClick={() => onColor(c)}
            title={c || "默认"}
            style={{
              width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
              background: c || "linear-gradient(135deg,#6366f1,#a855f7)",
              border: (color || "") === c ? "2px solid var(--foreground)" : "2px solid rgba(255,255,255,0.9)",
              boxShadow: "0 1px 4px rgba(23,32,56,0.2)",
            }}
          />
        ))}
        <input type="color" value={color || "#6366f1"} onChange={(e) => onColor(e.target.value)}
          title="自定义颜色"
          style={{ width: 24, height: 24, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
      </div>
    </div>
  );
}
