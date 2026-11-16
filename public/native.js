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
  // A change on this site's own API, as the account sheet makes one. Answers what the server said, with ok and status.
  const post = async (path, body) => { try { const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return { ...j, ok: r.ok, status: r.status }; } catch (e) { return { ok: false, status: 0, error: "No connection. Try again." }; } };
  const payload = s => { s = String(s); const i = s.indexOf("/r/"); return i >= 0 ? s.slice(i + 3).split(/[?#/]/)[0] : s.slice(s.indexOf("#") + 1); };
  // A repeat shows the time it comes round now; a one-off its own time.
  const occ = e => { const m = e.durationMinutes * 6e4; return !e.repeat || e.start.getTime() + m > Date.now() ? e.start : R.nextOccurrence(e.start, e.repeat, { after: Date.now() - m, timeZone: e.timeZone || TZ }) || e.start; };
  // The public count: only a shared link whose host turned it on. A private link never reaches the server.
  const counts = (share, e) => !!e.count && !String(share).includes("#");
  const countOf = async (share, e) => { if (!counts(share, e)) return null; try { const r = await fetch("/count/" + payload(share)); return r.ok ? ((await r.json()).n || 0) : 0; } catch (x) { return null; } };
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
        movedFrom: x.movedFrom || null, cancelled: x.cancelled || null,
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
    /* A shared or private reminder link, for the app's Save sheet: what it is, when it comes round now, how many will
     * be reminded (when its host turned the count on), and whether it's already held here. */
    async preview(share) {
      const e = R.decode(String(share || ""));
      if (!e) return { ok: false };
      const rkey = rkeyOf(e.title, e.start), rec = (await all()).find(x => x.rkey === rkey);
      return { ok: true, rkey, title: e.title, start: occ(e).getTime(), dur: e.durationMinutes, place: e.location || "", host: e.host || "", notes: e.notes || "",
        repeat: e.repeat ? R.describeRepeat(e.repeat) : "", counted: counts(share, e), count: await countOf(share, e), held: !!rec && rec.state === "held" };
    },
    /* Remind me, from the Save sheet: held here with its alerts, as Remind me on the page holds it, and counted once
     * on this device when its host turned the count on. */
    async hold(share) {
      share = String(share || "");
      const e = R.decode(share);
      if (!e) return { ok: false, error: "That isn't a remmynd link." };
      const start = occ(e), rkey = rkeyOf(e.title, e.start), have = (await all()).find(x => x.rkey === rkey);
      if (have && have.state === "held") return { ok: true, have: true, rkey };
      if (start.getTime() + e.durationMinutes * 6e4 <= Date.now()) return { ok: false, error: "This one has already ended." };
      let rec = { rkey, title: e.title, start: start.getTime(), dur: e.durationMinutes, place: e.location || "", host: e.host || "", z: e.timeZone || "", share,
        state: "held", nudge: false, cal: null, heldAt: Date.now(), doneAt: null, replanAt: null, rep: e.repeat || "", first: e.start.getTime() };
      await DB().put("reminders", rec);
      if (counts(share, e)) {
        let done = {};
        try { done = JSON.parse(localStorage.getItem("rm:counted") || "{}") || {}; } catch (x) {}
        if (!done[rkey]) try {
          const r = await fetch("/count/" + payload(share), { method: "POST" }), j = r.ok ? await r.json() : null;
          if (j && j.you) { done[rkey] = j.you; localStorage.setItem("rm:counted", JSON.stringify(done)); rec = { ...rec, you: j.you }; await DB().put("reminders", rec); }
        } catch (x) {}
      }
      if (P()) await Promise.resolve(P().remind(ndOf(rec), false)).catch(() => {});
      after(); return { ok: true, rkey };
    },
    /* The links made on this device (shared, not private), from 7 days ago on, with how many will be reminded. */
    async launches() {
      const week = Date.now() - 7 * 864e5;
      const links = (await DB().getAll("links").catch(() => [])).filter(l => !l.private && l.share);
      const out = await Promise.all(links.map(async l => {
        const e = R.decode(l.share);
        if (!e) return null;
        const start = occ(e).getTime();
        if (start + e.durationMinutes * 6e4 < week) return null;
        return { share: l.share, title: l.title || e.title, start, dur: e.durationMinutes, counted: counts(l.share, e), count: await countOf(l.share, e), repeat: e.repeat ? R.describeRepeat(e.repeat) : "" };
      }));
      return out.filter(Boolean).sort((a, b) => a.start - b.start);
    },
    /* remmynd Pro (worker/pro.js). The app buys through Apple and sends what Apple signed; the account's status comes
     * back the same however it was paid, so a website purchase shows in the app and Restore finds either. */
    async pro() { try { const r = await fetch("/api/pro", { credentials: "same-origin" }); return r.ok ? await r.json() : { signedIn: false }; } catch (e) { return null; } },
    /* Follow, in the app: the launches coming up from hosts this phone follows (at.js keeps the handles), and which are
     * new since the app last asked. The app shows them in Today and sets a local "live now" alert for each. */
    async followFeed() {
      let handles = [], seen = [];
      try { handles = JSON.parse(localStorage.getItem("rm:follows") || "[]"); seen = JSON.parse(localStorage.getItem("rm:fseen") || "[]"); } catch (e) {}
      if (!handles.length) return { launches: [], fresh: [] };
      let launches = [];
      try { const r = await fetch("/api/follow/feed?handles=" + handles.map(encodeURIComponent).join(","), { cache: "no-store" }); if (r.ok) launches = (await r.json()).launches || []; } catch (e) { return null; }
      const fresh = launches.filter(l => !seen.includes(l.id)).map(l => l.id);
      try { localStorage.setItem("rm:fseen", JSON.stringify([...new Set([...seen, ...launches.map(l => l.id)])].slice(-300))); } catch (e) {}
      return { launches, fresh };
    },
    async proApple(jws, move, renewal) { return post("/api/pro/apple", { jws, move: !!move, renewal: renewal || undefined }); },
    async proRestore(jws, move, renewal) { return post("/api/pro/restore", jws ? { jws, move: !!move, renewal: renewal || undefined } : {}); },
    /* The full reminder page, for its details, its plan and its call. */
    open(share) { go(share); return true; },
    home() { if (location.pathname !== "/" || location.hash) go("/"); return true; }
  };
  try { window.webkit.messageHandlers.remmynd.postMessage({ type: "ready" }); } catch (e) {}
}
