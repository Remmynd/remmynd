/* remmynd follow: reminders saved from a host's launch follow its changes (worker/hosts.js). Page and service worker. */
(function (g) {
  "use strict";
  const DAY = 864e5;
  async function check({ move, drop, now = Date.now() } = {}) {
    const DB = g.remmyndDB;
    if (!DB) return [];
    const recs = (await DB.getAll("reminders").catch(() => [])).filter(r => r.launch && r.state === "held" && r.start + (r.dur || 60) * 60e3 > now - DAY);
    if (!recs.length) return [];
    let got;
    try {
      const res = await fetch("/api/launch?ids=" + [...new Set(recs.map(r => r.launch))].slice(0, 50).join(","), { credentials: "omit", cache: "no-store" });
      if (!res.ok) return [];
      got = (await res.json()).launches || {};
    } catch (e) { return []; }
    const changes = [];
    for (const r of recs) {
      const l = got[r.launch];
      if (!l) continue;
      if (l.cancelled) {
        await DB.put("reminders", { ...r, state: "dropped", cancelled: l.at || now }).catch(() => {});
        if (drop) await Promise.resolve(drop(r)).catch(() => {});
        changes.push({ kind: "cancelled", title: r.title, rkey: r.rkey });
        continue;
      }
      if (l.start === r.start && l.title === r.title && (l.dur || 60) === (r.dur || 60) && (l.dest || "") === (r.place || "")) continue;
      const next = { ...r, title: l.title, start: l.start, dur: l.dur, place: l.dest || "", share: l.link || r.share, ver: l.ver,
        movedFrom: l.start !== r.start ? (r.movedFrom || r.start) : r.movedFrom, first: l.start };
      await DB.put("reminders", next).catch(() => {});
      if (move) await Promise.resolve(move(next, l.start - r.start)).catch(() => {});
      changes.push({ kind: l.start !== r.start ? "moved" : "changed", title: l.title, start: l.start, was: r.start, rkey: r.rkey, share: next.share });
    }
    return changes;
  }

  function words(c) {
    if (c.kind === "cancelled") return { title: "Cancelled: " + c.title, body: "The host cancelled it. Its alerts are off." };
    const when = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(c.start));
    return c.kind === "moved" ? { title: "Moved: " + c.title, body: "Now " + when + ". Your alerts moved with it." } : { title: "Updated: " + c.title, body: "The host changed the details. Still " + when + "." };
  }

  g.remmyndFollow = { check, words };
})(typeof self !== "undefined" ? self : this);
