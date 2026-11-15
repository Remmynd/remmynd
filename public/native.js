/* remmynd for iPhone only: the calls its native Today screen uses. app.js loads this file only inside the app
 * (window.__rmNative), so the web never downloads it. The app shows the list, the capture bar and the swipes
 * natively; the reminders stay in this page's storage, on this device, with the same alerts. */
export function boot({ R, TZ, holdImported, rkeyOf, replanOptions, unfloat, go, PEND, refresh }) {
  const DB = () => window.remmyndDB, P = () => window.__rmPush;
  const ndOf = x => ({ el: null, rkey: x.rkey, r: { t: x.title, ...(x.dur ? { d: x.dur } : {}), ...(x.place ? { l: x.place } : {}), ...(x.rep ? { r: x.rep } : {}) },
    key: null, start: new Date(x.start), share: x.share, morningAt: null, first: x.first || x.start, z: x.z || TZ });
  const all = () => DB().getAll("reminders").catch(() => []);
  const find = async k => (await all()).find(x => x.rkey === k);
  const repeats = () => import("/repeat.js");
  const after = () => { try { refresh(); } catch (e) {} };
  window.__rmApp = {
    /* Every reminder held on this phone, with the ids of the alerts still waiting, and for a repeat its rule in
     * words and its next times. Repeats whose next time has come move on first. */
    async list() {
      let recs = await all();
      if (recs.some(x => x.rep && x.state === "held")) { const m = await repeats(); if (await m.tend()) recs = await all(); }
      const alerts = await DB().getAll("alerts").catch(() => []);
      const m = recs.some(x => x.rep) ? await repeats() : null;
      return recs.filter(x => !PEND.has("r:" + x.rkey)).map(x => ({ rkey: x.rkey, title: x.title || "", start: x.start, dur: x.dur || 60, place: x.place || "", share: x.share || "",
        state: x.state || "held", replanAt: x.replanAt || null, doneAt: x.doneAt || null, rep: x.rep || "", repeat: x.rep ? R.describeRepeat(x.rep) : "", of: x.of || "",
        upcoming: m && x.rep && x.state === "held" ? m.upcoming(x) : [],
        alerts: alerts.filter(a => a.rkey === x.rkey && !a.shown).map(a => a.id) }));
    },
    /* The capture bar's preview, read by the same parser as the website's. */
    parse(text) { const p = R.parse(String(text || ""), { timeZone: TZ }); return { title: p.title || "", start: p.start ? p.start.getTime() : null, dur: p.dur || null, place: p.place || "", repeat: p.repeat ? R.describeRepeat(p.repeat) : "" }; },
    /* Typed or said: held at once, with its alerts, as an imported event is. */
    async add(text) {
      const p = R.parse(String(text || ""), { timeZone: TZ });
      if (!p.title) return { ok: false, error: "Type what to remember." };
      if (!p.start) return { ok: false, error: "Add a time, like “at 5pm” or “tomorrow 9am”." };
      if (p.start.getTime() <= Date.now() + 30e3) return { ok: false, error: "That time has passed. Pick a later one." };
      const r = await holdImported({ title: p.title, start: p.start, dur: p.dur || null, place: p.place || "", rep: p.repeat || "" });
      if (r === "have") return { ok: false, error: "You already have this one." };
      if (!r) return { ok: false, error: "Couldn't save it. Try again." };
      after(); return { ok: true, rkey: rkeyOf(p.title, p.start) };
    },
    /* Done. A repeat is kept for this time and moves on; the answer says when it's back. */
    async done(k) {
      const x = await find(k);
      if (!x) return { ok: false };
      unfloat(k);
      if (x.rep) { const y = await (await repeats()).done(x); after(); return { ok: true, next: y.state === "held" ? y.start : null }; }
      await DB().put("reminders", { ...x, state: "kept", doneAt: Date.now() });
      if (P()) await P().cancel(k).catch(() => {});
      after(); return { ok: true };
    },
    /* Undo a Done: held again, with fresh alerts for whatever is still ahead. A repeat's time comes back. */
    async undone(k) {
      const x = await find(k);
      if (!x) return { ok: false };
      if (x.of) { await (await repeats()).undo(k); after(); return { ok: true }; }
      const y = { ...x, state: "held", doneAt: null };
      await DB().put("reminders", y);
      if (P()) { if (y.replanAt > Date.now()) await P().replan(ndOf(y), y.replanAt).catch(() => {}); else await Promise.resolve(P().remind(ndOf(y), false)).catch(() => {}); }
      after(); return { ok: true };
    },
    /* Not yet: the same choices as the re-plan sheet, and the same single alert at the new time. */
    laterOptions() { return replanOptions(new Date(), TZ).map(o => ({ label: o.label, at: o.at })); },
    async later(k, at) {
      const x = await find(k);
      if (!x || !(at > Date.now())) return { ok: false };
      unfloat(k, 1);
      await DB().put("reminders", { ...x, state: "held", replanAt: at });
      const ok = P() ? await P().replan(ndOf(x), at).catch(() => false) : false;
      after(); return { ok: true, alerts: !!ok };
    },
    async remove(k) { unfloat(k); await DB().del("reminders", k).catch(() => {}); if (P()) await P().cancel(k).catch(() => {}); after(); return { ok: true }; },
    /* The full reminder page, for its details, its plan and its call. */
    open(share) { go(share); return true; },
    home() { if (location.pathname !== "/" || location.hash) go("/"); return true; }
  };
  try { window.webkit.messageHandlers.remmynd.postMessage({ type: "ready" }); } catch (e) {}
}
