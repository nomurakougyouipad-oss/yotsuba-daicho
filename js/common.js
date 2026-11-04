// よつば台帳 共通の部品（明るい／暗い・右から出る画面・お知らせ）
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/** 文字を HTML に入れるときに使う（名前などに < > があっても、こわれないように） */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 円・時間・人工の書き方 */
export const yen = n => Math.round(n || 0).toLocaleString("ja-JP");
export const hrs = n => (Math.round((n || 0) * 10) / 10).toLocaleString("ja-JP");
export const nk = n => (Math.round((n || 0) * 100) / 100).toLocaleString("ja-JP", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const mdText = d => (d ? String(d).slice(5).replace("-", "/") : "");
export const ymText = m => (m ? `${+m.slice(0, 4)}年${+m.slice(5)}月` : "");

/** 下に少しだけ出るお知らせ */
let toastTimer = 0;
export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    t.setAttribute("role", "status");
    document.body.append(t);
  }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------- 右から出る画面（パネル） ---------- */
let lastFocus = null;
export function openPanel(html, after) {
  const ov = $("#overlay"), p = $("#panel");
  if (!p.classList.contains("open")) lastFocus = document.activeElement;
  p.innerHTML = html;
  p.scrollTop = 0;
  p.classList.add("open");
  ov.classList.add("open");
  document.body.style.overflow = "hidden";
  const x = $("[data-close]", p);
  if (x) x.addEventListener("click", closePanel);
  if (after) after(p);
}
export function closePanel() {
  const ov = $("#overlay"), p = $("#panel");
  if (!p.classList.contains("open")) return;
  p.classList.remove("open");
  ov.classList.remove("open");
  p.innerHTML = "";
  document.body.style.overflow = "";
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  if (onPanelClose) { const f = onPanelClose; onPanelClose = null; f(); }
}
let onPanelClose = null;
export const setOnPanelClose = f => { onPanelClose = f; };
export const panelOpen = () => $("#panel").classList.contains("open");
export function initPanel() {
  $("#overlay").addEventListener("click", closePanel);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(); });
}

/* ---------- 明るい／暗い（資材便と同じ覚え方 yotsuba-theme。同じブラウザなら、資材便と台帳で同じになる） ---------- */
const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const BAR = { dark: "#0F1418", light: "#F3F5F7" };
function currentTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark" || t === "light") return t;
  return mq && mq.matches ? "dark" : "light";
}
function paintTheme() {
  const t = currentTheme();
  const b = $("#themeBtn");
  if (b) { b.textContent = t === "dark" ? "☀" : "☾"; b.title = t === "dark" ? "明るい画面にする" : "暗い画面にする"; }
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", BAR[t]);
}
export function initTheme() {
  $("#themeBtn").addEventListener("click", () => {
    const n = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    try { localStorage.setItem("yotsuba-theme", n); } catch (err) { }
    paintTheme();
  });
  if (mq && mq.addEventListener) mq.addEventListener("change", paintTheme);
  paintTheme();
}
