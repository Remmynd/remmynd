/* remmynd push notifications, on the page.
 * The reminder (title, time, link) is saved on this device only, in IndexedDB.
 * The server gets an anonymous push address, a random id per alert and a time. Nothing else. */
(() => {
  "use strict";
  const RM = window.__rm;
  if (!RM) return;
  const SUPPORTED = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && RM.OWN;
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
  const when = d => d.morningAt ? "At " + esc(RM.fShort(d.morningAt, RM.TZ)) + ", after it starts" : "1 hour before, and at the start";

  async function renderRow(d) {
    const el = d.el;
    if (!el || !el.isConnected) return;
    const start = d.start.getTime();
    if (start <= Date.now() + 30e3) { el.innerHTML = row("It has already started", "", true); return; }
    if (!SUPPORTED || !(await serverKey())) {
      if (RM.IOS && !RM.STANDALONE && RM.OWN) {
        el.innerHTML = row("On iPhone, add remmynd to your Home Screen first", '<button type="button" class="btn small" id="n-install">Add</button>');
        el.querySelector("#n-install").addEventListener("click", () => RM.openSheet());
      } else el.innerHTML = row("Not available in this browser", "", true);
      return;
    }
    const rkey = rkeyOf(d.r.t, start);
    const on = (await getAll()).some(a => a.rkey === rkey && !a.shown);
    if (on) {
      el.innerHTML = row(when(d), '<button type="button" class="s-btn" id="n-off" aria-label="Notifications on. Turn them off">' + ON + '</button>');
      el.querySelector("#n-off").addEventListener("click", async () => { try { await turnOff(rkey); } catch (e) {} renderRow(d); });
    } else if (Notification.permission === "denied") {
      el.innerHTML = row("Blocked in this browser's settings", "", true);
    } else {
      el.innerHTML = row("Not set on this " + DEVICE, '<button type="button" class="btn small" id="n-on">Turn on</button>');
      el.querySelector("#n-on").addEventListener("click", () => remind(d, true));
    }
  }

  /* Remind me: turn notifications on where they are allowed. The permission prompt must start inside
   * the tap itself, so this asks before anything is awaited. */
  function remind(d, loud) {
    if (!SUPPORTED || d.start.getTime() <= Date.now() + 30e3) return renderRow(d).then(() => false);
    const perm = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    return perm.then(async p => {
      if (p !== "granted") { await renderRow(d); return false; }
      const rkey = rkeyOf(d.r.t, d.start.getTime());
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
    try {
      const reg = SUPPORTED && await navigator.serviceWorker.ready;
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await post("/push/cancel", { endpoint: sub.endpoint, ids: mine.map(a => a.id) });
    } catch (e) {}
    refreshBadge();
    return mine.length;
  }

  /* Not yet: drop what's waiting and bring it back once, at the chosen time. */
  async function replan(d, at) {
    const rkey = rkeyOf(d.r.t, d.start.getTime());
    await cancel(rkey);
    if (!SUPPORTED || Notification.permission !== "granted") return false;
    const base = { rkey, title: d.r.t, start: d.start.getTime(), place: d.r.l || "", share: d.share, shown: false };
    return (await schedule([{ ...base, id: rid(), at, kind: "replan" }])).length > 0;
  }

  /* The nudge switch on a held reminder: add or remove the three nudges. */
  async function setNudge(d, on) {
    const rkey = rkeyOf(d.r.t, d.start.getTime());
    if (!on) return cancel(rkey, ["nudge"]);
    if (!SUPPORTED || Notification.permission !== "granted" || d.morningAt) return 0;
    const mine = await getAll();
    if (!mine.some(a => a.rkey === rkey && !a.shown)) return 0; // notifications are off for this one
    if (mine.some(a => a.rkey === rkey && a.kind === "nudge" && !a.shown)) return 0;
    return (await schedule(nudges(d, rkey))).length;
  }

  async function turnOn(d, rkey, loud) {
    const alerts = await schedule(plan(d, rkey));
    if (!alerts.length) throw new Error("past");
    if (loud) RM.toast("You'll get a notification " + (d.morningAt ? "at " + RM.fShort(d.morningAt, RM.TZ) : alerts.length > 1 ? "1 hour before and at the start" : "at the start"));
  }

  async function turnOff(rkey) {
    const mine = (await getAll()).filter(a => a.rkey === rkey);
    if (!mine.length) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await post("/push/cancel", { endpoint: sub.endpoint, ids: mine.map(a => a.id) }).catch(() => {});
    await delMany(mine.map(a => a.id));
    RM.toast("Notifications off for this reminder");
    refreshBadge();
  }

  /* ---------- Coming up (home) ---------- */
  async function renderHome() {
    const box = $("#coming-up");
    if (!box) return;
    const now = Date.now();
    const list = await getAll();
    const old = list.filter(a => a.start < now - 2 * 864e5).map(a => a.id);
    if (old.length) await delMany(old);
    const byKey = new Map();
    for (const a of list) {
      if (a.start < now - 1800e3) continue;
      const g = byKey.get(a.rkey) || { ...a, alerts: 0 };
      if (!a.shown) g.alerts++;
      byKey.set(a.rkey, g);
    }
    const items = [...byKey.values()].sort((a, b) => a.start - b.start).slice(0, 20);
    if (!items.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = '<h2>Coming up</h2><p class="cu-note">Saved on this ' + DEVICE + ' only.</p><div class="cu-list">' + items.map(a => {
      const dt = new Date(a.start);
      const wd = new Intl.DateTimeFormat(undefined, { timeZone: RM.TZ, weekday: "short" }).format(dt).toUpperCase();
      const day = new Intl.DateTimeFormat(undefined, { timeZone: RM.TZ, day: "numeric" }).format(dt);
      return '<a class="cu-item" href="' + esc(a.share) + '"><span class="cu-date"><i>' + esc(wd) + '</i><b>' + esc(day) + '</b></span><span class="cu-main"><b>' + esc(a.title) + '</b><span>' + esc(RM.fShort(dt, RM.TZ)) + '</span></span>' +
        (a.alerts ? '<span class="cu-chip"><span class="dot"></span>Alerts on</span>' : '<span class="cu-chip muted">Sent</span>') + '</a>';
    }).join("") + '</div>';
  }

  /* ---------- Home Screen badge ---------- */
  async function refreshBadge() {
    if (!navigator.setAppBadge || !RM.STANDALONE) return;
    const now = Date.now(), end = new Date(); end.setHours(23, 59, 59, 999);
    const n = new Set((await getAll()).filter(a => a.start >= now - 3600e3 && a.start <= end.getTime()).map(a => a.rkey)).size;
    try { n ? await navigator.setAppBadge(n) : await navigator.clearAppBadge(); } catch (e) {}
  }

  window.__rmPush = { remind, renderRow, cancel, replan, setNudge };
  window.addEventListener("rm:stack", e => renderRow(e.detail));
  window.addEventListener("rm:home", () => renderHome());
  if (window.__rmLast) (window.__rmLast.type === "stack" ? renderRow(window.__rmLast.detail) : window.__rmLast.type === "home" ? renderHome() : null);
  refreshBadge();
})();
