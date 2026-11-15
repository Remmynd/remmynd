/* remmynd: repeating reminders, loaded only when one is held or finished. A repeating reminder is one record that
 * keeps its first time (`first`, which fixes the weekday and the day of the month) and moves `start` on to each next
 * time. Done keeps a copy for that time, so it counts, and moves the reminder on. Alerts cover the next 7 times,
 * up to 14 days ahead, and are topped up whenever the page opens. Everything stays on this device. */
import { nextOccurrence } from "/remmynd.js";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const DB = () => window.remmyndDB, P = () => window.__rmPush;
const zoneOf = x => x.z || TZ;
const after = (x, t) => nextOccurrence(x.first || x.start, x.rep, { after: t, timeZone: zoneOf(x) });

/* What push.js needs to plan a reminder's alerts. */
export const nd = x => ({ el: null, rkey: x.rkey, r: { t: x.title, d: x.dur || 60, ...(x.place ? { l: x.place } : {}), r: x.rep }, key: null,
  start: new Date(x.start), share: x.share, morningAt: null, first: x.first || x.start, z: zoneOf(x) });

/* The alerts: at the start of each of the next 7 times within 14 days, and the "did you make it?" check after.
 * The last start alert asks to open remmynd, which tops them up. */
export function plan(d, rkey, rid) {
  const out = [], now = Date.now(), end = now + 14 * 864e5, dur = (d.r.d || 60) * 6e4, z = d.z || TZ, first = d.first || d.start.getTime();
  const next = t => { const n = nextOccurrence(first, d.r.r, { after: t, timeZone: z }); return n ? n.getTime() : 0; };
  let t = d.start.getTime();
  if (t + dur <= now) t = next(now);
  for (let i = 0; i < 7 && t && t <= end; i++, t = next(t)) {
    const base = { rkey, title: d.r.t, start: t, place: d.r.l || "", share: d.share, shown: false };
    out.push({ ...base, id: rid(), at: t, kind: "start" }, { ...base, id: rid(), at: t + dur, kind: "check" });
  }
  const starts = out.filter(a => a.kind === "start" && a.at > now);
  if (starts.length > 1) starts[starts.length - 1].last = true;
  return out;
}

async function realert(y) {
  const p = P();
  if (!p) return;
  await p.cancel(y.rkey).catch(() => {});
  if (y.state === "held") await Promise.resolve(p.remind(nd(y), false)).catch(() => {});
}

/* Done for this time: a kept copy for it, and the reminder moves on to its next time. */
export async function done(x) {
  const db = DB(), now = Date.now();
  await db.put("reminders", { ...x, rkey: x.rkey + "@" + Math.round(x.start / 6e4).toString(36), state: "kept", doneAt: now, rep: "", of: x.rkey, replanAt: null });
  const n = after(x, Math.max(now, x.start));
  const y = { ...x, start: n ? n.getTime() : x.start, replanAt: null, state: n ? "held" : "kept", doneAt: n ? null : now };
  await db.put("reminders", y);
  await realert(y);
  return y;
}

/* Not done after all: the copy goes and that time comes back. */
export async function undo(k) {
  const db = DB(), list = await db.getAll("reminders"), c = list.find(r => r.rkey === k), x = c && list.find(r => r.rkey === c.of);
  if (!c) return null;
  await db.del("reminders", k);
  if (!x) return null;
  const y = { ...x, start: c.start, replanAt: null, state: "held", doneAt: null };
  await db.put("reminders", y);
  await realert(y);
  return y;
}

/* On opening: a reminder whose next time has come moves on to it (a missed time stays as missed until then), and
 * alerts that were on are topped up when fewer than 3 times are left. Answers whether anything moved. */
export async function tend() {
  const db = DB(), now = Date.now();
  const [list, alerts] = await Promise.all([db.getAll("reminders").catch(() => []), db.getAll("alerts").catch(() => [])]);
  let moved = false;
  for (let x of list.filter(r => r.rep && r.state === "held")) {
    let n = after(x, x.start), changed = false;
    while (n && n.getTime() <= now) { x = { ...x, start: n.getTime(), replanAt: null }; changed = true; n = after(x, x.start); }
    if (changed) { await db.put("reminders", x); moved = true; }
    const mine = alerts.filter(a => a.rkey === x.rkey);
    const ahead = mine.filter(a => !a.shown && a.kind === "start" && a.at > now).length;
    if (mine.length && ahead < 3 && !(x.replanAt > now)) await realert(x);
  }
  return moved;
}

/* The next times, for the app's morning brief. */
export function upcoming(x, count = 7) {
  const out = [], end = Date.now() + 14 * 864e5;
  for (let t = x.start; t && t <= end && out.length < count; ) { out.push(t); const n = after(x, t); t = n ? n.getTime() : 0; }
  return out;
}
