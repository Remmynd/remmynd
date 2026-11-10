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

export const VERSION = "2.0.0";
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
// A web address written without https:// ("zoom.us/j/123", "www.lu.ma/x", "lu.ma") becomes a link,
// the same addresses parse() reads as one. Anything else, a place name included, stays as it is.
const BARE_WEB = /^(?:www\.[^\s<>"']+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"']*|(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|me|ly|gg|tv|us|in|so|ma|link|live|page|xyz|site|events?))$/i;
const asLink = s => s && BARE_WEB.test(s) ? "https://" + s : s;

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
      location: asLink((q.get("l") || "").trim()), notes: q.get("n") || "", host: q.get("h") || ""
    });
  } catch { return null; }
}

/* ---------- one-line capture ---------- */

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAY = "(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\\.?";
const AMOUNT = "(an?|half an?|\\d+(?:\\.\\d+)?)";
const UNIT = "(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w)";
const AMPM = "(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)";
// Short weekday names that are also ordinary words count only when capitalised: "Sun", not "sun".
const WORDY = new Set(["sun", "sat", "wed", "mon"]);
const TOD = { morning: [9, "am"], afternoon: [14, "pm"], evening: [19, "pm"], night: [20, "pm"], tonight: [20, "pm"] };
const MARK = " \u0001 ";

function minutesOf(a, unit) {
  const n = /^half/i.test(a) ? 0.5 : /^an?$/i.test(a) ? 1 : parseFloat(a);
  const u = unit[0].toLowerCase();
  return Math.round(n * (u === "m" ? 1 : u === "h" ? 60 : u === "d" ? 1440 : 10080));
}
const ampmOf = s => (s ? (/^p/i.test(s) ? "pm" : "am") : null);
const ymdAdd = (y, m, d, days) => { const t = new Date(Date.UTC(y, m - 1, d + days)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const cmpYMD = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);

/**
 * Read one typed line (or a pasted invitation) into a reminder:
 *   parse("Demo day Fri 5pm zoom.us/j/123") → title "Demo day", start Friday 5:00 PM, place the zoom.us address
 * Understands today, tonight, tomorrow, weekdays, "next Friday", "13 Nov", "Nov 13", "13/11", "1st",
 * ISO dates; "5pm", "5:30 pm", "17:00", noon, midnight; "in 2 hours", "in 30 min"; "for 30 min";
 * time ranges like "5-6pm"; web addresses; and a trailing "at <place>". A date with no time means
 * 9:00 AM. A time with no date means the next time that hour comes. What is left is the title.
 * `start` is null when the line has no time, `dur` (minutes) is null when it has no length.
 */
export function parse(text, { now = new Date(), timeZone = systemTimeZone() } = {}) {
  const tz = validZone(timeZone) ? timeZone : "UTC";
  const st = { tokens: [], place: "", date: null, time: null, end: null, inMinutes: null, dur: null, offset: null, tod: null };
  const lines = String(text ?? "").replace(/\r/g, "").replace(/[–—]/g, "-").split("\n");
  const titles = [];
  let wherePlace = "";

  for (let line of lines) {
    if (/^\s*(meeting id|passcode|password|pin|dial|phone|one tap mobile|find your local number)\b/i.test(line)) continue;
    if (/\b(standard|daylight|summer) time\b/i.test(line) && !/\d/.test(line)) continue;
    line = line.replace(/^\s*(?:you(?:'|’)re invited|you are invited|(?:updated )?invitation|invite)\s*(?:to)?\s*[:\-]\s*/i, "")
      .replace(/\b(?:join (?:zoom|the) meeting|join with google meet|click to join)\b/gi, " ");
    let label = "";
    const lm = /^\s*(what|title|event|subject|when|date|time|where|location|venue|place|join|link|joining info|meeting link|notes?|description)\s*:\s*(.*)$/i.exec(line);
    if (lm) { label = lm[1].toLowerCase(); line = lm[2]; }
    const s = { s: " " + line + " " };
    extract(s, st);
    const rest = tidy(s.s);
    if (/^(where|location|venue|place)$/.test(label)) { if (rest && !wherePlace) wherePlace = rest; continue; }
    if (/^(when|date|time|join|link|joining info|meeting link|notes?|description)$/.test(label)) continue;
    if (rest) titles.push(rest);
  }

  let title = titles[0] || "";
  if (!st.place && wherePlace) st.place = wherePlace;
  if (!st.place) {
    // A trailing "at <place>": "Coffee with Sam at Blue Tokai".
    const m = /^(.*\S)\s+(?:at|@)\s+(\S.*)$/i.exec(title);
    if (m && /\p{L}/u.test(m[2])) { title = tidy(m[1]); st.place = m[2]; st.tokens.push({ type: "place", text: "at " + m[2] }); }
  }
  return { title, start: resolveStart(st, now, tz), dur: st.dur ?? (st.end ? rangeMinutes(st) : null), place: st.place, tokens: st.tokens };
}

function extract(s, st) {
  const take = (re, fn) => { s.s = s.s.replace(re, (...m) => { const t = fn(m); if (t === false) return m[0]; if (t) st.tokens.push({ ...t, text: m[0].trim() }); return MARK; }); };
  const T = "(\\d{1,2})(?:[:.]([0-5]\\d))?\\s*" + AMPM + "?";

  // Web addresses: the first one is the place.
  take(/(?:https?:\/\/|\bwww\.)[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"']*|\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|me|ly|gg|tv|us|in|so|ma|link|live|page|xyz|site|events?)\b(?![@.\w])/gi, m => {
    if (st.place || /@\S*$/.test(s.s.slice(0, s.s.indexOf(m[0])))) return false;
    const u = m[0].replace(/[.,;:!?)\]]+$/, "");
    st.place = /^https?:\/\//i.test(u) ? u : "https://" + u;
    return { type: "place" };
  });
  take(/\(?\b[\w.+-]+@[\w-]+\.[\w.-]+\b\)?/g, () => null);
  // Explicit UTC offsets; other zone names in brackets are dropped.
  take(/\(?\b(?:UTC|GMT)\s*(?:([+-])(\d{1,2})(?::?(\d{2}))?)?\b\)?/g, m => {
    if (st.offset != null) return false;
    st.offset = m[1] ? (m[1] === "-" ? -1 : 1) * ((+m[2]) * 60 + (+(m[3] || 0))) : 0;
    return { type: "zone" };
  });
  take(/\(\s*[A-Z]{2,5}\s*\)/g, () => null);

  // ISO dates, with an optional time.
  take(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(z|[+-]\d{2}:?\d{2})?)?\b/gi, m => {
    if (st.date) return false;
    st.date = { y: +m[1], m: +m[2], d: +m[3] };
    if (m[4] != null) st.time = { h: +m[4], mi: +m[5], exact: true };
    if (m[6]) st.offset = /z/i.test(m[6]) ? 0 : (m[6][0] === "-" ? -1 : 1) * (+m[6].slice(1, 3) * 60 + +m[6].slice(-2));
    return { type: "date" };
  });
  // "in 2 hours", "in 30 min"
  take(new RegExp("\\bin\\s+" + AMOUNT + "\\s*" + UNIT + "\\b", "gi"), m => {
    if (st.inMinutes != null) return false;
    st.inMinutes = minutesOf(m[1], m[2]);
    return { type: "relative" };
  });
  // "for 30 min"
  take(new RegExp("\\bfor\\s+" + AMOUNT + "\\s*" + UNIT + "\\b", "gi"), m => {
    if (st.dur != null) return false;
    st.dur = minutesOf(m[1], m[2]);
    return { type: "duration" };
  });
  // Ranges: "5-6pm", "5:00 PM - 6:00 PM", "17:00-18:30"
  take(new RegExp("(?:\\bfrom\\s+)?\\b" + T + "\\s*(?:-|to|till|until)\\s*" + T + "(?![\\w:])", "gi"), m => {
    const [a, b] = [{ h: +m[1], mi: +(m[2] || 0), ap: ampmOf(m[3]), colon: m[2] != null }, { h: +m[4], mi: +(m[5] || 0), ap: ampmOf(m[6]), colon: m[5] != null }];
    if (st.time || !(a.ap || b.ap || (a.colon && b.colon))) return false;
    if (!a.ap && b.ap && a.h <= 12) a.ap = (b.ap === "pm" && a.h > b.h && b.h !== 12) ? "am" : b.ap;
    st.time = timeOf(a);
    st.end = timeOf(b);
    return { type: "time" };
  });
  // "13 Nov", "Nov 13", "Friday, November 13, 2026", "13th of Nov"
  take(new RegExp("(?:\\bon\\s+)?(?:\\b" + WEEKDAY + ",?\\s+)?(?:\\b(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+" + MONTH + "|\\b" + MONTH + "\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)(?![\\d:])(?:,?\\s+(\\d{4})\\b)?", "gi"), m => {
    if (st.date) return false;
    const day = +(m[2] || m[5]), mon = MON[(m[3] || m[4]).slice(0, 3).toLowerCase()];
    if (!(day >= 1 && day <= 31)) return false;
    st.date = { y: m[6] ? +m[6] : null, m: mon, d: day };
    return { type: "date" };
  });
  // "13/11", "11/13", "13/11/2026"
  take(/(?:\bon\s+)?\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g, m => {
    if (st.date) return false;
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return false;
    st.date = { y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, m: mo, d };
    return { type: "date" };
  });
  // today, tonight, tomorrow
  take(/\b(day after tomorrow|today|tonight|tomorrow|tmrw|tmr)\b/gi, m => {
    if (st.date) return false;
    const w = m[1].toLowerCase();
    st.date = { rel: w === "day after tomorrow" ? 2 : /^(today|tonight)$/.test(w) ? 0 : 1 };
    if (w === "tonight") st.tod = "tonight";
    return { type: "date" };
  });
  // Friday, next Friday
  take(new RegExp("(?:\\bon\\s+)?(?:\\b(next|this)\\s+)?\\b" + WEEKDAY + "(?![\\w'])", "gi"), m => {
    const word = m[2].replace(/\.$/, ""), key = word.slice(0, 3).toLowerCase();
    if (st.date || (word.length <= 4 && WORDY.has(key) && word[0] === word[0].toLowerCase())) return false;
    st.date = { dow: DOW[key], next: /^next$/i.test(m[1] || "") };
    return { type: "date" };
  });
  // "the 1st", "on the 20th"
  take(/(?:\bon\s+)?(?:\bthe\s+)?\b(\d{1,2})(?:st|nd|rd|th)\b/gi, m => {
    if (st.date || !(+m[1] >= 1 && +m[1] <= 31)) return false;
    st.date = { dom: +m[1] };
    return { type: "date" };
  });
  // noon, midnight, 5pm, 5:30 pm, 17:00, "at 5"
  take(/(?:\b(?:at|by)\s+)?\b(noon|midday|midnight)\b/gi, m => {
    if (st.time) return false;
    st.time = /midnight/i.test(m[1]) ? { h: 0, mi: 0, exact: true, midnight: true } : { h: 12, mi: 0, exact: true };
    return { type: "time" };
  });
  take(new RegExp("(?:(?:\\b(?:at|by|from)\\s+)|@\\s*)?\\b(\\d{1,2})(?:[:.]([0-5]\\d))?\\s*" + AMPM + "(?![a-z])", "gi"), m => {
    if (st.time || +m[1] < 1 || +m[1] > 12) return false;
    st.time = timeOf({ h: +m[1], mi: +(m[2] || 0), ap: ampmOf(m[3]) });
    return { type: "time" };
  });
  take(/(?:(?:\b(?:at|by|from)\s+)|@\s*)?\b(\d{1,2}):([0-5]\d)\b/gi, m => {
    if (st.time || +m[1] > 23) return false;
    st.time = timeOf({ h: +m[1], mi: +m[2], ap: null, zero: m[1].length === 2 && m[1][0] === "0" });
    return { type: "time" };
  });
  take(/(?:\b(?:at)\s+|@\s*)\b(1[0-2]|[1-9])\b(?![:.]\d|\s*(?:%|min|mins|minutes|h\b|hrs?|hours?|st|nd|rd|th|\/))/gi, m => {
    if (st.time) return false;
    st.time = { h: +m[1], mi: 0, exact: false };
    return { type: "time" };
  });
  // morning, afternoon, evening, night
  take(/\b(?:this\s+|in the\s+)?(morning|afternoon|evening|night)\b/gi, m => {
    if (st.tod && st.tod !== "tonight") return false;
    if (!st.tod) st.tod = m[1].toLowerCase();
    return { type: "time" };
  });
}

// A typed time: exact when it says am/pm, uses 24-hour form or a leading zero; otherwise read later.
function timeOf({ h, mi, ap, zero }) {
  if (ap) return { h: (h % 12) + (ap === "pm" ? 12 : 0), mi, exact: true };
  return { h, mi, exact: zero || h === 0 || h > 12 };
}

// Hours like "at 5" or "7:30" with no am/pm: tonight, afternoon and evening mean pm, morning means
// am, otherwise 1 to 6 is pm, 7 to 11 is am and 12 is noon.
function settle(t, tod) {
  if (!t || t.exact) return t;
  const pm = tod ? TOD[tod][1] === "pm" : t.h >= 1 && t.h <= 6;
  return { ...t, h: t.h === 12 ? 12 : t.h + (pm ? 12 : 0), exact: true };
}

function rangeMinutes(st) {
  const a = settle(st.time, st.tod), b = settle(st.end, st.tod);
  let m = (b.h * 60 + b.mi) - (a.h * 60 + a.mi);
  if (m <= 0) m += 24 * 60;
  return m;
}

function resolveStart(st, now, tz) {
  if (st.inMinutes != null) return new Date(Math.round(now.getTime() / 60000 + st.inMinutes) * 60000);
  if (!st.date && !st.time && !st.tod) return null;
  const off = st.offset;
  const local = off == null ? parts(now, tz) : (() => { const t = new Date(now.getTime() + off * 60000); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; })();
  const today = { y: local.y, m: local.mo, d: local.d };
  const at = (ymd, t) => off == null ? zonedTime(ymd.y, ymd.m, ymd.d, t.h, t.mi, tz) : new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, t.h, t.mi) - off * 60000);
  let time = settle(st.time, st.tod);
  const fallback = st.tod ? { h: TOD[st.tod][0], mi: 0 } : { h: 9, mi: 0 };
  const t = time || fallback;
  const midnight = !!(time && time.midnight);
  const d = st.date;
  let day;
  if (!d) {
    day = today;
    if (at(day, t) <= now) day = ymdAdd(day.y, day.m, day.d, 1);
    return at(day, t);
  }
  if (d.rel != null) day = ymdAdd(today.y, today.m, today.d, d.rel);
  else if (d.dow != null) {
    const dowToday = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    let delta = (d.dow - dowToday + 7) % 7;
    if (d.next) {
      if (delta === 0) delta = 7;
      const mondayIdx = x => (x + 6) % 7;            // Monday-first week
      if (mondayIdx(dowToday) + delta <= 6) delta += 7; // still this week: next week's
    } else if (delta === 0 && at(today, t) <= now) delta = 7;
    day = ymdAdd(today.y, today.m, today.d, delta);
  } else if (d.dom != null) {
    // "the 1st": the next one to come, so later today's has already gone.
    let y = today.y, m = today.m;
    const bump = () => { m++; if (m > 12) { m = 1; y++; } };
    if (d.dom < today.d || (d.dom === today.d && at(today, t) <= now)) bump();
    while (d.dom > daysIn(y, m)) bump();
    day = { y, m, d: d.dom };
  } else {
    day = { y: d.y || today.y, m: d.m, d: Math.min(d.d, daysIn(d.y || today.y, d.m)) };
    if (!d.y && cmpYMD(day, today) < 0) day = { ...day, y: day.y + 1 };
  }
  if (midnight) day = ymdAdd(day.y, day.m, day.d, 1);
  return at(day, t);
}

// Title cleanup: drop words left hanging where something was taken out, and stray punctuation.
function tidy(s) {
  let out = s, prev;
  do { prev = out; out = out.replace(/(?:\b(?:on|at|by|from|this|next|the|for|in|of)\b|@)\s*\u0001/gi, "\u0001"); } while (out !== prev);
  return out.replace(/\u0001/g, " ").replace(/\(\s*\)|\[\s*\]/g, " ").replace(/\s+/g, " ")
    .replace(/(?:\s+\b(?:on|at|by|from|for|in)|\s*@)\s*$/i, "")
    .replace(/^[\s,;:|·•⋅\-@]+|[\s,;:|·•⋅\-@]+$/g, "").trim();
}

/* ---------- link previews ---------- */

// A short zone name: IST, EST, AEDT, CET. Falls back to GMT+9 where no common name exists.
function zoneName(date, zone) {
  let fallback = "";
  for (const locale of ["en-US", "en-GB", "en-IN", "en-AU"]) {
    const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" }).formatToParts(date).find(p => p.type === "timeZoneName");
    const name = part ? part.value : "";
    if (name && !/^(GMT|UTC)[+-]/.test(name)) return name;
    fallback = fallback || name;
  }
  return fallback;
}

/** A reminder's time as link previews print it: "Fri 13 Nov, 5:00 PM IST", in the host's zone or UTC. */
export function describeWhen(start, timeZone) {
  const z = validZone(timeZone) ? timeZone : "UTC", d = new Date(start);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: z, weekday: "short", day: "numeric", month: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "numeric", minute: "2-digit" }).format(d);
  return (day + ", " + time + " " + zoneName(d, z)).replace(/[\u00a0\u202f]/g, " ");
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

const r2 = n => Math.round(n * 100) / 100 + 0;

// The moment ring at badge size (24 px): an open ring, 18 degrees each side of the dot, as ring.js
// draws it beside a title.
function ringMark(ink, dot) {
  const pt = (a, r) => { const t = a * Math.PI / 180; return [r2(12 + r * Math.sin(t)), r2(12 - r * Math.cos(t))]; };
  const a = 40, [x1, y1] = pt(a + 18, 8.8), [x2, y2] = pt(a - 18, 8.8), [dx, dy] = pt(a, 8.8);
  return '<path d="M' + x1 + " " + y1 + "A8.8 8.8 0 1 1 " + x2 + " " + y2 + '" stroke="' + ink + '" stroke-width="2.2" stroke-linecap="round"/><circle cx="' + dx + '" cy="' + dy + '" r="2.6" fill="' + dot + '"/>';
}

/** The Remind me badge as an SVG string (172×44), with the moment ring, in the 2.0 colours. */
export function badgeSVG({ theme = "light" } = {}) {
  const dk = theme === "dark", bg = dk ? "#17191D" : "#FFFFFF", st = dk ? "#2A2D33" : "#E3E5E8",
    fg = dk ? "#F4F5F6" : "#0E0F11", mu = dk ? "#A3A8B0" : "#666C75", dot = dk ? "#C8F53B" : "#F2A000";
  const font = "ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";
  return '<svg xmlns="http://www.w3.org/2000/svg" width="172" height="44" viewBox="0 0 172 44" role="img" aria-label="Remind me, with remmynd"><rect x=".5" y=".5" width="171" height="43" rx="21.5" fill="' + bg + '" stroke="' + st + '"/><g transform="translate(12 10)" fill="none">' + ringMark(fg, dot) + '</g><text x="46" y="18.5" font-family="' + font + '" font-size="8.5" font-weight="600" letter-spacing=".9" fill="' + mu + '">REMMYND</text><text x="46" y="33" font-family="' + font + '" font-size="15" font-weight="600" letter-spacing="-.2" fill="' + fg + '">Remind me</text></svg>';
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
  VERSION, DEFAULT_BASE, createLink, toPath, encode, decode, fromQuery, parse, describeWhen, parseStart, zonedTime, systemTimeZone,
  description, toICS, googleCalendarUrl, outlookUrl, badgeSVG, badgeHTML, badgeMarkdown
};
