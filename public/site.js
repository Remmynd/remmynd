// remmynd website pages: the theme switch, the menu sheet, copy buttons and the live numbers.
// The page talks only to remmynd.space: /stats is fetched from our own Worker, which asks GitHub and npm.
(() => {
const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);

/* ---------- theme: Auto follows the system; Light and Dark are kept in rm:theme (same as the app) ---------- */
const PAPER={light:"#F5F6F7",dark:"#0B0C0E"};
function applyTheme(t){const root=document.documentElement;if(t==="light"||t==="dark")root.dataset.theme=t;else{delete root.dataset.theme;t="auto";}
  const tl=$("#tc-light"),td=$("#tc-dark");
  if(tl&&td){tl.content=t==="dark"?PAPER.dark:PAPER.light;td.content=t==="light"?PAPER.light:PAPER.dark;}
  document.querySelectorAll("[data-theme-set]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.themeSet===t)));}
let saved = "auto";
try { saved = localStorage.getItem("rm:theme") || "auto"; } catch (e) {}
applyTheme(saved);
$$("[data-theme-set]").forEach(b => b.addEventListener("click", () => {
  const t = b.dataset.themeSet;
  try { if (t === "auto") localStorage.removeItem("rm:theme"); else localStorage.setItem("rm:theme", t); } catch (e) {}
  applyTheme(t);
}));

/* ---------- menu sheet ---------- */
const menu = $("#menu"), open = $("#menu-btn");
let back = null;
function closeMenu() { menu.hidden = true; open.setAttribute("aria-expanded", "false"); if (back) back.focus(); }
open.addEventListener("click", () => { back = document.activeElement; menu.hidden = false; open.setAttribute("aria-expanded", "true"); menu.querySelector("a").focus(); });
$("#menu-x").addEventListener("click", closeMenu);
menu.addEventListener("click", e => { if (e.target === menu) closeMenu(); });
document.addEventListener("keydown", e => {
  if (menu.hidden) return;
  if (e.key === "Escape") closeMenu();
  // Keep Tab inside the sheet while it is open.
  if (e.key === "Tab") {
    const f = [...menu.querySelectorAll("a,button")], first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* ---------- copy buttons on code ---------- */
$$("[data-copy]").forEach(b => b.addEventListener("click", async () => {
  const text = b.parentNode.querySelector("pre").textContent;
  try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; }
  catch (e) { b.textContent = "Select it"; }
  setTimeout(() => { b.textContent = "Copy"; }, 1600);
}));

/* ---------- the example preview card on /hosts: next Friday at 5 PM, in your own zone ---------- */
const when = $("[data-when]");
if (when) import("/remmynd.js").then(R => {
  const d = new Date(); d.setDate(d.getDate() + ((12 - d.getDay()) % 7 || 7)); d.setHours(17, 0, 0, 0);
  when.textContent = R.describeWhen(d, R.systemTimeZone()) + " · Tap to get reminded";
}).catch(() => {});

/* ---------- live numbers: a tile stays hidden when its number can't be fetched ---------- */
const tiles = $$("[data-stat]");
if (tiles.length) fetch("/stats").then(r => r.ok ? r.json() : {}).then(s => tiles.forEach(t => {
  const v = s[t.dataset.stat];
  if (typeof v === "number" && v >= 0) { t.querySelector("b").textContent = v.toLocaleString("en"); t.hidden = false; }
})).catch(() => {});
})();
