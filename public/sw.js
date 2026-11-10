// remmynd service worker.
// 1. Caches the app so it opens offline.
// 2. Shows reminder notifications. Pushes arrive EMPTY; the reminder details come from this
//    device's own storage (IndexedDB), so the server never knows what you're reminded about.
const CACHE = "remmynd-v12";
const SHELL = ["./", "./index.html", "./app.css", "./app.js", "./remmynd.js", "./ring.js", "./db.js", "./push.js", "./fonts/geist-5.3-latin.woff2", "./fonts/geist-mono-5.3-latin.woff2", "./manifest.webmanifest", "./icon.svg", "./favicon.ico", "./apple-touch-icon.png", "./icon-192.png", "./badge-mono-96.png", "./badge.svg", "./badge-dark.svg"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/push/") || url.pathname === "/ics") return;
  if (e.request.mode === "navigate") {
    // Pages: network first so updates show at once. Only the plain shell (/) is cached: a /r/ page
    // carries that reminder's preview tags and is never stored. Offline, every page gets the shell,
    // and the page reads the reminder from its own address.
    const shell = url.pathname === "/" || url.pathname === "/index.html";
    e.respondWith(fetch(e.request).then(res => { if (shell && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); } return res; }).catch(() => caches.match("./index.html")));
    return;
  }
  if (/\.(css|js)$/.test(url.pathname)) {
    // Styles and scripts: network first too, so they never fall out of step with the page.
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; })));
});

/* ---------- on-device storage: db.js, shared with the page ---------- */
importScripts("/db.js");
const DB = self.remmyndDB;
const getAll = () => DB.getAll("alerts");
const put = a => DB.put("alerts", a);
const del = id => DB.del("alerts", id);
const rid = () => { const b = crypto.getRandomValues(new Uint8Array(16)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

/* ---------- notifications ---------- */
const short = u => (u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const timeStr = ms => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
function view(a) {
  const place = a.place ? short(a.place) : "";
  if (a.kind === "before") {
    const mins = Math.max(1, Math.round((a.start - a.at) / 60000));
    const lead = mins >= 60 && mins % 60 === 0 ? (mins / 60) + (mins === 60 ? " hour" : " hours") : mins + " min";
    return { title: a.title + " starts in " + lead, body: timeStr(a.start) + (place ? " · " + place : "") };
  }
  if (a.kind === "after") return { title: a.title + " started at " + timeStr(a.start), body: place ? "Tap to open " + place : "Tap to see the details" };
  if (a.kind === "snooze") return { title: a.title, body: (Date.now() >= a.start ? "Started at " : "Starts at ") + timeStr(a.start) + (place ? " · " + place : "") };
  if (a.kind === "check") return { title: a.title + ": did you make it?", body: "Tap Done, or Not yet to pick another time." };
  if (a.kind === "nudge") return { title: a.title + " has started", body: "Nudge " + (a.n || 1) + " of 3. Tap to open." };
  if (a.kind === "replan") return { title: a.title, body: "You asked to be reminded now. Tap to open." };
  return { title: a.title + " is starting now", body: place ? "Tap to open " + place : "Tap to see the details" };
}
const PLATFORM_HAS_ACTIONS = typeof Notification !== "undefined" && "actions" in Notification.prototype && (Notification.maxActions || 0) > 0;

async function showDue() {
  const now = Date.now();
  const list = await getAll().catch(() => []);
  const due = list.filter(a => !a.shown && a.at <= now + 120e3).sort((a, b) => a.at - b.at);
  if (!due.length) {
    // iPhone requires every push to show something; this only happens if this device's storage was cleared.
    await self.registration.showNotification("remmynd", { body: "You have a reminder. Open remmynd to see it.", icon: "/icon-192.png", badge: "/badge-mono-96.png", tag: "remmynd-generic" });
  }
  for (const a of due) {
    const v = view(a);
    // Check and re-plan alerts ask the question: Done or Not yet. Nudges open the link. iPhone shows no
    // buttons, so a tap opens the ticket, which offers the same choices.
    const asks = a.kind === "check" || a.kind === "replan";
    const opts = {
      body: v.body, icon: "/icon-192.png", badge: "/badge-mono-96.png", tag: a.rkey + ":" + a.kind,
      timestamp: a.start, renotify: true, requireInteraction: a.kind !== "before",
      vibrate: [80, 60, 80, 60, 220],
      data: { id: a.id, rkey: a.rkey, kind: a.kind, share: a.share, url: !asks && a.kind !== "before" && /^https?:\/\//.test(a.place || "") ? a.place : a.share }
    };
    if (PLATFORM_HAS_ACTIONS) opts.actions = asks ? [{ action: "done", title: "Done" }, { action: "notyet", title: "Not yet" }]
      : a.kind === "nudge" ? [{ action: "open", title: "Open" }] : [{ action: "snooze", title: "Snooze 10 min" }, { action: "open", title: "Open" }];
    await self.registration.showNotification(v.title, opts);
    a.shown = true; await put(a);
  }
  // Tidy up: forget reminders that ended more than two days ago.
  for (const a of list) if (a.start < now - 2 * 864e5) await del(a.id);
  await updateBadge();
}

async function updateBadge() {
  if (!self.navigator.setAppBadge) return;
  const now = Date.now(), end = new Date(); end.setHours(23, 59, 59, 999);
  const list = await getAll().catch(() => []);
  const today = new Set(list.filter(a => a.start >= now - 3600e3 && a.start <= end.getTime()).map(a => a.rkey)).size;
  try { today ? await self.navigator.setAppBadge(today) : await self.navigator.clearAppBadge(); } catch (e) {}
}

self.addEventListener("push", e => { e.waitUntil(showDue()); });

async function snooze(data) {
  const list = await getAll();
  const a = list.find(x => x.id === data.id);
  if (!a) return;
  const next = { ...a, id: rid(), at: Date.now() + 10 * 60e3, kind: "snooze", shown: false };
  await put(next);
  const sub = await self.registration.pushManager.getSubscription();
  if (sub) await fetch("/push/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint, pings: [{ id: next.id, at: next.at }] }) }).catch(() => {});
}

/* Forget a reminder's waiting alerts (all, or some kinds), here and on the server. */
async function cancelAlerts(rkey, kinds) {
  const mine = (await getAll().catch(() => [])).filter(a => a.rkey === rkey && !a.shown && (!kinds || kinds.includes(a.kind)));
  for (const a of mine) await del(a.id);
  const sub = mine.length && await self.registration.pushManager.getSubscription().catch(() => null);
  if (sub) await fetch("/push/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint, ids: mine.map(a => a.id) }) }).catch(() => {});
}

/* Update the reminder this device holds (state kept, opened...). */
async function markReminder(rkey, change) {
  const rec = (await DB.getAll("reminders").catch(() => [])).find(r => r.rkey === rkey);
  if (rec) await DB.put("reminders", { ...rec, ...change }).catch(() => {});
}

const withAct = (url, act) => { const u = new URL(url || "/", location.origin); u.searchParams.set("act", act); return u.href; };

async function openUrl(url) {
  const target = new URL(url || "/", location.origin).href;
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const w of wins) if (w.url === target && "focus" in w) return w.focus();
  return self.clients.openWindow(target);
}

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data || {};
  if (e.action === "snooze") { e.waitUntil(snooze(data)); return; }
  // Done: kept, and nothing more is sent for it.
  if (e.action === "done") { e.waitUntil(Promise.all([markReminder(data.rkey, { state: "kept", doneAt: Date.now() }), cancelAlerts(data.rkey)]).then(updateBadge)); return; }
  // Not yet: open the ticket with the re-plan sheet.
  if (e.action === "notyet") { e.waitUntil(openUrl(withAct(data.share, "replan"))); return; }
  // Opening a nudge counts as opening the link: the other nudges stop.
  const opened = data.kind === "nudge" ? Promise.all([markReminder(data.rkey, { openedAt: Date.now() }), cancelAlerts(data.rkey, ["nudge"])]) : null;
  e.waitUntil(Promise.all([openUrl(data.url), updateBadge(), opened]));
});

// If the browser replaces the push address, move this device's pending pings to the new one.
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    let sub = e.newSubscription;
    if (!sub) {
      const r = await fetch("/push/key").then(r => r.json()).catch(() => null);
      if (!r || !r.key) return;
      const raw = Uint8Array.from(atob(r.key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    }
    const now = Date.now();
    const pending = (await getAll()).filter(a => !a.shown && a.at > now);
    for (let i = 0; i < pending.length; i += 8) {
      await fetch("/push/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint, pings: pending.slice(i, i + 8).map(a => ({ id: a.id, at: a.at })) }) }).catch(() => {});
    }
  })());
});
