/* remmynd calendar import: read a calendar file (.ics) on this device and hold its upcoming events as
 * reminders. app.js loads this when a calendar file is dropped on the page, picked from the menu, or
 * asked for in Search and commands. The file is read here, in the page; nothing is uploaded and this
 * module never makes a request. Each event held becomes a private link (it never reaches a server) in
 * Coming up and My links, with the same alerts a Remind me tap sets. A repeating event is held once,
 * at its next time. */
import { zonedTime } from "./remmynd.js";

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MAX = 100; // events shown from one import
const DAY = 864e5;
/* Where calls happen: a link to one of these is the place, before any room name. */
const CALL = /https?:\/\/(?:[\w.-]*\.)?(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com|meet\.jit\.si|webex\.com|around\.co|discord\.gg|discord\.com|gather\.town)\/[^\s<>"']*/i;
const URLISH = /https?:\/\/[^\s<>"']+/i;

/** Folded lines joined (RFC 5545 3.1), any line ending. */
export const unfold = t => String(t ?? "").replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "");
/** Text values: \n is a line break, \; \, and \\ are the characters themselves. */
export const unescape = s => String(s ?? "").replace(/\\([\\;,nN])/g, (m, c) => (c === "n" || c === "N" ? "\n" : c));

/** One content line, NAME;PARAM=value;OTHER="quoted:value":value, into its parts. */
export function contentLine(line) {
  let i = 0, q = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ":" && !q) break; }
  const [name, ...ps] = line.slice(0, i).split(";"), params = {};
  for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
  return { name: name.trim().toUpperCase(), params, value: line.slice(i + 1) };
}

const validZone = z => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch (e) { return false; } };

/** A DATE or DATE-TIME value as a Date, or null. UTC (Z) as written; a TZID this browser knows in that zone; a floating
 * time, or a zone it doesn't know (Outlook's "India Standard Time"), in the reader's zone. A whole-day event is 9:00 that day. */
export function whenOf(value, params = {}, timeZone) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], day = m[4] == null || params.VALUE === "DATE";
  const h = day ? 9 : +m[4], mi = day ? 0 : +m[5];
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59)) return null;
  if (m[7]) return new Date(Date.UTC(y, mo - 1, d, h, mi, +(m[6] || 0)));
  const zone = params.TZID && validZone(params.TZID) ? params.TZID : timeZone;
  const t = zonedTime(y, mo, d, h, mi, zone);
  return isNaN(t) ? null : t;
}

/** "PT30M", "PT1H30M", "P1D" into minutes, or null. */
export function durationMinutes(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const n = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.round((+(m[6] || 0)) / 60);
  return n > 0 ? n : null;
}

/** The next time a repeating event is on: the first daily, weekly or monthly occurrence that hasn't ended by `now` (one that
 * is live counts), stepping from the first start. Other rules, or a rule that has ended (UNTIL or COUNT), give the first start
 * itself; past events are then left out. */
export function nextStart(start, rrule, now, dur = 60) {
  const r = {};
  for (const p of String(rrule ?? "").split(";")) { const j = p.indexOf("="); if (j > 0) r[p.slice(0, j).toUpperCase()] = p.slice(j + 1).toUpperCase(); }
  const every = Math.max(1, +(r.INTERVAL || 1)), until = r.UNTIL ? whenOf(r.UNTIL, {}, "UTC") : null;
  let n = r.COUNT ? +r.COUNT : Infinity, t = new Date(start.getTime()), i = 0;
  while (t.getTime() + dur * 6e4 <= now && i++ < 1000 && --n > 0) {
    if (r.FREQ === "DAILY") t = new Date(t.getTime() + every * DAY);
    else if (r.FREQ === "WEEKLY") t = new Date(t.getTime() + every * 7 * DAY);
    else if (r.FREQ === "MONTHLY") { const d = new Date(t.getTime()); d.setUTCMonth(d.getUTCMonth() + every); t = d; }
    else return start;
    if (until && t > until) return start;
  }
  return n > 0 ? t : start;
}

/**
 * Every upcoming event in a calendar file: { title, start, dur, place, repeats }, soonest first, at most MAX.
 * Cancelled events, and events already over, are left out. A repeating event appears once, at its next time.
 */
export function readICS(text, { now = Date.now(), timeZone } = {}) {
  const out = [];
  let ev = null, depth = 0;
  for (const raw of unfold(text).split("\n")) {
    if (!raw.trim()) continue;
    const { name, params, value } = contentLine(raw);
    if (name === "BEGIN") { if (value.trim().toUpperCase() === "VEVENT" && !ev) ev = { p: {} }; else if (ev) depth++; continue; }
    if (name === "END") {
      if (ev && depth) { depth--; continue; }
      if (ev && value.trim().toUpperCase() === "VEVENT") { const e = finish(ev.p, now, timeZone); if (e) out.push(e); ev = null; }
      continue;
    }
    if (!ev || depth) continue; // alarms and other parts inside the event are not read
    ev.p[name] = { params, value: value.trim() };
  }
  const seen = new Set();
  return out.sort((a, b) => a.start - b.start).filter(e => { const k = e.title + "|" + e.start.getTime(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX);
}

function finish(p, now, timeZone) {
  const get = k => (p[k] ? unescape(p[k].value) : "");
  if (/^CANCELLED$/i.test(get("STATUS"))) return null;
  const first = p.DTSTART ? whenOf(p.DTSTART.value, p.DTSTART.params, timeZone) : null;
  if (!first) return null;
  const end = p.DTEND ? whenOf(p.DTEND.value, p.DTEND.params, timeZone) : null;
  const day = p.DTSTART.params.VALUE === "DATE" || !/T/.test(p.DTSTART.value);
  let dur = end && !day ? Math.round((end - first) / 6e4) : durationMinutes(get("DURATION"));
  if (!(dur > 0 && dur <= 1440)) dur = null;
  const start = p.RRULE ? nextStart(first, get("RRULE"), now, dur || 60) : first;
  if (start.getTime() + (dur || 60) * 6e4 <= now) return null;
  const title = (get("SUMMARY") || "Untitled").replace(/\s+/g, " ").trim().slice(0, 120);
  const loc = get("LOCATION").replace(/\s+/g, " ").trim(), desc = get("DESCRIPTION"), conf = get("X-GOOGLE-CONFERENCE") || get("X-MICROSOFT-SKYPETEAMSMEETINGURL");
  const call = [conf, loc, desc, get("URL")].map(s => (CALL.exec(s) || [])[0]).find(Boolean);
  const place = call || loc || ((URLISH.exec(get("URL")) || [])[0] || "");
  return { title, start, dur, place: place.slice(0, 300), repeats: !!p.RRULE };
}

/* ---------- the sheet ---------- */
let back = null, onKey = null;

function close() {
  const el = $("#ci-sheet");
  if (!el) return;
  el.remove();
  if (onKey) document.removeEventListener("keydown", onKey);
  if (back && back.isConnected) back.focus();
}

const readFile = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result || "")); r.onerror = () => no(r.error); r.readAsText(f); });

/**
 * Open the sheet for one or more calendar files. hold(event) is the app's own: it keeps the reminder on this device and
 * resolves true, "have" (already held) or false. refresh() redraws Coming up. Nothing here leaves the device.
 */
export async function open({ files, timeZone, hold, toast, from, refresh }) {
  if (!$('link[href="/calimport.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/calimport.css"; document.head.append(l); }
  close();
  back = from || document.activeElement;
  let events = [];
  try { events = readICS((await Promise.all([...files].map(readFile))).join("\n"), { timeZone }); }
  catch (e) { return toast("Couldn't read that file."); }
  const fmt = new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const len = m => (m < 60 ? m + " min" : m % 60 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : m / 60 + (m === 60 ? " hour" : " hours"));
  const el = document.createElement("div");
  el.className = "sheet"; el.id = "ci-sheet";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "ci-t");
  const n = events.length;
  el.innerHTML = '<div class="sheet-card ci-card"><button type="button" class="sheet-x" aria-label="Close">×</button><h2 id="ci-t">Your calendar file</h2>' +
    (n ? '<p class="ci-sub">' + n + (n === 1 ? " upcoming event" : " upcoming events") + ", read on this device. Nothing is uploaded.</p>" +
        '<div class="ci-list">' + events.map((e, i) => '<div class="ci-row"><span><b>' + esc(e.title) + "</b><i>" + esc(fmt.format(e.start) + (e.dur ? " · " + len(e.dur) : "") + (e.repeats ? " · repeats" : "")) + "</i></span>" +
          '<button type="button" class="btn small" data-i="' + i + '">Hold</button></div>').join("") + "</div>" +
        (n > 1 ? '<button type="button" class="btn ink" data-all>Hold all ' + n + "</button>" : "") +
        '<p class="sheet-note">Each one becomes a private reminder in Coming up, with the same alerts as Remind me. A repeating event is held once, at its next time.</p>'
      : '<p class="ci-sub">No upcoming events in this file. Only what hasn\'t ended yet is shown.</p>') + "</div>";
  document.body.append(el);
  const mark = (b, t) => { b.textContent = t; b.setAttribute("aria-disabled", "true"); b.disabled = true; };
  const one = async i => { const b = el.querySelector('[data-i="' + i + '"]'); if (!b || b.disabled) return false; const r = await hold(events[i]); if (r) mark(b, r === "have" ? "Already held" : "Held"); return r === true; };
  el.addEventListener("click", async e => {
    if (e.target === el || e.target.closest(".sheet-x")) return close();
    const b = e.target.closest("[data-i]"), all = e.target.closest("[data-all]");
    if (b) { if (await one(+b.dataset.i)) { toast("Held. It's in Coming up."); if (refresh) refresh(); } return; }
    if (all) {
      mark(all, "Holding…");
      let k = 0; for (let i = 0; i < events.length; i++) if (await one(i)) k++;
      mark(all, "Held");
      toast(k ? "Held " + k + (k === 1 ? " reminder." : " reminders.") + " They're in Coming up." : "Already held.");
      if (refresh) refresh();
    }
  });
  onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.querySelector(".sheet-x").focus();
}
