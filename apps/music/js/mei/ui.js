// Mei Music 通用 UI：toast / 弹层 / 图标库
export const I = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  disc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
};

let toastTimer = 0;
export function toast(message) {
  let el = document.getElementById("meiToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "meiToast";
    el.className = "mei-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

// 通用弹层：返回关闭函数；content 为 DOM 节点
export function openDialog(content, { title = "", sub = "" } = {}) {
  const mask = document.createElement("div");
  mask.className = "mei-mask";
  const dialog = document.createElement("div");
  dialog.className = "mei-dialog";
  if (title) {
    const t = document.createElement("h3");
    t.className = "d-title";
    t.textContent = title;
    dialog.appendChild(t);
  }
  if (sub) {
    const s = document.createElement("p");
    s.className = "d-sub";
    s.textContent = sub;
    dialog.appendChild(s);
  }
  dialog.appendChild(content);
  mask.appendChild(dialog);
  const close = () => mask.remove();
  mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
  return close;
}

export function confirmDialog(message, { danger = false, okText = "确定" } = {}) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.innerHTML = `
      <p style="font-size:13px;color:var(--muted);margin:0 0 16px;line-height:1.6"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="mei-btn-ghost" data-r="no">取消</button>
        <button class="${danger ? "mei-btn" : "mei-btn"}" data-r="ok" ${danger ? 'style="background:var(--danger);box-shadow:none"' : ""}></button>
      </div>
    `;
    box.querySelector("p").textContent = message;
    box.querySelector('[data-r="ok"]').textContent = okText;
    const close = openDialog(box);
    box.querySelector('[data-r="no"]').onclick = () => { close(); resolve(false); };
    box.querySelector('[data-r="ok"]').onclick = () => { close(); resolve(true); };
  });
}

export function promptDialog(message, initial = "", placeholder = "") {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.innerHTML = `
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px;line-height:1.6"></p>
      <input class="mei-input" style="height:38px;font-size:13px;margin-bottom:14px">
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="mei-btn-ghost" data-r="no">取消</button>
        <button class="mei-btn" data-r="ok">确定</button>
      </div>
    `;
    box.querySelector("p").textContent = message;
    const input = box.querySelector("input");
    input.value = initial;
    input.placeholder = placeholder;
    const close = openDialog(box);
    const done = (val) => { close(); resolve(val); };
    box.querySelector('[data-r="no"]').onclick = () => done(null);
    box.querySelector('[data-r="ok"]').onclick = () => done(input.value);
    input.onkeydown = (e) => { if (e.key === "Enter") done(input.value); };
    setTimeout(() => input.focus(), 30);
  });
}

export function emptyHtml(iconKey, text) {
  return `<div class="mei-empty"><div class="e-icon">${I[iconKey] || I.music}</div><div></div></div>`;
}
