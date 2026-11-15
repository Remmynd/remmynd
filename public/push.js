/* remmynd push notifications, on the page.
 * The reminder (title, time, link) is saved on this device only, in IndexedDB.
 * The server gets an anonymous push address, a random id per alert and a time. Nothing else. */
(() => {
  "use strict";
  const RM = window.__rm;
  if (!RM) return;
  /* ---------- inside remmynd for iPhone: alerts are the phone's own notifications, through a bridge ----------
   * The app sets window.__rmNative before any script runs and listens on webkit.messageHandlers.remmynd. Each
   * message carries a request id; the app answers with window.__rmNativeReply(id, result). No server, no push
   * address: the alerts, with their words, go straight to the phone. */
  const NATIVE = window.__rmNative && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.remmynd ? window.webkit.messageHandlers.remmynd : null;
  const SUPPORTED = !!NATIVE || ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window && RM.OWN);
  const waits = new Map(); let nperm = "default";
  window.__rmNativeReply = (req, result) => { const w = waits.get(req); if (w) { waits.delete(req); w(result || {}); } };
  const native = (type, payload = {}, wait = 15000) => new Promise(ok => { const req = rid(); waits.set(req, ok); try { NATIVE.postMessage({ type, req, ...payload }); } catch (e) { waits.delete(req); return ok({ ok: false }); } setTimeout(() => { if (waits.has(req)) { waits.delete(req); ok({ ok: false }); } }, wait); });
  const permission = () => (NATIVE ? nperm : Notification.permission);
  // In the app, the phone's own answer: instant once decided, and no time limit while the person reads the prompt.
  const askPermission = () => (NATIVE ? native("permission", { ask: true }, 6e5).then(r => (nperm = r.status || nperm)) : Notification.requestPermission());
  /* The alert's words, the same as sw.js shows on the web. */
  const timeStr = t => RM.fShort(new Date(t), RM.TZ);
  const short = u => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  function words(a) {
    const place = a.place ? short(a.place) : "";
    if (a.kind === "before") return { title: a.title + " starts in 1 hour", body: timeStr(a.start) + (place ? " · " + place : "") };
    if (a.kind === "after") return { title: a.title + " started at " + timeStr(a.start), body: place ? "Tap to open " + place : "Tap to see the details" };
    if (a.kind === "check") return { title: a.title + ": did you make it?", body: "Tap Done, or Not yet to pick another time." };
    if (a.kind === "nudge") return { title: a.title + " has started", body: "Nudge " + (a.n || 1) + " of 3. Tap to open." };
    if (a.kind === "replan") return { title: a.title, body: "You asked to be reminded now. Tap to open." };
    if (a.last) return { title: a.title + " is starting now", body: "Open remmynd to keep this repeating reminder coming." };
    return { title: a.title + " is starting now", body: place ? "Tap to open " + place : "Tap to see the details" };
  }
  const MOBILE = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const DEVICE = MOBILE ? "phone" : "computer";
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- on-device storage: db.js, shared with sw.js ---------- */
  const DB = window.remmyndDB;
  const getAll = () => (DB ? DB.getAll("alerts") : Promise.reject(new Error("no storage"))).catch(() => []);
  const putMany = list => DB.putMany("alerts", list);
  const delMany = ids => DB.delMany("alerts", ids);
  const rid = () => { const b = crypto.getRandomValues(new Uint8Array(16)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const hash = s => { let h = 5381; for (const c of s) h = (h * 33) ^ c.charCodeAt(0); return (h >>> 0).toString(36); };
  const rkeyOf = (title, start) => Math.round(start / 6e4).toString(36) + "-" + hash(title);
  // A repeating reminder keeps the key of its first time; app.js passes it.
  const keyOf = d => d.rkey || rkeyOf(d.r.t, d.start.getTime());

  /* ---------- server ---------- */
  let keyPromise = null;
  const serverKey = () => keyPromise || (keyPromise = fetch("/push/key").then(r => r.ok ? r.json() : null).then(j => j && j.key).catch(() => null));
  const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const keyBytes = k => Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

  async function subscription() {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = await serverKey();
      if (!key) throw new Error("no-key");
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    }
    return sub;
  }

  /* ---------- the Notification row in a reminder's stack ---------- */
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const ON = '<svg class="s-on" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const row = (sub, end, muted) => '<div class="srow' + (muted ? " muted" : "") + '">' + BELL + '<span class="stext"><b>Notification</b><span>' + sub + '</span></span>' + (end || "") + '</div>';
  const when = d => d.r && d.r.r ? "At the start, each time" : d.morningAt ? "At " + esc(RM.fShort(d.morningAt, RM.TZ)) + ", after it starts" : "1 hour before, and at the start";

  async function renderRow(d) {
    const el = d.el;
    if (!el || !el.isConnected) return;
    const start = d.start.getTime();
    if (start <= Date.now() + 30e3) { el.innerHTML = row("It has already started", "", true); return; }
    if (!SUPPORTED || (!NATIVE && !(await serverKey()))) {
      if (RM.IOS && !RM.STANDALONE && RM.OWN) {
        el.innerHTML = row("On iPhone, add remmynd to your Home Screen first", '<button type="button" class="btn small" id="n-install">Add</button>');
        el.querySelector("#n-install").addEventListener("click", () => RM.openSheet());
      } else el.innerHTML = row("Not available in this browser", "", true);
      return;
    }
    const rkey = keyOf(d);
    const on = (await getAll()).some(a => a.rkey === rkey && !a.shown);
    if (on) {
      el.innerHTML = row(when(d), '<span class="s-ends"><button type="button" class="btn small" id="n-test">Test</button><button type="button" class="s-btn" id="n-off" aria-label="Notifications on. Turn them off">' + ON + '</button></span>');
      el.querySelector("#n-off").addEventListener("click", async () => { try { await turnOff(rkey); } catch (e) {} renderRow(d); });
      // A test alert now, shown by this device itself, so you can see and hear how a reminder arrives.
      el.querySelector("#n-test").addEventListener("click", async () => {
        if (NATIVE) { await native("test", { title: d.r.t, share: d.share }); return RM.toast("Test sent. It arrives in a few seconds."); }
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(d.r.t, { body: "Test alert. This is how remmynd will remind you.", icon: "/icon-192.png", badge: "/badge-mono-96.png", tag: "rm-test", data: { url: d.share } });
          RM.toast("Test sent. Check your notifications.");
        } catch (e) { RM.toast("This browser didn't show the test"); }
      });
    } else if (permission() === "denied") {
      el.innerHTML = row(NATIVE ? "Turned off for remmynd in Settings" : "Blocked in this browser's settings", "", true);
    } else {
      el.innerHTML = row("Not set on this " + DEVICE, '<button type="button" class="btn small" id="n-on">Turn on</button>');
      el.querySelector("#n-on").addEventListener("click", () => remind(d, true));
    }
  }

  /* Remind me: turn notifications on where they are allowed. The permission prompt must start inside
   * the tap itself, so this asks before anything is awaited. */
  function remind(d, loud) {
    if (!SUPPORTED || (!(d.r && d.r.r) && d.start.getTime() <= Date.now() + 30e3)) return renderRow(d).then(() => false);
    // In the app, always ask the phone: an answer cached on this page can be out of date (allowed late, or in Settings).
    const perm = NATIVE || permission() === "default" ? askPermission() : Promise.resolve(permission());
    return perm.then(async p => {
      if (p !== "granted") { await renderRow(d); return false; }
      const rkey = keyOf(d);
      if (!(await getAll()).some(a => a.rkey === rkey && !a.shown)) await turnOn(d, rkey, loud);
      await renderRow(d);
      return true;
    }).catch(async () => { if (loud) RM.toast("Couldn't turn on notifications. Try again."); await renderRow(d); return false; });
  }

  /* The alerts for a held reminder: 1 hour before and at the start; one check when it ends (start plus
   * its length, or 30 minutes if the link has none) asking "did you make it?"; and, with the nudge
   * switch on, nudges 10, 20 and 30 minutes after the start. Overnight (sleep-safe) it's one morning alert. */
  function plan(d, rkey) {
    const start = d.start.getTime(), base = { rkey, title: d.r.t, start, place: d.r.l || "", share: d.share, shown: false };
    if (d.morningAt) return [{ ...base, id: rid(), at: d.morningAt.getTime(), kind: "after" }];
    const list = [{ ...base, id: rid(), at: start - 3600e3, kind: "before" }, { ...base, id: rid(), at: start, kind: "start" },
      { ...base, id: rid(), at: start + (d.r.d || 30) * 60e3, kind: "check" }];
    if (d.nudge) list.push(...nudges(d, rkey));
    return list;
  }
  const nudges = (d, rkey) => [1, 2, 3].map(n => ({ rkey, title: d.r.t, start: d.start.getTime(), place: d.r.l || "", share: d.share, shown: false, id: rid(), at: d.start.getTime() + n * 600e3, kind: "nudge", n }));

  // Store alerts on this device and send their ids and times (nothing else) to be pinged then.
  async function schedule(alerts) {
    const now = Date.now();
    alerts = alerts.filter(a => a.at > now + 30e3);
    if (!alerts.length) return [];
    if (NATIVE) {
      await putMany(alerts);
      const r = await native("schedule", { alerts: alerts.map(a => ({ id: a.id, at: a.at, kind: a.kind, share: a.share, ...words(a) })) });
      if (!r.ok) { await delMany(alerts.map(a => a.id)); throw new Error("native"); }
      refreshBadge();
      return alerts;
    }
    const sub = await subscription();
    await putMany(alerts);
    try { await post("/push/schedule", { endpoint: sub.endpoint, pings: alerts.map(a => ({ id: a.id, at: a.at })) }); }
    catch (e) { await delMany(alerts.map(a => a.id)); throw e; }
    refreshBadge();
    return alerts;
  }

  /* Forget alerts still waiting for a reminder (all, or some kinds), here and on the server. */
  async function cancel(rkey, kinds) {
    const mine = (await getAll()).filter(a => a.rkey === rkey && !a.shown && (!kinds || kinds.includes(a.kind)));
    if (!mine.length) return 0;
    await delMany(mine.map(a => a.id));
    if (NATIVE) await native("cancel", { ids: mine.map(a => a.id) });
    else try {
      const reg = SUPPORTED && await navigator.serviceWorker.ready;
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await post("/push/cancel", { endpoint: sub.endpoint, ids: mine.map(a => a.id) });
    } catch (e) {}
    refreshBadge();
    return mine.length;
  }

  /* Not yet: drop what's waiting and bring it back once, at the chosen time. */
  async function replan(d, at) {
    const rkey = keyOf(d);
    await cancel(rkey);
    if (!SUPPORTED || permission() !== "granted") return false;
    const base = { rkey, title: d.r.t, start: d.start.getTime(), place: d.r.l || "", share: d.share, shown: false };
    return (await schedule([{ ...base, id: rid(), at, kind: "replan" }])).length > 0;
  }

  /* The nudge switch on a held reminder: add or remove the three nudges. */
  async function setNudge(d, on) {
    const rkey = rkeyOf(d.r.t, d.start.getTime());
    if (!on) return cancel(rkey, ["nudge"]);
    if (!SUPPORTED || permission() !== "granted" || d.morningAt) return 0;
    const mine = await getAll();
    if (!mine.some(a => a.rkey === rkey && !a.shown)) return 0; // notifications are off for this one
    if (mine.some(a => a.rkey === rkey && a.kind === "nudge" && !a.shown)) return 0;
    return (await schedule(nudges(d, rkey))).length;
  }

  async function turnOn(d, rkey, loud) {
    const alerts = await schedule(d.r && d.r.r ? (await import("/repeat.js")).plan(d, rkey, rid) : plan(d, rkey));
    if (!alerts.length) throw new Error("past");
    if (loud) RM.toast("You'll get a notification " + (d.morningAt ? "at " + RM.fShort(d.morningAt, RM.TZ) : alerts.length > 1 ? "1 hour before and at the start" : "at the start"));
  }

  async function turnOff(rkey) {
    const mine = (await getAll()).filter(a => a.rkey === rkey);
    if (!mine.length) return;
    if (NATIVE) await native("cancel", { ids: mine.map(a => a.id) });
    else {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await post("/push/cancel", { endpoint: sub.endpoint, ids: mine.map(a => a.id) }).catch(() => {});
    }
    await delMany(mine.map(a => a.id));
    RM.toast("Notifications off for this reminder");
    refreshBadge();
  }

  /* ---------- Home Screen badge ---------- */
  async function refreshBadge() {
    if (!NATIVE && (!navigator.setAppBadge || !RM.STANDALONE)) return;
    const now = Date.now(), end = new Date(); end.setHours(23, 59, 59, 999);
    const n = new Set((await getAll()).filter(a => a.start >= now - 3600e3 && a.start <= end.getTime()).map(a => a.rkey)).size;
    if (NATIVE) {
      native("badge", { n });
      // The widget: the next reminder held on this phone.
      const recs = DB ? await DB.getAll("reminders").catch(() => []) : [];
      const at = x => x.replanAt || x.start;
      const up = recs.filter(x => x.state === "held" && at(x) + (x.dur || 60) * 6e4 > now).sort((a, b) => at(a) - at(b))[0];
      native("next", up ? { title: up.title, start: at(up), share: up.share, dur: up.dur || 60 } : { none: true });
      return;
    }
    try { n ? await navigator.setAppBadge(n) : await navigator.clearAppBadge(); } catch (e) {}
  }

  window.__rmPush = { remind, renderRow, cancel, replan, setNudge, native: !!NATIVE, ask: NATIVE ? native : null };
  if (NATIVE) native("permission", { ask: false }).then(r => { nperm = r.status || "default"; });
  window.addEventListener("rm:stack", e => renderRow(e.detail));
  if (window.__rmLast && window.__rmLast.type === "stack") renderRow(window.__rmLast.detail);
  refreshBadge();
  // Repeats: on opening, one whose next time has come moves on to it, and its alerts are topped up (repeat.js).
  if (DB) DB.getAll("reminders").then(rs => rs.some(x => x.rep && x.state === "held") && import("/repeat.js").then(m => m.tend()).then(moved => { if (moved && RM.refresh) RM.refresh(); refreshBadge(); })).catch(() => {});
})();
