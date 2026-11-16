/* Your page (/host): claim a handle, then publish launches to remmynd.space/@handle. Signing in uses the site's own
 * sheet (account.js). Everything goes through /api/host (worker/hosts.js), which checks every field again. */
import * as R from "/remmynd.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const box = $("#hp");
let S = { signedIn: false }, editing = null, editProfile = false, armed = null, note = "";
const upgrade = () => import("/account.js").then(m => m.open()).catch(() => location.assign("/"));
const nf = n => Number(n || 0).toLocaleString("en-US");
/* The plan (worker/pro.js planOf): Pro, free with limits once Pro is on offer, or nothing to say before that. */
function planCard() {
  const p = S.plan;
  if (!p || (!p.pro && !p.limited)) return "";
  if (p.pro) {
    const c = S.host.color || "";
    return '<div class="hp-card"><div class="hp-plan"><div><span class="hp-badge pro">Pro' + (p.trial ? " trial" : "") + '</span><ul><li>Unlimited live launches, changed any time</li><li>Up to 5,000 followers told each launch</li><li>Saves and who showed up, by day</li><li>Your colour, and no remmynd line</li></ul></div></div>' +
      '<h3 class="label hp-sub">Your colour</h3><div class="hp-colors" role="group" aria-label="Your colour">' +
      '<button type="button" class="none" data-color="" aria-pressed="' + (!c) + '">remmynd</button>' +
      p.colors.map(k => '<button type="button" class="sw-' + k + '" data-color="' + k + '" aria-pressed="' + (c === k) + '" aria-label="' + k + '"></button>').join("") + '</div></div>';
  }
  return '<div class="hp-card"><div class="hp-plan"><div><span class="hp-badge">Free</span><ul><li>' + p.free.live + ' live launch at a time</li><li>No changes once someone saved it</li><li>Your first ' + p.free.reach + ' followers told each launch</li><li>The saved count</li></ul></div>' +
    '<button type="button" class="btn ink" data-upgrade>Get Pro</button></div></div>';
}

async function api(path, body) {
  const init = body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  let res; try { res = await fetch(path, init); } catch (e) { throw new Error("No connection. Try again."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { need: data.need });
  return data;
}
const when = ms => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
const localInput = ms => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const phase = l => { const now = Date.now(); return now >= l.start + l.dur * 60000 ? "ended" : now >= l.start ? "live" : "before"; };
const short = u => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

async function load() {
  try { S = await api("/api/host"); } catch (e) { box.innerHTML = '<p class="hp-err">' + esc(e.message) + '</p>'; return; }
  render();
}

function render() {
  if (!S.signedIn) {
    box.innerHTML = '<div class="hp-card"><h2>Sign in to make your page</h2><p>Use a passkey or a code by email. No password.</p><div class="hp-row"><button type="button" class="btn ink" id="hp-in">Sign in</button></div></div>';
    $("#hp-in").addEventListener("click", () => import("/account.js").then(m => m.open()).catch(() => location.assign("/")));
    return;
  }
  if (!S.host || editProfile) return renderProfile();
  const h = S.host;
  box.innerHTML = '<div class="hp-top"><span><a class="hp-url" href="' + esc(h.url) + '">' + esc(short(h.url)) + '</a><br><span class="hp-meta">' + (h.followers ? h.followers.toLocaleString("en-US") + (h.followers === 1 ? " follower" : " followers") : "No followers yet. Share your page.") + '</span></span><div class="hp-row">' +
    '<a class="btn small ink" href="' + esc(h.url) + '">View page</a><button type="button" class="btn small" data-copy="' + esc(h.url) + '">Copy link</button><button type="button" class="btn small" id="hp-edit-p">Edit profile</button></div></div>' +
    (note ? '<p class="hp-read" role="status">' + esc(note) + '</p>' : "") +
    planCard() + launchForm() +
    '<div class="hp-card"><h2>Your launches</h2>' + (S.launches.length ? '<ul class="hp-list">' + S.launches.map(item).join("") + '</ul>' : '<p class="hp-wait">None yet. Publish your first one above.</p>') + '</div>';
  if (note) { const n = box.querySelector(".hp-read[role=status]"); if (n) n.scrollIntoView({ behavior: "smooth", block: "center" }); }
  note = "";
  for (const b of box.querySelectorAll("[data-upgrade]")) b.addEventListener("click", upgrade);
  for (const i of box.querySelectorAll(".hp-bars i")) i.style.height = Math.max(4, +i.dataset.h) + "%";
  for (const b of box.querySelectorAll("[data-color]")) b.addEventListener("click", async () => {
    try { S = await api("/api/host/brand", { color: b.dataset.color }); note = "Your pages use " + (b.dataset.color || "remmynd's colours") + " now."; } catch (e) { note = e.message; }
    render();
  });
  $("#hp-edit-p").addEventListener("click", () => { editProfile = true; render(); });
  wireForm();
  for (const b of box.querySelectorAll("[data-copy]")) b.addEventListener("click", () => copy(b.dataset.copy, b));
  for (const b of box.querySelectorAll("[data-edit]")) b.addEventListener("click", () => { editing = S.launches.find(l => l.id === b.dataset.edit); render(); $("#lf-title").focus(); window.scrollTo({ top: $("#lf").offsetTop - 80, behavior: "smooth" }); });
  for (const b of box.querySelectorAll("[data-del]")) b.addEventListener("click", () => del(b.dataset.del));
}

function renderProfile() {
  const h = S.host || {};
  box.innerHTML = '<form class="hp-card" id="pf" novalidate><h2>' + (S.host ? "Edit your page" : "Claim your page") + '</h2>' +
    '<label class="hp-field">Handle<span class="hp-handle"><span>remmynd.space/@</span><input id="pf-handle" value="' + esc(h.handle || "") + '" required autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="30" placeholder="yourname"></span></label>' +
    (S.host ? '<p class="hp-read">Changing it changes every link to your page and launches.</p>' : "") +
    '<label class="hp-field">Name<input id="pf-name" value="' + esc(h.name || "") + '" maxlength="60" placeholder="Your name or your product"></label>' +
    '<label class="hp-field">One line about you<input id="pf-bio" value="' + esc(h.bio || "") + '" maxlength="160" placeholder="Building the fastest way to…"></label>' +
    '<label class="hp-field">Your website<input id="pf-link" value="' + esc(short(h.link || "")) + '" inputmode="url" autocapitalize="none" placeholder="yoursite.com"></label>' +
    '<p class="hp-err" id="pf-err" role="alert"></p><div class="hp-row"><button class="btn ink" type="submit">' + (S.host ? "Save" : "Claim my page") + '</button>' +
    (S.host ? '<button class="btn" type="button" id="pf-x">Cancel</button>' : "") + '</div></form>';
  const handle = $("#pf-handle");
  handle.addEventListener("input", () => { const v = handle.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""); if (v !== handle.value) handle.value = v; });
  if ($("#pf-x")) $("#pf-x").addEventListener("click", () => { editProfile = false; render(); });
  $("#pf").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.submitter || $("#pf button[type=submit]"); btn.disabled = true;
    try {
      S = await api("/api/host", { handle: handle.value, name: $("#pf-name").value, bio: $("#pf-bio").value, link: $("#pf-link").value });
      editProfile = false; note = "Your page is live at " + short(S.host.url) + "."; render();
    } catch (err) { $("#pf-err").textContent = err.message; btn.disabled = false; }
  });
  if (!S.host) handle.focus();
}

function launchForm() {
  const l = editing;
  return '<form class="hp-card" id="lf" novalidate><h2>' + (l ? "Change “" + esc(l.title) + "”" : "New launch") + '</h2>' +
    (l ? "" : '<label class="hp-field">Type it in one line<input id="lf-line" placeholder="Demo Day Fri 5pm producthunt.com/posts/your-app" autocomplete="off"></label><p class="hp-read" id="lf-read">Or fill in the details below.</p>') +
    '<label class="hp-field">Title<input id="lf-title" value="' + esc(l ? l.title : "") + '" maxlength="120" placeholder="Demo Day"></label>' +
    '<label class="hp-field">Starts<input id="lf-start" type="datetime-local" value="' + (l ? localInput(l.start) : "") + '"></label>' +
    '<label class="hp-field">Where it goes live<input id="lf-dest" value="' + esc(l ? short(l.dest) : "") + '" inputmode="url" autocapitalize="none" placeholder="producthunt.com/posts/your-app"></label>' +
    '<label class="hp-check"><input type="checkbox" id="lf-count"' + (l && l.count ? " checked" : "") + '>Show how many will be reminded</label>' +
    '<p class="hp-err" id="lf-err" role="alert"></p><div class="hp-row"><button class="btn ink" type="submit">' + (l ? "Save changes" : "Publish") + '</button>' +
    (l ? '<button class="btn" type="button" id="lf-x">Cancel</button>' : "") + '</div>' +
    (l ? '<p class="hp-read">Everyone who tapped Remind me follows a change: their alerts move, and they\'re told once.</p>' : "") + '</form>';
}

function wireForm() {
  const line = $("#lf-line"), dur = { v: editing ? editing.dur : 60 };
  if (line) line.addEventListener("input", () => {
    const p = R.parse(line.value, { timeZone: TZ });
    if (p.title) $("#lf-title").value = p.title;
    if (p.start) $("#lf-start").value = localInput(p.start.getTime());
    if (p.place && /^https?:/.test(p.place)) $("#lf-dest").value = short(p.place);
    if (p.dur) dur.v = p.dur;
    $("#lf-read").textContent = !line.value.trim() ? "Or fill in the details below." : !p.start ? "Add a day and time, like “Fri 5pm”." : [p.title, when(p.start.getTime()), short(p.place)].filter(Boolean).join(" · ");
  });
  if ($("#lf-x")) $("#lf-x").addEventListener("click", () => { editing = null; render(); });
  $("#lf").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#lf-err"), v = $("#lf-start").value, start = v ? new Date(v).getTime() : NaN;
    if (!$("#lf-title").value.trim()) { err.textContent = "Give it a title, like “Demo Day”."; return $("#lf-title").focus(); }
    if (!Number.isFinite(start)) { err.textContent = "Pick when it starts."; return $("#lf-start").focus(); }
    if (!editing && start <= Date.now()) { err.textContent = "That time has passed. Pick a later one."; return $("#lf-start").focus(); }
    const btn = e.submitter || $("#lf button[type=submit]"); btn.disabled = true;
    try {
      const was = editing;
      const r = await api("/api/host/launch", { id: was ? was.id : undefined, title: $("#lf-title").value, start, dur: dur.v, tz: TZ, dest: $("#lf-dest").value, count: $("#lf-count").checked });
      S = r; editing = null;
      const made = S.launches.find(l => l.id === r.id);
      note = !was ? "Published. Share " + short(made ? made.url : "") + " anywhere." + (r.told ? " Your " + r.told.toLocaleString("en-US") + (r.told === 1 ? " follower is" : " followers are") + " being told." : "") : r.followed ? "Saved. Everyone who saved it gets the change, and their alerts move with it." : "Saved.";
      render();
    } catch (x) {
      btn.disabled = false;
      if (x.need !== "pro") { err.textContent = x.message; return; }
      // A free limit: say why, offer Pro, and keep what they typed.
      err.innerHTML = '<span class="hp-need"><span>' + esc(x.message) + '</span><button type="button" class="btn small ink" data-upgrade>Get Pro</button></span>';
      err.querySelector("[data-upgrade]").addEventListener("click", upgrade);
    }
  });
}

/* A launch's numbers: the saved count for everyone; saves and who showed up, by day, with Pro. */
function stats(l) {
  const s = S.stats && S.stats[l.id];
  if (!s) return "";
  let out = '<div class="hp-stats"><span><b>' + nf(s.saved) + '</b> saved</span>';
  if (s.days) {
    out += '<span><b>' + nf(s.alerts) + '</b> alerts set, 30 days</span><span><b>' + nf(s.gos) + '</b> showed up</span></div>';
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
    const by = new Map(s.days.map(d => [d.day, d.alerts])), max = Math.max(1, ...days.map(d => by.get(d) || 0));
    if (s.alerts) out += '<div class="hp-bars" role="img" aria-label="Alerts set each day, last 14 days">' + days.map(d => '<i title="' + d + ': ' + (by.get(d) || 0) + '" data-h="' + Math.round((by.get(d) || 0) / max * 100) + '"></i>').join("") + '</div>';
    return out;
  }
  return out + '<span class="hp-meta">Saves by day and who showed up come with Pro.</span></div>';
}

function item(l) {
  const ph = phase(l), chip = ph === "live" ? '<span class="hp-chip live">Live</span>' : ph === "ended" ? '<span class="hp-chip">Ended</span>' : "";
  return '<li class="hp-item"><div><b>' + esc(l.title) + '</b>' + chip + '</div><span class="hp-meta">' + esc(when(l.start)) + (l.dest ? " · " + esc(short(l.dest)) : "") + '</span>' + stats(l) +
    '<div class="hp-row"><a class="btn" href="' + esc(l.url) + '">View</a><button type="button" class="btn" data-copy="' + esc(l.url) + '">Copy link</button>' +
    '<button type="button" class="btn" data-edit="' + esc(l.id) + '">Edit</button><button type="button" class="btn" data-del="' + esc(l.id) + '">' + (ph === "ended" ? (armed === l.id ? "Yes, delete it" : "Delete") : (armed === l.id ? "Yes, cancel it" : "Cancel launch")) + '</button></div></li>';
}

async function del(id) {
  if (armed !== id) { armed = id; render(); setTimeout(() => { if (armed === id) { armed = null; render(); } }, 4000); return; }
  armed = null;
  try { S = await api("/api/host/launch/delete", { id }); note = "Cancelled. Everyone who saved it is told, and its page says so."; } catch (e) { note = e.message; }
  render();
}

async function copy(text, b) {
  try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch (e) { b.textContent = short(text); }
  setTimeout(() => (b.textContent = "Copy link"), 1800);
}

window.addEventListener("rm:account", load);
load();
