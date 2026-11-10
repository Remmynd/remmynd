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

  /* ---------- the Notify me row on a reminder ---------- */
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  async function renderRow(d) {
    const el = d.el;
    if (!el || !el.isConnected) return;
    const start = d.start.getTime();
    if (start <= Date.now() + 30e3) { el.innerHTML = ""; return; }

    if (!SUPPORTED || !(await serverKey())) {
      if (RM.IOS && !RM.STANDALONE && RM.OWN && (await serverKey())) {
        el.innerHTML = '<div class="notify"><div class="nrow">' + BELL + '<div class="ntext"><b>Get a notification on this iPhone</b><span>Add remmynd to your Home Screen first</span></div><button type="button" class="btn small" id="n-install">Add</button></div></div>';
        el.querySelector("#n-install").addEventListener("click", () => RM.openSheet());
      } else el.innerHTML = "";
      return;
    }

    const rkey = rkeyOf(d.r.t, start);
    const mine = (await getAll()).filter(a => a.rkey === rkey && !a.shown);
    const on = mine.length > 0;
    el.innerHTML =
      '<div class="notify"><div class="nrow">' + BELL +
      '<div class="ntext"><b>Notify me on this ' + DEVICE + '</b><span>' + (on ? "On · " : "") + (d.morningAt ? "At " + esc(RM.fShort(d.morningAt, RM.TZ)) + ", after it starts" : "1 hour before and when it starts") + '</span></div>' +
      '<label class="switch"><input type="checkbox" id="n-toggle"' + (on ? " checked" : "") + ' aria-label="Notify me on this ' + DEVICE + '"><span></span></label></div>' +
      (on ? '<div class="nchips">' + mine.sort((a, b) => a.at - b.at).map(a => '<span>' + esc(RM.fShort(new Date(a.at), RM.TZ)) + ' · ' + (a.kind === "before" ? "1 hour before" : a.kind === "start" ? "starts" : a.kind === "after" ? "morning" : "snoozed") + '</span>').join("") + '</div>' : "") +
      '</div>';
    const t = el.querySelector("#n-toggle");
    t.addEventListener("change", async () => {
      t.disabled = true;
      try { t.checked ? await turnOn(d, rkey) : await turnOff(rkey); }
      catch (e) { t.checked = !t.checked; RM.toast(e && e.message === "denied" ? "Notifications are blocked for remmynd. Turn them on in your settings." : "Couldn't change notifications. Try again."); }
      renderRow(d);
    });
  }

  async function turnOn(d, rkey) {
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") throw new Error("denied");
    const sub = await subscription();
    const start = d.start.getTime(), now = Date.now();
    const base = { rkey, title: d.r.t, start, place: d.r.l || "", share: d.share, shown: false };
    const alerts = (d.morningAt
      ? [{ ...base, id: rid(), at: d.morningAt.getTime(), kind: "after" }]
      : [{ ...base, id: rid(), at: start - 3600e3, kind: "before" }, { ...base, id: rid(), at: start, kind: "start" }]
    ).filter(a => a.at > now + 30e3);
    if (!alerts.length) throw new Error("past");
    await putMany(alerts);
    try { await post("/push/schedule", { endpoint: sub.endpoint, pings: alerts.map(a => ({ id: a.id, at: a.at })) }); }
    catch (e) { await delMany(alerts.map(a => a.id)); throw e; }
    RM.toast("You'll get a notification " + (d.morningAt ? "at " + RM.fShort(d.morningAt, RM.TZ) : alerts.length > 1 ? "1 hour before and when it starts" : "when it starts"));
    refreshBadge();
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

  window.addEventListener("rm:ticket", e => renderRow(e.detail));
  window.addEventListener("rm:home", () => renderHome());
  if (window.__rmLast) (window.__rmLast.type === "ticket" ? renderRow(window.__rmLast.detail) : renderHome());
  refreshBadge();
})();
