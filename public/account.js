// remmynd account: optional sign-in (a passkey, or a 6-digit code by email), sync across devices
// and email reminders. Loaded only when someone opens sign-in, or on a device that is signed in.
// Private links (/#…) never leave the device, signed in or not.
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FLAG = "rm:acct", SNAP = "rm:sync";
const PASSKEYS = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const RM = () => window.__rm || {};
const toast = m => RM().toast ? RM().toast(m) : null;
let ME = null, view = "signin", pendingEmail = "", lastSync = 0, deleteArmed = false;
let PRO = null, proAsked = false;

/* ---------- talking to the server (same origin only) ---------- */
async function api(path, body) {
  const init = body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const setFlag = on => { try { if (on) localStorage.setItem(FLAG, "1"); else { localStorage.removeItem(FLAG); localStorage.removeItem(SNAP); } } catch (e) {} };
const announce = () => window.dispatchEvent(new CustomEvent("rm:account", { detail: ME && ME.signedIn ? { signedIn: true, email: ME.email, emailAlerts: ME.emailAlerts } : { signedIn: false } }));
function deviceName() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "This device";
}

/* ---------- the sheet ---------- */
function ensureSheet() {
  if (!$('link[href="/account.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/account.css"; document.head.append(l); }
  if ($("#acct")) return;
  const s = document.createElement("div");
  s.className = "sheet"; s.id = "acct"; s.hidden = true;
  s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true"); s.setAttribute("aria-labelledby", "ac-t");
  s.innerHTML = '<div class="sheet-card ac-card"><button type="button" class="sheet-x" id="ac-x" aria-label="Close">×</button><div id="ac-body"></div></div>';
  document.body.append(s);
  $("#ac-x").addEventListener("click", close);
  s.addEventListener("click", e => { if (e.target === s) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !s.hidden) close(); });
}
function close() { const s = $("#acct"); if (s) s.hidden = true; deleteArmed = false; }
const KEY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M14 9l2 2"/></svg>';
const day = t => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function render() {
  const b = $("#ac-body");
  if (view === "signin") {
    b.innerHTML = '<h2 id="ac-t">Sign in to remmynd</h2><p class="rp-sub">Keep your reminders on every device, and get them by email too. No password.</p>' +
      (PASSKEYS ? '<button type="button" class="btn ink ac-wide" id="ac-pk">' + KEY + 'Continue with a passkey</button><div class="ac-or"><span>or</span></div>' : '') +
      '<form id="ac-email" class="ac-form" novalidate><label class="ac-field"><span>Email</span><input type="email" id="ac-e" autocomplete="email" inputmode="email" required placeholder="you@example.com" value="' + esc(pendingEmail) + '"></label>' +
      '<button type="submit" class="btn ac-wide">Email me a code</button></form>' +
      '<p class="ac-fine">We keep your email address and your reminders so they sync and can be emailed to you. Private links stay on this device. Delete it all any time. <a href="/privacy">Privacy</a></p>';
    if (PASSKEYS) $("#ac-pk").addEventListener("click", passkeySignIn);
    $("#ac-email").addEventListener("submit", e => { e.preventDefault(); sendCode(); });
  } else if (view === "code") {
    b.innerHTML = '<h2 id="ac-t">Check your email</h2><p class="rp-sub">We sent a 6-digit code to <b>' + esc(pendingEmail) + '</b>. It works for 10 minutes.</p>' +
      '<form id="ac-code" class="ac-form" novalidate><input id="ac-c" class="ac-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" aria-label="6-digit code" placeholder="000000">' +
      '<button type="submit" class="btn ink ac-wide">Sign in</button></form><button type="button" class="linkish" id="ac-back">Use another email</button>';
    $("#ac-code").addEventListener("submit", e => { e.preventDefault(); checkCode(); });
    $("#ac-c").addEventListener("input", e => { if (e.target.value.replace(/\D/g, "").length === 6) checkCode(); });
    $("#ac-back").addEventListener("click", () => { view = "signin"; render(); });
    $("#ac-c").focus();
  } else if (view === "welcome") {
    b.innerHTML = '<h2 id="ac-t">You\'re signed in</h2><p class="rp-sub">Your reminders now sync to <b>' + esc(ME.email) + '</b>, and you\'ll get them by email.</p>' +
      '<div class="ac-offer"><b>Sign in faster next time</b><span>Add a passkey: Face ID, Touch ID or your screen lock. Nothing to remember.</span><button type="button" class="btn ink ac-wide" id="ac-add">' + KEY + 'Add a passkey</button></div>' +
      '<button type="button" class="linkish" id="ac-done">Not now</button>';
    $("#ac-add").addEventListener("click", addPasskey);
    $("#ac-done").addEventListener("click", () => { view = "account"; render(); });
  } else {
    const keys = ME.passkeys || [];
    b.innerHTML = '<h2 id="ac-t">Your account</h2><p class="rp-sub ac-email">' + esc(ME.email) + '</p>' +
      '<label class="opt-row"><span class="opt-text"><b id="ac-ml">Email reminders</b><span id="ac-md">1 hour before and when it starts, for the reminders you hold.</span></span>' +
      '<span class="switch"><input type="checkbox" id="ac-mail" role="switch" aria-labelledby="ac-ml" aria-describedby="ac-md"' + (ME.emailAlerts ? " checked" : "") + '><span></span></span></label>' +
      '<div class="label">Passkeys</div><div class="ac-keys">' + (keys.length ? keys.map(k => '<div class="ac-key">' + KEY + '<span><b>' + esc(k.name) + '</b><i>Added ' + esc(day(k.created)) + '</i></span><button type="button" class="btn small" data-key="' + esc(k.id) + '">Remove</button></div>').join("") : '<p class="ac-none">No passkey yet. You sign in with a code by email.</p>') + '</div>' +
      (PASSKEYS ? '<button type="button" class="btn ac-wide" id="ac-add">' + KEY + 'Add a passkey</button>' : '') +
      proBlock() +
      '<div class="label">Your page</div><p class="ac-none">A public page for your launches, with a countdown and a button that goes live on time.</p><a class="btn ac-wide" href="/host">Open your page</a>' +
      '<div class="label">Your calendar</div><p class="ac-none">Subscribe in Apple, Google or Outlook Calendar: the reminders you hold show there, repeats included.</p>' +
      feedRow("cal", "Get my calendar address") +
      '<div class="label">Email in</div><p class="ac-none">Forward a booking or an invite to your own address and it becomes a reminder.</p>' +
      feedRow("in", "Get my email address") +
      '<p class="ac-fine" id="ac-sync">' + (lastSync ? "Synced " + new Date(lastSync).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + "." : "Syncing…") + ' Private links stay on this device.</p>' +
      '<div class="ac-row"><button type="button" class="btn" id="ac-out">Sign out</button><button type="button" class="btn ac-danger" id="ac-del">' + (deleteArmed ? "Tap again to delete everything" : "Delete account") + '</button></div>' +
      (deleteArmed && PRO && PRO.pro && PRO.source === "apple" ? '<p class="ac-fine">You have Pro through Apple. Deleting the account doesn\'t stop Apple\'s billing: cancel it first in your iPhone\'s Settings, under your name, then Subscriptions.</p>' : '') +
      (deleteArmed && PRO && PRO.pro && PRO.source === "polar" ? '<p class="ac-fine">Your Pro ends with the account, and nothing more is billed.</p>' : '');
    $("#ac-mail").addEventListener("change", async e => { try { ME = await api("/api/account/settings", { emailAlerts: e.target.checked }); announce(); toast(ME.emailAlerts ? "Email reminders on" : "Email reminders off"); } catch (err) { e.target.checked = !e.target.checked; toast(err.message); } });
    b.querySelectorAll("[data-key]").forEach(x => x.addEventListener("click", async () => { try { ME = await api("/api/passkeys/delete", { id: x.dataset.key }); render(); toast("Passkey removed"); } catch (err) { toast(err.message); } }));
    if (PASSKEYS) $("#ac-add").addEventListener("click", addPasskey);
    b.querySelectorAll("[data-feed]").forEach(x => x.addEventListener("click", () => feed(x.dataset.feed, x.dataset.act)));
    b.querySelectorAll("[data-pro]").forEach(x => x.addEventListener("click", () => proAct(x.dataset.pro, x)));
    if (!proAsked) { proAsked = true; loadPro().then(() => { if (view === "account" && !$("#acct").hidden) render(); }); }
    $("#ac-out").addEventListener("click", signOut);
    $("#ac-del").addEventListener("click", deleteAccount);
  }
}

/* ---------- remmynd Pro (worker/pro.js) ----------
 * Pro is one status on the account, however it was paid: here through Polar, or in the iPhone app through Apple.
 * Inside the app this sheet never sells it (the app's own Settings does, through Apple); it only says where it stands. */
const IN_APP = !!window.__rmNative;
async function loadPro() { try { PRO = await api("/api/pro"); } catch (e) { PRO = null; } return PRO; }
function proBlock() {
  const p = PRO;
  if (!p || !p.signedIn || (!p.pro && !p.offer)) return "";
  const head = '<div class="label">Pro</div>';
  if (p.pro) {
    const via = p.source === "apple" ? "Paid through Apple" : "Paid on the website";
    const line = (p.trial ? "Free trial. " : "") + (p.renews ? "Renews " : "Ends ") + day(p.until) + ". " + via + ".";
    return head + '<p class="ac-none"><b>Pro is on.</b> ' + esc(line) + '</p><div class="ac-row">' +
      (p.source === "polar" && !IN_APP ? '<button type="button" class="btn small" data-pro="manage">Manage or cancel</button>' : '') +
      '<button type="button" class="btn small" data-pro="restore">Refresh</button></div>' +
      (p.source === "apple" ? '<p class="ac-fine">Manage or cancel it in your iPhone\'s Settings, under your name, then Subscriptions.</p>' : '');
  }
  if (IN_APP) return head + '<p class="ac-none">Get Pro in the app\'s Settings tab. Paid already? It shows here once you\'re signed in.</p><div class="ac-row"><button type="button" class="btn small" data-pro="restore">Restore</button></div>';
  if (!p.web) return "";
  const trial = p.trialOpen ? p.trialDays + " days free, then " : "", e = p.early;
  // The early bird (worker/pro.js earlyBird): half price to start, until its end.
  const price = e ? '<b>Early bird, 50% off until ' + esc(day(e.until)) + '.</b> ' + esc(e.yearly + " for your first year or " + e.monthly + " a month for " + e.months + " months, then " + p.plans.yearly.price + " a year or " + p.plans.monthly.price + " a month." + (p.trialOpen ? " The first " + p.trialDays + " days cost nothing." : ""))
    : esc((trial ? trial.charAt(0).toUpperCase() + trial.slice(1) : "") + p.plans.monthly.price + " a month or " + p.plans.yearly.price + " a year.");
  return head + '<p class="ac-none">For people who run launches. ' + price + ' Cancel any time.</p>' +
    '<div class="ac-row"><button type="button" class="btn ink" data-pro="yearly">Yearly · ' + esc(e ? e.yearly : p.plans.yearly.price) + '</button><button type="button" class="btn" data-pro="monthly">Monthly · ' + esc(e ? e.monthly : p.plans.monthly.price) + '</button></div>' +
    '<p class="ac-fine">Paid already, here or in the iPhone app? <button type="button" class="ac-link" data-pro="restore">Restore it</button>. Payment is handled by Polar.</p>';
}
async function proAct(what, button) {
  button.disabled = true;
  try {
    if (what === "monthly" || what === "yearly") { const r = await api("/api/pro/checkout", { plan: what }); location.assign(r.url); return; }
    if (what === "manage") { const r = await api("/api/pro/portal", {}); location.assign(r.url); return; }
    const was = !!(PRO && PRO.pro);
    PRO = await api("/api/pro/restore", {});
    render();
    toast(PRO.pro ? (was ? "Pro is on" : "Pro is on. Restored.") : "No Pro purchase was found for this account.");
  } catch (e) { toast(e.message); button.disabled = false; if (/already have Pro/.test(e.message)) { await loadPro(); render(); } }
}
/* Back from Polar's checkout (/?pro=done): ask Polar now, so Pro shows at once even if its notice is still on its way. */
export async function proDone() {
  await open();
  if (!ME || !ME.signedIn) return;
  for (let i = 0; i < 4; i++) {
    try { PRO = await api("/api/pro/restore", {}); } catch (e) {}
    if (PRO && PRO.pro) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  proAsked = true; render();
  toast(PRO && PRO.pro ? "Pro is on. Thank you." : "The payment is still going through. Tap Restore in a minute.");
}

/* ---------- the calendar feed and the email-in address (worker/feed.js) ----------
 * Each is shown once, when it's made: the server keeps only a hash. Making it again replaces the old one. */
const FEEDS = {};
function feedRow(kind, label) {
  const a = FEEDS[kind];
  if (!a) return '<button type="button" class="btn ac-wide" data-feed="' + kind + '" data-act="get">' + label + '</button>';
  return '<p class="ac-addr"><code>' + esc(a) + '</code></p><div class="ac-row"><button type="button" class="btn small" data-feed="' + kind + '" data-act="copy">Copy</button>' +
    (kind === "cal" ? '<a class="btn small" href="' + esc(a) + '">Subscribe</a>' : '') +
    '<button type="button" class="btn small" data-feed="' + kind + '" data-act="reset">New address</button><button type="button" class="btn small" data-feed="' + kind + '" data-act="off">Turn off</button></div>' +
    '<p class="ac-fine">Keep it private: anyone with it ' + (kind === "cal" ? "can see the reminders you hold" : "can add reminders to your account") + '. It\'s shown only now; New address replaces it.</p>';
}
async function feed(kind, act) {
  if (act === "copy") { try { await navigator.clipboard.writeText(FEEDS[kind]); toast("Copied"); } catch (e) { toast("Select it and copy"); } return; }
  try {
    const r = await api(act === "off" ? "/api/feeds/off" : act === "reset" ? "/api/feeds/reset" : "/api/feeds", { kind });
    FEEDS[kind] = r.address || null;
    render();
    toast(act === "off" ? "Turned off" : act === "reset" ? "New address. The old one stopped working." : "Here it is");
  } catch (e) { toast(e.message); }
}

/* ---------- signing in ---------- */
async function sendCode() {
  const email = ($("#ac-e").value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Enter your email address"); return $("#ac-e").focus(); }
  pendingEmail = email;
  try {
    const r = await api("/api/auth/email/start", { email });
    view = "code"; render();
    if (r.devCode) { $("#ac-c").value = r.devCode; toast("Local test server: the code is filled in"); }
  } catch (err) { toast(err.message); }
}
async function checkCode() {
  const code = ($("#ac-c").value || "").replace(/\D/g, "");
  if (code.length !== 6) return toast("Enter the 6-digit code");
  try { ME = await api("/api/auth/email/verify", { email: pendingEmail, code }); signedInNow(); }
  catch (err) { toast(err.message); }
}
async function passkeySignIn() {
  try {
    const o = await api("/api/auth/passkey/options", {});
    const cred = await navigator.credentials.get({ publicKey: { ...o.publicKey, challenge: unb64(o.publicKey.challenge) } });
    const r = cred.response;
    ME = await api("/api/auth/passkey/verify", { challengeId: o.challengeId, id: cred.id, clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature) });
    signedInNow();
  } catch (err) { if (err && err.name !== "NotAllowedError") toast(err.message || "The passkey didn't work. Try a code by email."); }
}
async function addPasskey() {
  try {
    const o = await api("/api/passkeys/options", {}), p = o.publicKey;
    const cred = await navigator.credentials.create({ publicKey: { ...p, challenge: unb64(p.challenge), user: { ...p.user, id: unb64(p.user.id) }, excludeCredentials: p.excludeCredentials.map(c => ({ ...c, id: unb64(c.id) })) } });
    const r = cred.response, spki = r.getPublicKey && r.getPublicKey();
    if (!spki) return toast("This browser can't add a passkey here yet. You can still sign in by email.");
    ME = await api("/api/passkeys/add", { challengeId: o.challengeId, id: cred.id, clientDataJSON: b64(r.clientDataJSON), publicKey: b64(spki), alg: r.getPublicKeyAlgorithm(), name: deviceName() });
    view = "account"; render(); toast("Passkey added. Next time, sign in with one tap.");
  } catch (err) { if (err && err.name !== "NotAllowedError") toast(err.message || "The passkey couldn't be added."); }
}
function signedInNow() {
  PRO = null; proAsked = false; // another account, another Pro status
  setFlag(true); announce(); watch();
  view = PASSKEYS && !(ME.passkeys || []).length ? "welcome" : "account"; render();
  toast(ME.isNew ? "Welcome. Your reminders will sync now." : "Signed in");
  sync();
}
async function signOut() {
  try { await api("/api/auth/signout", {}); } catch (e) {}
  ME = { signedIn: false }; PRO = null; proAsked = false; setFlag(false); announce(); view = "signin"; close(); toast("Signed out. Your reminders stay on this device.");
}
async function deleteAccount() {
  if (!deleteArmed) { deleteArmed = true; return render(); }
  try { await api("/api/account/delete", {}); ME = { signedIn: false }; PRO = null; proAsked = false; setFlag(false); announce(); view = "signin"; close(); toast("Account deleted. Reminders on this device stay here."); }
  catch (err) { toast(err.message); }
}

/* ---------- sync: local reminders and links <-> the account ---------- */
// What was last synced is remembered as a small hash per item, so only changes travel.
const hashOf = o => { const s = JSON.stringify(o); let x = 5381; for (let i = 0; i < s.length; i++) x = (x * 33) ^ s.charCodeAt(i); return (x >>> 0).toString(36); };
const isPrivate = share => String(share || "").includes("/#");
const loadSnap = () => { try { const v = JSON.parse(localStorage.getItem(SNAP)); if (v && typeof v.since === "number" && v.h) return v; } catch (e) {} return { since: 0, h: {} }; };
const saveSnap = v => { try { localStorage.setItem(SNAP, JSON.stringify(v)); } catch (e) {} };
let running = null, again = false, raw = null;
export function sync() {
  if (running) { again = true; return running; }
  running = syncOnce().catch(() => {}).finally(() => { running = null; if (again) { again = false; sync(); } });
  return running;
}
async function syncOnce() {
  const DB = window.remmyndDB;
  if (!DB || !ME || !ME.signedIn) return;
  const io = raw || DB, snap = loadSnap();
  const [recs, links] = await Promise.all([io.getAll("reminders"), io.getAll("links")]);
  const local = new Map();
  for (const r of recs) if (!isPrivate(r.share)) local.set("reminder:" + r.rkey, { kind: "reminder", key: r.rkey, data: { ...r, tz: TZ } });
  for (const l of links) if (!isPrivate(l.share)) local.set("link:" + l.share, { kind: "link", key: l.share, data: l });
  const now = Date.now(), out = [];
  for (const [k, x] of local) { const h = hashOf(x.data); if (snap.h[k] !== h) out.push({ ...x, updated: now, k, h }); }
  for (const k of Object.keys(snap.h)) if (!local.has(k)) { const i = k.indexOf(":"); out.push({ kind: k.slice(0, i), key: k.slice(i + 1), deleted: true, updated: now, k }); }
  const res = await api("/api/sync", { since: snap.since, items: out.map(({ k, h, ...x }) => x) });
  for (const x of out) { if (x.deleted) delete snap.h[x.k]; else snap.h[x.k] = x.h; }
  let changed = false;
  for (const it of res.items) {
    const k = it.kind + ":" + it.key, store = it.kind === "reminder" ? "reminders" : "links";
    if (it.deleted) { if (local.has(k) && !out.some(x => x.k === k && !x.deleted)) { await io.del(store, it.key); changed = true; } delete snap.h[k]; continue; }
    const data = { ...it.data }; delete data.tz;
    const h = hashOf(it.kind === "reminder" ? { ...data, tz: TZ } : data);
    if (snap.h[k] === h) continue; // our own change, back from the server
    await io.put(store, data); snap.h[k] = h; changed = true;
  }
  snap.since = res.now; saveSnap(snap); lastSync = Date.now();
  const s = $("#ac-sync"); if (s) s.textContent = "Synced just now. Private links stay on this device.";
  if (changed && RM().refresh) RM().refresh();
}

// Sync after local changes to reminders or links, when the page comes back, and every 2 minutes.
let watching = false, soon = 0;
function watch() {
  if (watching || !window.remmyndDB) return;
  watching = true;
  const DB = window.remmyndDB;
  raw = { getAll: DB.getAll.bind(DB), put: DB.put.bind(DB), del: DB.del.bind(DB) };
  const later = () => { clearTimeout(soon); soon = setTimeout(sync, 800); };
  for (const m of ["put", "del"]) { const f = DB[m].bind(DB); DB[m] = (store, ...a) => { const p = f(store, ...a); if (store === "reminders" || store === "links") p.then(later, () => {}); return p; }; }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
  setInterval(() => { if (document.visibilityState === "visible") sync(); }, 120e3);
}

/* ---------- entry points ---------- */
export async function boot() {
  try { ME = await api("/api/me"); } catch (e) { return; }
  setFlag(ME.signedIn); announce();
  if (ME.signedIn) { watch(); sync(); }
}
export async function open() {
  ensureSheet();
  if (!ME) { try { ME = await api("/api/me"); } catch (e) { ME = { signedIn: false }; } }
  view = ME.signedIn ? "account" : "signin"; render();
  $("#acct").hidden = false;
  const first = $("#ac-body button, #ac-body input"); if (first) first.focus();
}
export const state = () => ME;
