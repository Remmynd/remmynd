/* Vanishing chat for one reminder (worker/chat.js keeps only scrambled text, and deletes it a day after the end).
 * The secret is the private link itself, or the #k= piece a shared link gets when someone starts a chat. Both stay
 * after the #, which browsers never send. From it this device works out the room id and an AES-GCM key, so the
 * server never sees the key, the words, the names, or which reminder a room belongs to. Loaded only when opened. */
import * as R from "/remmynd.js";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const te = new TextEncoder(), td = new TextDecoder();
const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = { get: k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const KEY = /^[A-Za-z0-9_-]{22}$/, FILE_ID = /^[a-f0-9]{20}$/;
const timed = p => p && p.start && p.tokens.some(t => t.type === "relative" || t.type === "time" && !/^(?:this |in the )?(?:morning|afternoon|evening|night)$/i.test(t.text));
const fWhen = d => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
const fTime = d => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);

/** Room id and key from the link's secret. Exported for the tests. */
export async function derive(secret) {
  const base = await crypto.subtle.digest("SHA-256", te.encode("remmynd-chat\n" + secret));
  const hk = await crypto.subtle.importKey("raw", base, "HKDF", false, ["deriveBits", "deriveKey"]);
  const p = info => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode(info) });
  const room = b64(await crypto.subtle.deriveBits(p("room"), hk, 128));
  const key = await crypto.subtle.deriveKey(p("key"), hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { room, key };
}
export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
export async function unseal(key, s) {
  try { const b = unb64(s); return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12)))); } catch (e) { return null; }
}
/** Photos and voice notes: the same key, raw bytes, a fresh IV in front. */
export async function sealBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
export async function openBytes(key, b) {
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, key, b.slice(12))); } catch (e) { return null; }
}
/** A photo, redrawn on this device: at most 1600 px and about 350 KB. Redrawing drops the location and camera details. */
async function shrink(file) {
  const img = await createImageBitmap(file, { imageOrientation: "from-image" });
  let side = 1600, q = 0.82, blob;
  for (let i = 0; i < 6; i++) {
    const k = Math.min(1, side / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= 350 * 1024) return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
    side = Math.round(side * 0.8); q = Math.max(0.6, q - 0.06);
  }
  throw new Error("That photo is too big to send.");
}
const VOICE = () => typeof MediaRecorder !== "undefined" && ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));

/** The secret and the link to share, for a private link (its own payload) or a shared one (#k=, made when a chat starts). */
export function secretOf(share, priv, hash, saved) {
  const u = new URL(share), path = u.origin + u.pathname;
  if (priv) { const payload = u.hash.slice(1); return { secret: payload, link: path + "?chat=1#" + payload }; }
  const k = (/[#&]k=([A-Za-z0-9_-]{22})/.exec(hash || "") || [])[1] || (KEY.test(saved || "") ? saved : null);
  return k ? { secret: "k:" + k, k, link: path + "?chat=1#k=" + k } : null;
}

const post = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 410) throw Object.assign(new Error("ended"), { ended: true });
  if (!r.ok) throw new Error(j.error || "Couldn't send that. Try again.");
  return j;
};
const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !window.__rmNative;
async function endpoint(ask) {
  if (!canPush) return null;
  const perm = ask && Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (perm !== "granted") return null;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && ask) { const k = await fetch("/push/key").then(r => r.json()); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64(k.key) }); }
  return sub ? sub.endpoint : null;
}
const DB = () => window.remmyndDB;

let current = null;
/** Open the chat for the reminder on screen. c is app.js's S.ctx: { r, start, share }. */
export async function open(c, priv) {
  if (current) current.close();
  const r = c.r, title = r.t || "Reminder", ends = c.start.getTime() + (r.d || 60) * 6e4;
  const pkey = "rm:chatk:" + new URL(c.share).pathname;
  let sk = secretOf(c.share, priv, location.hash, store.get(pkey));

  const el = document.createElement("div");
  el.className = "sheet chat-sheet";
  el.innerHTML = '<div class="sheet-card chat-card" role="dialog" aria-modal="true" aria-labelledby="chat-t">' +
    '<button type="button" class="sheet-x" aria-label="Close">×</button>' +
    '<div class="chat-head"><span class="label">Chat</span><b id="chat-t">' + esc(title) + '</b><span class="chat-when"></span></div>' +
    '<div class="chat-body"></div></div>';
  document.body.appendChild(el);
  if (!document.querySelector('link[href="/chat.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/chat.css"; document.head.appendChild(l); }
  const body = el.querySelector(".chat-body"), when = el.querySelector(".chat-when");
  let timer = 0, closed = false;
  const close = () => { closed = true; clearTimeout(timer); el.dispatchEvent(new Event("remove")); el.remove(); document.removeEventListener("keydown", onKey); if (current && current.el === el) current = null; };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.addEventListener("click", e => { if (e.target === el) close(); });
  el.querySelector(".sheet-x").addEventListener("click", close);
  current = { el, close };
  const NOTE = '<p class="chat-note">Scrambled on your device, so we can\'t read it. It vanishes for everyone 24 hours after the reminder ends. Anyone here can still take a screenshot. <a href="mailto:connect@zoof04.com?subject=Report%20a%20remmynd%20chat">Report</a></p>';

  if (!sk) {
    body.innerHTML = '<p class="chat-intro">Talk it over with the people you share this with. Only people you send the chat link to can read it, and it vanishes a day after the reminder ends.</p>' +
      '<button type="button" class="btn ink chat-start">Start a chat</button>' + NOTE;
    await new Promise(res => body.querySelector(".chat-start").addEventListener("click", res));
    const k = b64(crypto.getRandomValues(new Uint8Array(16)));
    store.set(pkey, k);
    sk = secretOf(c.share, false, "#k=" + k, null);
  }
  const { room, key } = await derive(sk.secret);
  const rkey = "rm:chat:" + room;
  let mine = store.get(rkey) || {};
  if (!mine.me) { mine.me = b64(crypto.getRandomValues(new Uint8Array(12))); store.set(rkey, mine); }
  // The address bar shows the chat link, so copying it from there shares the chat too.
  if (location.pathname === new URL(sk.link).pathname && location.href !== sk.link) { try { history.replaceState(history.state, "", sk.link); } catch (e) {} }
  const api = act => "/api/chat/" + room + "/" + act;
  const seen = new Map();
  let last = 0, watching = false, ended = false;
  const setWhen = t => { when.textContent = ended ? "This chat has ended" : "Vanishes " + fWhen(new Date(t || ends + 864e5)); };
  setWhen();

  const askName = () => new Promise(res => {
    body.innerHTML = '<form class="chat-name"><label for="chat-n">Your name in this chat</label><input id="chat-n" maxlength="40" autocomplete="nickname" required value="' + esc(store.get("rm:chatname") || "") + '"><button class="btn ink">Join the chat</button></form>' + NOTE;
    const f = body.querySelector("form"), i = f.querySelector("input");
    setTimeout(() => i.focus());
    f.addEventListener("submit", e => { e.preventDefault(); const n = i.value.replace(/\s+/g, " ").trim().slice(0, 40); if (!n) return; store.set("rm:chatname", n); res(n); });
  });
  if (!mine.name) { mine.name = store.get("rm:chatname") || await askName(); store.set(rkey, mine); }

  body.innerHTML = '<div class="chat-tools"><button type="button" class="chip" data-a="copy">Copy chat link</button>' +
    (canPush ? '<button type="button" class="chip" data-a="alerts" aria-pressed="false">Alerts off</button>' : '') +
    '<button type="button" class="chip" data-a="leave">Leave</button><button type="button" class="chip warn" data-a="end">End for everyone</button></div>' +
    '<ol class="chat-list" aria-live="polite"><li class="chat-empty">No messages yet. Say something, then send the chat link.</li></ol>' +
    '<form class="chat-form"><label class="chat-ic" title="Send a photo"><input type="file" accept="image/*" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3.2"/></svg><span class="vh">Send a photo</span></label>' +
    (VOICE() && navigator.mediaDevices ? '<button type="button" class="chat-ic chat-mic" aria-label="Record a voice note"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>' : '') +
    '<input maxlength="500" placeholder="Message" aria-label="Message" autocomplete="off" enterkeyhint="send"><button class="btn ink" aria-label="Send">Send</button></form>' + NOTE;
  const list = body.querySelector(".chat-list"), form = body.querySelector(".chat-form"), input = form.querySelector('input[maxlength]');
  const urls = [];
  const blobUrl = (bytes, type) => { const u = URL.createObjectURL(new Blob([bytes], { type })); urls.push(u); return u; };
  el.addEventListener("remove", () => urls.forEach(u => URL.revokeObjectURL(u)));
  const say = t => { const p = body.querySelector(".chat-err") || form.insertAdjacentElement("afterend", Object.assign(document.createElement("p"), { className: "chat-err", role: "alert" })); p.textContent = t || ""; p.hidden = !t; };
  const alertsBtn = body.querySelector('[data-a="alerts"]');
  const showAlerts = () => { if (alertsBtn) { alertsBtn.setAttribute("aria-pressed", String(watching)); alertsBtn.textContent = watching ? "Alerts on" : "Alerts off"; } };
  const end = () => {
    ended = true; clearTimeout(timer); setWhen();
    list.innerHTML = '<li class="chat-empty">This chat has ended. Every message in it was deleted, for everyone.</li>';
    body.querySelector(".chat-tools").hidden = true; form.hidden = true;
    DB() && DB().del("chats", room).catch(() => {}); store.set(rkey, null);
  };

  function add(m) {
    if (seen.has(m.id)) return;
    seen.set(m.id, 1);
    last = Math.max(last, m.at);
    const e = list.querySelector(".chat-empty"); if (e) e.remove();
    const li = document.createElement("li"), me = m.me === mine.me;
    li.className = "chat-msg" + (me ? " me" : "");
    if (!m.v) { li.innerHTML = '<span class="chat-bad">A message that couldn\'t be read.</span>'; list.appendChild(li); return; }
    const t = String(m.v.t || ""), f = m.v.f && FILE_ID.test(m.v.f.id || "") ? m.v.f : null, p = t ? R.parse(t, { timeZone: TZ }) : null;
    li.innerHTML = (me ? "" : '<span class="chat-who">' + esc(m.v.n || "Someone") + '</span>') +
      (f ? '<div class="chat-file' + (f.k === "voice" ? " voice" : "") + '"><span class="chat-loading">' + (f.k === "voice" ? "Voice note" : "Photo") + '…</span></div>' : '') +
      (t ? '<p>' + esc(t) + '</p>' : '') + '<span class="chat-at">' + fTime(new Date(m.at)) + '</span>' +
      (timed(p) && new Date(p.start) > new Date() ? '<button type="button" class="chip chat-remind">Remind me ' + esc(fWhen(new Date(p.start))) + '</button>' : "");
    if (f) { const box = li.querySelector(".chat-file"); if (f.k === "img" && f.w > 0 && f.h > 0) box.style.aspectRatio = (+f.w) + " / " + (+f.h); showFile(box, f, m.bytes); }
    const b = li.querySelector(".chat-remind");
    if (b) b.addEventListener("click", () => { location.assign(R.createLink({ title: p.title || t.slice(0, 80), start: new Date(p.start), timeZone: TZ }, { base: location.origin + "/" })); });
    list.appendChild(li);
    li.scrollIntoView({ block: "end" });
  }
  async function showFile(box, f, mine) {
    try {
      let bytes = mine;
      if (!bytes) {
        const r = await fetch(api("file") + "/" + f.id, { cache: "no-store" });
        if (!r.ok) throw new Error();
        bytes = await openBytes(key, new Uint8Array(await r.arrayBuffer()));
        if (!bytes) throw new Error();
      }
      if (f.k === "voice") {
        const a = document.createElement("audio");
        a.controls = true; a.preload = "metadata"; a.src = blobUrl(bytes, /^audio\/[a-z0-9.;=+ -]+$/i.test(f.mime || "") ? f.mime : "audio/mp4");
        box.replaceChildren(a);
        if (f.d) { const d = document.createElement("span"); d.className = "chat-dur"; d.textContent = Math.round(f.d) + "s"; box.appendChild(d); }
      } else {
        const i = document.createElement("img");
        i.alt = "Photo"; i.src = blobUrl(bytes, "image/jpeg"); i.decoding = "async";
        box.replaceChildren(i);
      }
    } catch (e) { box.innerHTML = '<span class="chat-bad">This ' + (f.k === "voice" ? "voice note" : "photo") + " couldn't be opened.</span>"; }
  }
  /** Scramble, upload, then send the message that points at it. Uploading needs a signed-in account (worker/chat.js). */
  async function sendFile(bytes, meta) {
    say("");
    const sealed = await sealBytes(key, bytes);
    const r = await fetch(api("file") + "?me=" + encodeURIComponent(mine.me), { method: "POST", headers: { "content-type": "application/octet-stream" }, body: sealed });
    const j = await r.json().catch(() => ({}));
    if (r.status === 410) return end();
    if (j.need === "signin") {
      say("Sign in to send photos and voice notes. Reading stays open to everyone with the link.");
      const p = body.querySelector(".chat-err"), sb = document.createElement("button");
      sb.type = "button"; sb.className = "chip"; sb.textContent = "Sign in"; p.append(" ", sb);
      sb.addEventListener("click", () => import("/account.js").then(a => a.open()).catch(() => {}));
      return;
    }
    if (j.need === "pro") {
      // The free plan's daily photos and voice notes (worker/pro.js FREE.chatFiles): say so, and where Pro is.
      say(j.error);
      const p = body.querySelector(".chat-err"), a = document.createElement("a");
      a.className = "chip"; a.href = "/pricing"; a.textContent = "See Pro"; p.append(" ", a);
      return;
    }
    if (!r.ok) {
      if (j.error === "Say something first.") return say("Say hello first, then send photos and voice notes.");
      return say(j.error || "Couldn't send that. Try again.");
    }
    const ep = await endpoint(false).catch(() => null);
    const v = { n: mine.name, t: "", f: { id: j.id, ...meta } };
    const m = await post(api("post"), { body: await seal(key, v), me: mine.me, ends, ...(ep ? { endpoint: ep } : {}) });
    add({ id: m.id, me: mine.me, at: m.at, v, bytes });
  }
  const pick = form.querySelector('input[type="file"]');
  pick.addEventListener("change", async () => {
    const file = pick.files && pick.files[0]; pick.value = "";
    if (!file || ended) return;
    if (!/^image\//.test(file.type)) return say("That isn't a photo.");
    try { const s = await shrink(file); await sendFile(s.bytes, { k: "img", w: s.w, h: s.h }); }
    catch (x) { if (x.ended) end(); else say(x.message || "Couldn't send that photo."); }
  });
  const mic = form.querySelector(".chat-mic");
  let rec = null;
  if (mic) mic.addEventListener("click", async () => {
    if (ended) return;
    if (rec) { rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (x) { return say("Allow the microphone for remmynd to record a voice note."); }
    const type = VOICE(), chunks = [], started = Date.now();
    let cancelled = false;
    rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32000 });
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const bar = document.createElement("div");
    bar.className = "chat-rec"; bar.setAttribute("role", "status");
    bar.innerHTML = '<span class="chat-dot" aria-hidden="true"></span><span class="chat-rt">0:00</span><span class="chat-rh">Recording. Tap the mic to send.</span><button type="button" class="chip">Cancel</button>';
    form.before(bar);
    mic.classList.add("on"); mic.setAttribute("aria-label", "Stop and send the voice note");
    const tick = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); bar.querySelector(".chat-rt").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }, 250);
    const cap = setTimeout(() => rec && rec.stop(), 60000);
    bar.querySelector("button").addEventListener("click", () => { cancelled = true; rec.stop(); });
    rec.onstop = async () => {
      clearInterval(tick); clearTimeout(cap); stream.getTracks().forEach(t => t.stop());
      bar.remove(); mic.classList.remove("on"); mic.setAttribute("aria-label", "Record a voice note"); rec = null;
      const d = (Date.now() - started) / 1000;
      if (cancelled || d < 0.8 || closed) return;
      const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
      try { await sendFile(bytes, { k: "voice", mime: type, d: Math.min(60, d) }); } catch (x) { if (x.ended) end(); else say(x.message || "Couldn't send that voice note."); }
    };
    rec.start(1000);
  });

  async function read() {
    if (closed || ended) return;
    try {
      const j = await post(api("read"), { since: Math.max(0, last - 5000) });
      if (j.ends) setWhen(j.ends);
      for (const m of j.msgs) add({ ...m, v: await unseal(key, m.body) });
    } catch (e) { if (e.ended) return end(); }
    if (!closed && !ended) timer = setTimeout(read, document.hidden ? 15000 : 4000);
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const t = input.value.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!t || ended) return;
    const b = form.querySelector("button"); b.disabled = true; say("");
    try {
      const ep = await endpoint(false).catch(() => null);
      const j = await post(api("post"), { body: await seal(key, { n: mine.name, t }), me: mine.me, ends, ...(ep ? { endpoint: ep } : {}) });
      if (ep && !watching) { watching = true; showAlerts(); DB() && DB().put("chats", { room, title, url: sk.link }).catch(() => {}); }
      input.value = "";
      add({ id: j.id, me: mine.me, at: j.at, v: { n: mine.name, t } });
      if (j.ends) setWhen(j.ends);
    } catch (x) { if (x.ended) end(); else say(x.message); }
    finally { b.disabled = ended; input.focus(); }
  });
  body.querySelector(".chat-tools").addEventListener("click", async e => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    const act = a.dataset.a;
    if (act === "copy") {
      try { if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title, url: sk.link }); else { await navigator.clipboard.writeText(sk.link); a.textContent = "Copied"; setTimeout(() => a.textContent = "Copy chat link", 1600); } } catch (x) {}
    } else if (act === "alerts") {
      try {
        const ep = watching ? null : await endpoint(true);
        if (!watching && !ep) return say("Turn on notifications for remmynd in this browser to get alerts.");
        await post(api("watch"), { me: mine.me, on: !watching, endpoint: ep });
        watching = !watching; showAlerts(); say("");
        if (DB()) watching ? DB().put("chats", { room, title, url: sk.link }).catch(() => {}) : DB().del("chats", room).catch(() => {});
      } catch (x) { if (x.ended) end(); else say(x.message === "There's nothing in this chat yet." ? "Say something first, then turn on alerts." : x.message); }
    } else if (act === "leave") {
      post(api("watch"), { me: mine.me, on: false }).catch(() => {});
      DB() && DB().del("chats", room).catch(() => {});
      store.set(rkey, null); close();
    } else if (act === "end") {
      if (!confirm("End this chat for everyone? Every message is deleted now, for everyone, and can't be brought back.")) return;
      try { await post(api("end"), {}); } catch (x) {}
      end();
    }
  });
  if (DB()) DB().getAll("chats").then(cs => { watching = cs.some(x => x.room === room); showAlerts(); }).catch(() => {});
  setTimeout(() => input.focus());
  read();
}
