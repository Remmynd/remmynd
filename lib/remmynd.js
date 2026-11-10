/*!
 * remmynd — reminders, as a link.
 * Zero dependencies. MIT licence. https://remmynd.space
 *
 * A reminder is a small JSON object, base64url-encoded into the link:
 *
 *   shared   https://remmynd.space/r/<payload>   chat apps can show the title and time
 *   private  https://remmynd.space/#<payload>    after #, which browsers never send to a server
 *
 *   { t: title, s: start (base36 minutes since epoch), d?: minutes, l?: place or link, n?: notes, h?: host,
 *     z?: the host's IANA time zone }
 */

export const VERSION = "1.0.0";
export const DEFAULT_BASE = "https://remmynd.space/";
const CREDIT = "Made with remmynd.space · free reminder links, no sign-up";
const te = new TextEncoder();

/* ---------- base64url ---------- */
function b64urlEncode(str) {
  const bytes = te.encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/* ---------- time zones ---------- */
function parts(date, timeZone) {
  const g = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric"
  }).formatToParts(date).forEach(x => { g[x.type] = x.value; });
  return { y: +g.year, mo: +g.month, d: +g.day, h: (+g.hour) % 24, mi: +g.minute, s: +g.second };
}
function offsetMinutes(date, timeZone) {
  const p = parts(date, timeZone);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** Local wall-clock time in an IANA time zone → Date. */
export function zonedTime(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let off = offsetMinutes(new Date(guess), timeZone);
  off = offsetMinutes(new Date(guess - off * 60000), timeZone);
  return new Date(guess - off * 60000);
}

/** Device/system time zone, or UTC. */
export function systemTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

const validZone = z => { try { return !!z && !!new Intl.DateTimeFormat("en-US", { timeZone: z }); } catch { return false; } };
const HAS_OFFSET = /[zZ]$|[+-]\d{2}:?\d{2}$/;

/**
 * Turn a start value into a Date.
 * Accepts a Date, epoch milliseconds, an ISO string with Z or an offset,
 * or a local "YYYY-MM-DD HH:mm" / "YYYY-MM-DDTHH:mm" read in `timeZone`.
 */
export function parseStart(value, timeZone = systemTimeZone()) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number") return new Date(value);
  if (typeof value !== "string") throw new TypeError("start must be a Date, number or string");
  const v = value.trim();
  if (HAS_OFFSET.test(v)) {
    const d = new Date(v);
    if (isNaN(d)) throw new RangeError(`Could not read the time "${value}"`);
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(v);
  if (!m) throw new RangeError(`Could not read the time "${value}". Use YYYY-MM-DD HH:mm`);
  if (!validZone(timeZone)) throw new RangeError(`Unknown time zone "${timeZone}"`);
  return zonedTime(+m[1], +m[2], +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0, timeZone);
}

/* ---------- normalise ---------- */
function normalise(event) {
  if (!event || typeof event !== "object") throw new TypeError("event must be an object");
  const title = String(event.title ?? "").trim();
  if (!title) throw new TypeError("event.title is required");
  if (event.timeZone && !validZone(event.timeZone)) throw new RangeError(`Unknown time zone "${event.timeZone}"`);
  const readIn = event.timeZone || systemTimeZone();
  const start = parseStart(event.start, readIn);
  if (isNaN(start)) throw new RangeError("event.start is not a valid time");
  const durationMinutes = Math.round(Number(event.durationMinutes ?? 60));
  if (!(durationMinutes > 0 && durationMinutes <= 1440)) throw new RangeError("durationMinutes must be between 1 and 1440");
  const location = event.location ? String(event.location).trim() : "";
  const notes = event.notes ? String(event.notes).trim() : "";
  const host = event.host ? String(event.host).trim() : "";
  // The host's zone: the one given, or the one a local "YYYY-MM-DD HH:mm" was read in.
  // An exact time (a Date, a number, or a string with Z or an offset) on its own has no zone.
  const local = typeof event.start === "string" && !HAS_OFFSET.test(event.start.trim());
  const timeZone = event.timeZone || (local ? readIn : "");
  return { title, start, durationMinutes, location, notes, host, timeZone };
}

/* ---------- links ---------- */

/** The payload that holds the reminder: base64url JSON, as it appears after /r/ or #. */
export function encode(event) {
  const e = normalise(event);
  const r = { t: e.title, s: Math.round(e.start.getTime() / 60000).toString(36) };
  if (e.durationMinutes !== 60) r.d = e.durationMinutes;
  if (e.location) r.l = e.location;
  if (e.notes) r.n = e.notes;
  if (e.host) r.h = e.host;
  if (e.timeZone) r.z = e.timeZone;
  return b64urlEncode(JSON.stringify(r));
}

/** The path of a link: "/r/<payload>" (shared, the default) or "/#<payload>" (private). */
export function toPath(event, { private: isPrivate = false } = {}) {
  return (isPrivate ? "/#" : "/r/") + encode(event);
}

/**
 * A shareable reminder link. Shared links (the default) let chat apps preview the title and
 * time; `private: true` keeps everything after #, which never reaches a server.
 */
export function createLink(event, { base = DEFAULT_BASE, private: isPrivate = false } = {}) {
  return base.replace(/#.*$/, "").replace(/\/+$/, "") + toPath(event, { private: isPrivate });
}

/** Read a reminder back from a shared or private link, or a bare payload. Returns null if it is not a remmynd link. */
export function decode(linkOrFragment) {
  try {
    const s = String(linkOrFragment).trim();
    const hash = s.indexOf("#");
    const shared = /(?:^|\/)r\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(hash >= 0 ? s.slice(0, hash) : s);
    const payload = shared ? shared[1] : hash >= 0 ? s.slice(hash + 1) : s;
    const r = JSON.parse(b64urlDecode(payload));
    if (!r || typeof r.t !== "string" || !r.t || !r.s) return null;
    const start = /T/.test(String(r.s)) ? new Date(r.s) : new Date(parseInt(r.s, 36) * 60000);
    if (isNaN(start)) return null;
    return {
      title: r.t, start, durationMinutes: r.d || 60,
      location: r.l || "", notes: r.n || "", host: r.h || "",
      timeZone: typeof r.z === "string" && validZone(r.z) ? r.z : ""
    };
  } catch { return null; }
}

/**
 * Read a reminder written as query parameters, as in remmynd.space/new?t=…&at=…:
 * `t` title (required), `at` "YYYY-MM-DDTHH:mm" (optionally with Z or an offset), `tz` IANA zone,
 * `d` minutes, `l` place or link, `n` notes, `h` host. A time with no Z, offset or `tz` is read in
 * `timeZone` (default: the system zone). Accepts a query string, a full URL, an object or
 * URLSearchParams. Returns an event for createLink(), or null if the title or time is missing.
 */
export function fromQuery(query, { timeZone } = {}) {
  const q = query instanceof URLSearchParams ? query
    : new URLSearchParams(typeof query === "string" ? query.replace(/^[^?#]*\?/, "").replace(/#.*$/, "") : query || {});
  const at = (q.get("at") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2})?(?:[zZ]|[+-]\d{2}:?\d{2})?$/.test(at)) return null;
  const d = parseInt(q.get("d"), 10);
  try {
    return normalise({
      title: q.get("t") || "", start: at, timeZone: q.get("tz") || timeZone || undefined,
      durationMinutes: d > 0 && d <= 1440 ? d : undefined,
      location: q.get("l") || "", notes: q.get("n") || "", host: q.get("h") || ""
    });
  } catch { return null; }
}

/* ---------- calendar payloads ---------- */
const isHttp = s => /^https?:\/\//i.test(s || "");
const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEscape = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {
  const out = []; let cur = "", n = 0;
  for (const ch of line) {
    const b = te.encode(ch).length;
    if (n + b > 73) { out.push(cur); cur = " "; n = 1; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join("\r\n");
}
function hash(s) { let h = 5381; for (const c of s) h = (h * 33) ^ c.charCodeAt(0); return (h >>> 0).toString(36); }

function details(e, link) {
  const head = [e.notes, isHttp(e.location) ? "Join: " + e.location : ""].filter(Boolean);
  return (head.length ? head.join("\n") + "\n\n" : "") + "Reminder link: " + link + "\n" + CREDIT;
}

/** Calendar description text, including the remmynd credit line. */
export function description(event, { base = DEFAULT_BASE, private: isPrivate = false } = {}) {
  return details(normalise(event), createLink(event, { base, private: isPrivate }));
}

/** An .ics (iCalendar) file with alerts 1 hour before and at the start. */
export function toICS(event, { base = DEFAULT_BASE, private: isPrivate = false, alarms = [60, 0] } = {}) {
  const e = normalise(event);
  const link = createLink(event, { base, private: isPrivate });
  const end = new Date(e.start.getTime() + e.durationMinutes * 60000);
  const uid = "rm-" + Math.round(e.start.getTime() / 60000).toString(36) + "-" + hash(e.title) + "@remmynd.space";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//zoof04//remmynd//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + stamp(new Date()), "DTSTART:" + stamp(e.start), "DTEND:" + stamp(end),
    "SUMMARY:" + icsEscape(e.title), "DESCRIPTION:" + icsEscape(details(e, link))];
  if (e.location) L.push("LOCATION:" + icsEscape(e.location));
  L.push("URL:" + (isHttp(e.location) ? e.location : link));
  for (const m of alarms) {
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEscape(e.title), "TRIGGER:" + (m > 0 ? "-PT" + m + "M" : "PT0M"), "END:VALARM");
  }
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

/** Google Calendar "add event" URL. */
export function googleCalendarUrl(event, { base = DEFAULT_BASE, private: isPrivate = false } = {}) {
  const e = normalise(event);
  const end = new Date(e.start.getTime() + e.durationMinutes * 60000);
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(e.title) +
    "&dates=" + stamp(e.start) + "/" + stamp(end) +
    "&details=" + encodeURIComponent(details(e, createLink(event, { base, private: isPrivate }))) +
    "&location=" + encodeURIComponent(e.location);
}

/** Outlook.com (or Microsoft 365 with { office: true }) "add event" URL. */
export function outlookUrl(event, { base = DEFAULT_BASE, private: isPrivate = false, office = false } = {}) {
  const e = normalise(event);
  const end = new Date(e.start.getTime() + e.durationMinutes * 60000);
  return "https://" + (office ? "outlook.office.com" : "outlook.live.com") + "/calendar/0/action/compose?rru=addevent" +
    "&subject=" + encodeURIComponent(e.title) + "&startdt=" + e.start.toISOString() + "&enddt=" + end.toISOString() +
    "&body=" + encodeURIComponent(details(e, createLink(event, { base, private: isPrivate }))) + "&location=" + encodeURIComponent(e.location);
}

/* ---------- Remind me badge ---------- */

/** The Remind me badge as an SVG string (172×44). */
export function badgeSVG({ theme = "light" } = {}) {
  const dk = theme === "dark", bg = dk ? "#0e0f11" : "#ffffff", st = dk ? "#2a2c31" : "#e3e5e8",
    fg = dk ? "#f2f3f5" : "#0e0f11", mu = dk ? "#9aa0a8" : "#666c75", dot = dk ? "#ffb52e" : "#f2a000";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="172" height="44" viewBox="0 0 172 44" role="img" aria-label="Remind me, with remmynd"><rect x=".5" y=".5" width="171" height="43" rx="21.5" fill="' + bg + '" stroke="' + st + '"/><g transform="translate(13 10)" fill="none"><path d="M19.947 7.775A9 9 0 1 1 14.781 3.44" stroke="' + fg + '" stroke-width="2" stroke-linecap="round"/><path d="M12 12L15.214 8.17" stroke="' + fg + '" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.24" fill="' + fg + '"/><circle cx="17.785" cy="5.106" r="2.1" fill="' + dot + '"/></g><text x="47" y="18.5" font-family="ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="8.5" font-weight="600" letter-spacing=".9" fill="' + mu + '">REMMYND</text><text x="47" y="33" font-family="ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="15" font-weight="600" letter-spacing="-.2" fill="' + fg + '">Remind me</text></svg>';
}

const badgeUrl = theme => "https://remmynd.space/badge" + (theme === "dark" ? "-dark" : "") + ".svg";
const attr = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** HTML snippet: the badge linking to a reminder. */
export function badgeHTML(link, { theme = "light" } = {}) {
  return '<a href="' + attr(link) + '" target="_blank" rel="noopener">\n  <img src="' + badgeUrl(theme) + '" alt="Remind me" width="172" height="44">\n</a>';
}

/** Markdown snippet: the badge linking to a reminder. */
export function badgeMarkdown(link, { theme = "light" } = {}) {
  return "[![Remind me](" + badgeUrl(theme) + ")](" + link + ")";
}

export default {
  VERSION, DEFAULT_BASE, createLink, toPath, encode, decode, fromQuery, parseStart, zonedTime, systemTimeZone,
  description, toICS, googleCalendarUrl, outlookUrl, badgeSVG, badgeHTML, badgeMarkdown
};
