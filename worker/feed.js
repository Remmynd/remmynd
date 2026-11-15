// Two ways in and out for a signed-in account, each behind one random address that only its owner knows.
//
// The calendar feed: GET /cal/<token>.ics is a calendar Apple, Google and Outlook subscribe to. It holds the account's
// held reminders (shared links only; private ones never leave the device) and the next 60 days' times of each, with
// repeats as repeating events in local time. Calendars fetch it every few hours, so it follows what you hold.
//
// Email in: mail sent to in-<token>@remmynd.space (Cloudflare Email Routing, a catch-all to this Worker) becomes a
// reminder in that account. The subject is read like the capture bar, and where the subject has no time the first
// lines of the body are; nothing of the email is stored or logged, only the reminder made from it. A reply says
// what was made, or why nothing was.
//
// Account routes (JSON, signed in, same site only):
//   POST /api/feeds              { kind: "cal" | "in" }   the address, made on first ask
//   POST /api/feeds/reset        { kind }                 a new address; the old one stops working at once
//   POST /api/feeds/off          { kind }                 no address at all
// Tokens are 32 random characters, kept here only as a SHA-256 hash, like sessions.
import { createLink, decode, parse, describeRepeat, repeatRRule, nextOccurrence, describeWhen } from "../lib/remmynd.js";
import { b64url, randomId } from "./webauthn.js";
import { d1Store, signedIn, resendMailer, mailsFor } from "./account.js";

const enc = new TextEncoder();
const hash = async s => b64url(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const KINDS = new Set(["cal", "in"]);
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const DAY = 864e5;

export const feedAddress = (origin, kind, token) => kind === "cal" ? origin.replace(/^https?:/, "webcal:") + "/cal/" + token + ".ics" : "in-" + token.toLowerCase() + "@" + new URL(origin).hostname;

/* ---------- account routes ---------- */
export async function handleFeeds(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Sign-in isn't set up on this server." }, 503);
  const store = deps.store || d1Store(env.DB), now = deps.now || Date.now();
  await store.ready();
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
  const s = await signedIn(request, store, now);
  if (!s) return json({ error: "Sign in first." }, 401);
  let body = {};
  try { body = await request.json(); } catch {}
  const kind = body && KINDS.has(body.kind) ? body.kind : null;
  if (!kind) return json({ error: "Ask for cal or in." }, 400);
  const path = url.pathname;
  if (path === "/api/feeds/off") { await store.deleteFeed(s.user.id, kind); return json({ ok: true, address: null }); }
  if (path !== "/api/feeds" && path !== "/api/feeds/reset") return json({ error: "Not found." }, 404);
  // A token is shown once, when it's made: only its hash is kept. Asking again for an address that exists makes a new one.
  // In email addresses the token is lower case, so it's made from lower-case letters and digits only.
  const token = kind === "in" ? randomLower(32) : randomId(32).slice(0, 32);
  await store.setFeed(s.user.id, kind, await hash(token), now);
  return json({ ok: true, address: feedAddress(url.origin, kind, token), made: path === "/api/feeds/reset" ? "new" : "first" });
}
const randomLower = n => { const a = new Uint8Array(n), abc = "abcdefghijklmnopqrstuvwxyz0123456789"; crypto.getRandomValues(a); return [...a].map(x => abc[x % 36]).join(""); };

/* ---------- the calendar feed ---------- */
const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(l) { const out = []; let cur = "", n = 0; for (const ch of l) { const b = enc.encode(ch).length; if (n + b > 73) { out.push(cur); cur = " "; n = 1; } cur += ch; n += b; } out.push(cur); return out.join("\r\n"); }
function localStamp(d, zone) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d)) p[x.type] = x.value;
  return p.year + p.month + p.day + "T" + p.hour + p.minute + "00";
}

/** The calendar for a list of reminders as sync stores them. Pure, so it's tested. */
export function calendar(recs, { now = Date.now(), name = "remmynd" } = {}) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//zoof04//remmynd feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(name), "X-PUBLISHED-TTL:PT3H", "REFRESH-INTERVAL;VALUE=DURATION:PT3H"];
  for (const d of recs) {
    if (!d || d.state !== "held" || !d.share || String(d.share).includes("#")) continue;
    const dur = Math.min(Math.max(+d.dur || 60, 1), 1440) * 60e3, zone = d.z || d.tz || "UTC";
    const first = new Date(d.first || d.start), at = new Date(d.replanAt > now ? d.replanAt : d.start);
    if (!d.rep && at.getTime() + dur < now - 7 * DAY) continue;
    const ev = ["BEGIN:VEVENT", "UID:rm-" + String(d.rkey).replace(/[^\w-]/g, "") + "@remmynd.space", "DTSTAMP:" + stamp(new Date(now)), "SUMMARY:" + esc(d.title || "Reminder")];
    if (d.rep && repeatRRule(d.rep)) ev.push("DTSTART;TZID=" + zone + ":" + localStamp(first, zone), "DTEND;TZID=" + zone + ":" + localStamp(new Date(first.getTime() + dur), zone), "RRULE:" + repeatRRule(d.rep));
    else ev.push("DTSTART:" + stamp(at), "DTEND:" + stamp(new Date(at.getTime() + dur)));
    if (d.place) ev.push("LOCATION:" + esc(d.place));
    ev.push("URL:" + d.share, "DESCRIPTION:" + esc((d.rep ? describeRepeat(d.rep) + ". " : "") + "Reminder link: " + d.share),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(d.title || "Reminder"), "TRIGGER:-PT60M", "END:VALARM", "END:VEVENT");
    L.push(...ev);
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

export async function calendarResponse(request, env, url, deps = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const m = /^\/cal\/([A-Za-z0-9_-]{32})\.ics$/.exec(url.pathname);
  const gone = () => new Response("This calendar address isn't in use. Get the current one in your remmynd account.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (!m || (!env.DB && !deps.store)) return gone();
  const store = deps.store || d1Store(env.DB);
  await store.ready();
  const f = await store.feedByToken("cal", await hash(m[1]));
  if (!f) return gone();
  const recs = (await store.reminders(f.user_id)).map(r => { try { return JSON.parse(r.data); } catch { return null; } });
  const body = calendar(recs, { now: deps.now || Date.now() });
  return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=900", "x-robots-tag": "noindex" } });
}

/* ---------- email in ---------- */
/** The text to read from an email: the subject, then the first lines of the plain body, without quotes and signatures. */
export function emailText(raw) {
  const head = raw.split(/\r?\n\r?\n/)[0] || "", bodyAt = raw.search(/\r?\n\r?\n/);
  const subject = decodeHeader((/^subject:\s*((?:.*)(?:\r?\n[ \t].*)*)/im.exec(head) || [])[1] || "").replace(/^\s*(?:fwd?|fw|re)\s*:\s*/gi, "").trim();
  let body = bodyAt >= 0 ? raw.slice(bodyAt).trim() : "";
  // A multipart email: the first text/plain part.
  const boundary = (/boundary="?([^";\r\n]+)"?/i.exec(head) || [])[1];
  if (boundary) {
    const part = body.split("--" + boundary).find(p => /content-type:\s*text\/plain/i.test(p));
    body = part ? part.split(/\r?\n\r?\n/).slice(1).join("\n\n") : "";
    if (part && /content-transfer-encoding:\s*quoted-printable/i.test(part)) body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith(">") && !/^(--|__)\s*$/.test(l) && !/^(on .* wrote:|sent from my|get outlook)/i.test(l));
  return { subject, lines: lines.slice(0, 40) };
}
function decodeHeader(s) {
  return s.replace(/\r?\n[ \t]+/g, " ").replace(/=\?utf-8\?(b|q)\?([^?]*)\?=/gi, (_, k, v) => {
    try {
      const bytes = k.toLowerCase() === "b" ? Uint8Array.from(atob(v), c => c.charCodeAt(0)) : enc.encode(v.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))));
      return new TextDecoder().decode(bytes);
    } catch { return v; }
  });
}

/** What reminder an email makes: the subject read like the capture bar; where it has no time, the subject's words with the first body line that does. */
export function reminderFromEmail(raw, { now = new Date(), timeZone = "UTC" } = {}) {
  const { subject, lines } = emailText(raw);
  let p = parse(subject, { now, timeZone });
  if (!p.start) {
    for (const l of lines) {
      const q = parse(l, { now, timeZone });
      if (q.start) { p = { ...q, title: p.title || q.title, place: q.place || p.place }; break; }
    }
  }
  if (!p.start || !p.title) return null;
  return { title: p.title.slice(0, 200), start: p.start, dur: p.dur || 60, place: (p.place || "").slice(0, 500), repeat: p.repeat || "" };
}

/** The email handler: mail to in-<token>@… becomes a reminder in that account, and a short reply says what was made. */
export async function receiveEmail(message, env, deps = {}) {
  const store = deps.store || (env.DB ? d1Store(env.DB) : null);
  if (!store) return;
  await store.ready();
  const m = /^in-([a-z0-9]{32})@/i.exec(message.to || "");
  if (!m) return message.setReject && message.setReject("Unknown address");
  const f = await store.feedByToken("in", await hash(m[1].toLowerCase()));
  if (!f) return message.setReject && message.setReject("This remmynd address isn't in use");
  const user = await store.userById(f.user_id);
  if (!user) return;
  const raw = deps.raw ?? await new Response(message.raw).text();
  const zone = (await store.reminders(user.id)).map(r => { try { return JSON.parse(r.data).tz; } catch { return null; } }).find(Boolean) || "UTC";
  const now = deps.now || Date.now(), r = reminderFromEmail(raw.slice(0, 200000), { now: new Date(now), timeZone: zone });
  const origin = deps.origin || "https://remmynd.space", mailer = deps.mailer || (env.RESEND_API_KEY ? resendMailer(env) : null);
  if (!r || r.start.getTime() <= now) {
    if (mailer) await mailer({ to: user.email, subject: "remmynd couldn't find a time in that email", text: "Nothing was added. Put the time in the subject, like \"Dentist Tue 4pm\", and send it again.", html: "<p>Nothing was added. Put the time in the subject, like <b>Dentist Tue 4pm</b>, and send it again.</p>" }).catch(() => {});
    return;
  }
  const share = createLink({ title: r.title, start: r.start, durationMinutes: r.dur, location: r.place, timeZone: zone, repeat: r.repeat || undefined }, { base: origin + "/" });
  const rkey = Math.round(r.start.getTime() / 6e4).toString(36) + "-" + djb(r.title);
  const data = { rkey, title: r.title, start: r.start.getTime(), first: r.start.getTime(), dur: r.dur, place: r.place, host: "", z: zone, tz: zone, share, state: "held", nudge: false, cal: null,
    heldAt: now, doneAt: null, replanAt: null, rep: r.repeat || "", from: "email" };
  await store.putItems(user.id, [{ kind: "reminder", key: rkey, data: JSON.stringify(data), deleted: false, updated: now }]);
  // Its email alerts, as for any synced reminder; the phone gets it, with its own alerts, on its next sync.
  if (user.email_alerts) await store.setMails(user.id, rkey, mailsFor(data, now).map(x => ({ ...x, id: randomId(12) })));
  if (mailer) {
    const when = describeWhen(r.start, zone) + (r.repeat ? " · " + describeRepeat(r.repeat) : "");
    await mailer({ to: user.email, subject: "Added: " + r.title, text: "Added to remmynd: " + r.title + ", " + when + ".\n" + share, html: "<p>Added to remmynd: <b>" + r.title.replace(/[<>&]/g, "") + "</b>, " + when + ".</p><p><a href=\"" + share + "\">Open it</a></p>" }).catch(() => {});
  }
  return { rkey };
}
function djb(s) { let h = 5381; for (const c of s) h = (h * 33) ^ c.charCodeAt(0); return (h >>> 0).toString(36); }
