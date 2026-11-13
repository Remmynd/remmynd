import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "../lib/remmynd.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sample = { title: "Demo day ✨", start: "2026-12-05 18:00", timeZone: "Asia/Kolkata", location: "https://lu.ma/demo", notes: "Bring a laptop", host: "zoof04", durationMinutes: 90 };

test("time zones: wall clock to UTC, including DST edges", () => {
  assert.equal(R.parseStart("2026-11-30 00:01", "America/Los_Angeles").toISOString(), "2026-11-30T08:01:00.000Z");
  assert.equal(R.parseStart("2026-11-30 13:31", "Asia/Kolkata").toISOString(), "2026-11-30T08:01:00.000Z");
  assert.equal(R.parseStart("2026-07-01 09:00", "Europe/London").toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(R.parseStart("2026-03-08 03:30", "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z");
  assert.equal(R.parseStart("2026-12-10T15:00Z").toISOString(), "2026-12-10T15:00:00.000Z");
  assert.throws(() => R.parseStart("next tuesday"), /Could not read/);
  assert.throws(() => R.parseStart("2026-12-01 10:00", "Mars/Olympus"), /Unknown time zone/);
});

test("links round-trip", () => {
  const link = R.createLink(sample);
  assert.match(link, /^https:\/\/remmynd\.space\/r\/[A-Za-z0-9_-]+$/);
  const back = R.decode(link);
  assert.equal(back.title, sample.title);
  assert.equal(back.start.toISOString(), "2026-12-05T12:30:00.000Z");
  assert.equal(back.durationMinutes, 90);
  assert.equal(back.location, sample.location);
  assert.equal(back.host, "zoof04");
  assert.equal(back.timeZone, "Asia/Kolkata");
  assert.equal(R.decode("https://remmynd.space/#not-a-reminder"), null);
  assert.equal(R.decode("https://remmynd.space/r/not-a-reminder"), null);
});

test("old links still decode", () => {
  // A 1.x link, exactly as published in the README.
  const old = R.decode("https://remmynd.space/#eyJ0IjoiRGVtbyBkYXkiLCJzIjoiaHRxc3UifQ");
  assert.equal(old.title, "Demo day");
  assert.equal(old.start.toISOString(), "2026-12-05T12:30:00.000Z");
  assert.equal(old.timeZone, "");
  // Every 1.x key, plus a key from some future version, which readers must ignore. Same payload in every form.
  const full = Buffer.from(JSON.stringify({ t: "Launch", s: "htqsu", d: 90, l: "Mumbai", n: "Bring a laptop", h: "zoof04", q: 1 })).toString("base64url");
  for (const link of ["https://remmynd.space/#" + full, full, "https://remmynd.space/r/" + full, "remmynd.space/r/" + full + "/"]) {
    const r = R.decode(link);
    assert.ok(r, link);
    assert.deepEqual([r.title, r.durationMinutes, r.location, r.notes, r.host], ["Launch", 90, "Mumbai", "Bring a laptop", "zoof04"], link);
  }
  // A zone the device doesn't know is dropped, not trusted.
  assert.equal(R.decode(Buffer.from(JSON.stringify({ t: "x", s: "htqsu", z: "Mars/Olympus" })).toString("base64url")).timeZone, "");
});

test("shared and private links", () => {
  const shared = R.createLink(sample), priv = R.createLink(sample, { private: true });
  assert.match(shared, /^https:\/\/remmynd\.space\/r\/[A-Za-z0-9_-]+$/);
  assert.match(priv, /^https:\/\/remmynd\.space\/#[A-Za-z0-9_-]+$/);
  assert.equal(shared.split("/r/")[1], priv.split("#")[1], "the same payload in both forms");
  assert.equal(R.toPath(sample), "/r/" + R.encode(sample));
  assert.equal(R.toPath(sample, { private: true }), "/#" + R.encode(sample));
  assert.equal(R.createLink(R.decode(shared)), shared, "decode then createLink gives the same link, zone included");
  assert.ok(R.createLink({ title: "x", start: 0 }, { base: "https://example.com/r", private: true }).startsWith("https://example.com/r/#"));
  assert.ok(R.createLink({ title: "x", start: 0 }, { base: "https://example.com/" }).startsWith("https://example.com/r/"));
  // z is the zone a local time was written in. An exact time on its own carries none.
  assert.equal(R.decode(R.createLink({ title: "x", start: "2026-12-05T18:00Z" })).timeZone, "");
  assert.equal(R.decode(R.createLink({ title: "x", start: "2026-12-05T18:00Z", timeZone: "Europe/London" })).timeZone, "Europe/London");
  assert.throws(() => R.createLink({ title: "x", start: 0, timeZone: "Mars/Olympus" }), /Unknown time zone/);
  // Calendar notes keep a private link private.
  assert.match(R.toICS(sample, { private: true }).replace(/\r\n /g, ""), /Reminder link: https:\/\/remmynd\.space\/#/);
  assert.match(R.toICS(sample).replace(/\r\n /g, ""), /Reminder link: https:\/\/remmynd\.space\/r\//);
  assert.match(decodeURIComponent(R.googleCalendarUrl(sample, { private: true })), /remmynd\.space\/#/);
  assert.match(decodeURIComponent(R.outlookUrl(sample, { private: true })), /remmynd\.space\/#/);
});

test("fromQuery reads hand-written links", () => {
  const q = R.fromQuery("https://remmynd.space/new?t=Demo+day&at=2026-12-05T18:00&tz=Asia/Kolkata&d=90&l=https://lu.ma/demo&n=Bring+a+laptop&h=zoof04");
  assert.deepEqual({ ...q, start: q.start.toISOString() }, { title: "Demo day", start: "2026-12-05T12:30:00.000Z", durationMinutes: 90, location: "https://lu.ma/demo", notes: "Bring a laptop", host: "zoof04", timeZone: "Asia/Kolkata" });
  assert.equal(R.decode(R.createLink(q)).title, "Demo day");
  const off = R.fromQuery({ t: "x", at: "2026-12-05T18:00+05:30" });
  assert.equal(off.start.toISOString(), "2026-12-05T12:30:00.000Z");
  assert.equal(off.timeZone, "", "an offset alone doesn't name a zone");
  assert.equal(R.fromQuery("t=x&at=2026-12-05T18:00Z").start.toISOString(), "2026-12-05T18:00:00.000Z");
  const device = R.fromQuery("t=x&at=2026-12-05T18:00", { timeZone: "America/New_York" });
  assert.equal(device.start.toISOString(), "2026-12-05T23:00:00.000Z");
  assert.equal(device.timeZone, "America/New_York");
  assert.equal(R.fromQuery(new URLSearchParams("t=x&at=2026-12-05T18:00&tz=UTC"), { timeZone: "America/New_York" }).start.toISOString(), "2026-12-05T18:00:00.000Z", "tz wins over the device zone");
  assert.equal(R.fromQuery("t=x&at=2026-12-05T18:00&tz=UTC&d=9999").durationMinutes, 60, "a length out of range falls back to an hour");
  // A web address written without https:// becomes a link, the same ones parse() reads; a place stays a place.
  const where = l => R.fromQuery("t=x&at=2026-12-05T18:00Z&l=" + encodeURIComponent(l)).location;
  for (const [l, want] of [["zoom.us/j/123", "https://zoom.us/j/123"], ["meet.google.com/abc-defg-hij", "https://meet.google.com/abc-defg-hij"], ["www.lu.ma/x", "https://www.lu.ma/x"], ["lu.ma", "https://lu.ma"],
    ["https://lu.ma/demo", "https://lu.ma/demo"], ["Mumbai", "Mumbai"], ["Room 4.2", "Room 4.2"], ["St. Mary Hall", "St. Mary Hall"], ["javascript:alert(1)", "javascript:alert(1)"]]) assert.equal(where(l), want, l);
  for (const l of ["zoom.us/j/123", "Demo day Fri 5pm meet.google.com/abc-defg-hij"]) assert.match(R.parse(l, { now: new Date("2026-11-10T12:00:00Z"), timeZone: "UTC" }).place, /^https:\/\//, "parse agrees: " + l);
  for (const bad of ["at=2026-12-05T18:00&tz=UTC", "t=x&tz=UTC", "t=x&at=tomorrow&tz=UTC", "t=x&at=2026-12-05&tz=UTC", "t=x&at=2026-12-05T18:00&tz=Mars/Base"]) {
    assert.equal(R.fromQuery(bad), null, bad);
  }
});

test("parse: one typed line becomes a reminder", () => {
  // Wednesday 11 November 2026, 10:00 in Kolkata.
  const now = new Date("2026-11-11T04:30:00Z"), timeZone = "Asia/Kolkata";
  const at = (d, h, mi = 0, mo = 11, y = 2026) => R.zonedTime(y, mo, d, h, mi, timeZone).toISOString();
  const cases = [
    // line, title, start, dur, place
    ["Demo day Fri 5pm zoom.us/j/123", "Demo day", at(13, 17), null, "https://zoom.us/j/123"],
    ["Call Mum tomorrow 7:30pm", "Call Mum", at(12, 19, 30), null],
    ["Rent due 1st", "Rent due", at(1, 9, 0, 12), null],
    ["Standup today 9:30am", "Standup", at(11, 9, 30), null],
    ["Gym tonight", "Gym", at(11, 20), null],
    ["Dinner tonight at 8", "Dinner", at(11, 20), null],
    ["Lunch at noon", "Lunch", at(11, 12), null],
    ["Pay bill midnight", "Pay bill", at(12, 0), null],
    ["Webinar 17:00", "Webinar", at(11, 17), null],
    ["Webinar 9:00", "Webinar", at(12, 9), null],
    ["Coffee in 2 hours", "Coffee", at(11, 12), null],
    ["Tea in 30 min", "Tea", at(11, 10, 30), null],
    ["Review in an hour", "Review", at(11, 11), null],
    ["Sync Fri 3pm for 30 min", "Sync", at(13, 15), 30],
    ["Workshop 13 Nov 2pm for 2 hours", "Workshop", at(13, 14), 120],
    ["Launch Nov 13", "Launch", at(13, 9), null],
    ["Party 13/11 7pm", "Party", at(13, 19), null],
    ["Meeting 11/13 10am", "Meeting", at(13, 10), null],
    ["Exam 2026-12-05", "Exam", at(5, 9, 0, 12), null],
    ["Exam 2026-12-05T14:30", "Exam", at(5, 14, 30, 12), null],
    ["Dentist next Friday 4pm", "Dentist", at(20, 16), null],
    ["Yoga next Monday", "Yoga", at(16, 9), null],
    ["Board call Monday 11am", "Board call", at(16, 11), null],
    ["Status Wed 5pm", "Status", at(11, 17), null],
    ["Status Wed 9am", "Status", at(18, 9), null],
    ["Coffee with Sam at Blue Tokai tomorrow 10am", "Coffee with Sam", at(12, 10), null, "Blue Tokai"],
    ["Book club at Sam's place", "Book club", null, null, "Sam's place"],
    ["Lunch at 1", "Lunch", at(11, 13), null],
    ["Gym at 7", "Gym", at(12, 7), null],
    ["Movie 5-7pm Sat", "Movie", at(14, 17), 120],
    ["Standup 17:00-17:15", "Standup", at(11, 17), 15],
    ["Release on the 20th", "Release", at(20, 9), null],
    ["New year party 31 Dec 9pm", "New year party", at(31, 21, 0, 12), null],
    ["Holiday Jan 2", "Holiday", at(2, 9, 0, 1, 2027), null],
    ["Call https://meet.google.com/abc-defg-hij at 6pm", "Call", at(11, 18), null, "https://meet.google.com/abc-defg-hij"],
    ["Live www.youtube.com/live tomorrow 8pm", "Live", at(12, 20), null, "https://www.youtube.com/live"],
    ["Lunch lu.ma tomorrow 1pm", "Lunch", at(12, 13), null, "https://lu.ma"],
    ["Just a title", "Just a title", null, null],
    ["", "", null, null],
    ["Deadline Fri midnight", "Deadline", at(14, 0), null],
    ["Run tomorrow morning", "Run", at(12, 9), null],
    ["Drinks Friday evening", "Drinks", at(13, 19), null],
    ["Picnic in the sun Sunday", "Picnic in the sun", at(15, 9), null],
    ["Train 6.45pm", "Train", at(11, 18, 45), null],
    ["Sale ends 5 p.m. tomorrow", "Sale ends", at(12, 17), null],
    ["Demo day - Fri 5pm", "Demo day", at(13, 17), null],
    ["Webinar 10am UTC", "Webinar", "2026-11-11T10:00:00.000Z", null],
    ["Fri 5pm", "", at(13, 17), null],
    ["Sat 5pm chores", "chores", at(14, 17), null],
    ["sat 5pm chores", "sat chores", at(11, 17), null]
  ];
  for (const [line, title, start, dur, place = ""] of cases) {
    const r = R.parse(line, { now, timeZone });
    assert.deepEqual([r.title, r.start && r.start.toISOString(), r.dur, r.place], [title, start, dur, place], JSON.stringify(line));
  }
  assert.ok(cases.length >= 40, "at least 40 cases");
  // On the 1st after 9:00, "the 1st" is next month's; the 31st skips months without one.
  const dec1 = new Date("2026-12-01T05:00:00Z");
  assert.equal(R.parse("Rent due 1st", { now: dec1, timeZone }).start.toISOString(), R.zonedTime(2027, 1, 1, 9, 0, timeZone).toISOString());
  assert.equal(R.parse("Pay 31st", { now: new Date("2027-04-02T05:00:00Z"), timeZone }).start.toISOString(), R.zonedTime(2027, 5, 31, 9, 0, timeZone).toISOString());
  const r = R.parse("Demo day Fri 5pm zoom.us/j/123", { now, timeZone });
  assert.deepEqual(r.tokens.map(t => [t.type, t.text]), [["place", "zoom.us/j/123"], ["date", "Fri"], ["time", "5pm"]]);
});

test("parse: pasted invitations", () => {
  const now = new Date("2026-11-11T04:30:00Z"), timeZone = "Asia/Kolkata";
  const at = (d, h, mi = 0) => R.zonedTime(2026, 11, d, h, mi, timeZone).toISOString();
  const cases = [
    ["You're invited: Product launch\nWhen: Friday, November 13, 2026 5:00 PM – 6:00 PM (IST)\nWhere: https://zoom.us/j/123456?pwd=abc",
      "Product launch", at(13, 17), 60, "https://zoom.us/j/123456?pwd=abc"],
    ["Demo day\nFriday 13 Nov 2026 ⋅ 5:00 – 6:00pm\nIndia Standard Time - Kolkata\nJoining info: meet.google.com/abc-defg-hij",
      "Demo day", at(13, 17), 60, "https://meet.google.com/abc-defg-hij"],
    ["Invitation: Demo day @ Fri 13 Nov 2026 5pm - 6pm (IST) (sam@example.com)", "Demo day", at(13, 17), 60, ""],
    ["Town hall\nDate: 2026-11-20\nTime: 15:00 (GMT+00:00)\nLocation: Main hall", "Town hall", "2026-11-20T15:00:00.000Z", null, "Main hall"],
    ["Weekly sync\nJoin Zoom Meeting\nhttps://us02web.zoom.us/j/8812345678\nMeeting ID: 881 234 5678\nPasscode: 4242\nThursday 2pm", "Weekly sync", at(12, 14), null, "https://us02web.zoom.us/j/8812345678"]
  ];
  for (const [text, title, start, dur, place] of cases) {
    const r = R.parse(text, { now, timeZone });
    assert.deepEqual([r.title, r.start && r.start.toISOString(), r.dur, r.place], [title, start, dur, place], text.split("\n")[0]);
  }
  // A parsed line makes the same link the library makes from the same parts.
  const p = R.parse("Demo day Fri 5pm zoom.us/j/123", { now, timeZone });
  assert.equal(R.decode(R.createLink({ title: p.title, start: p.start, location: p.place, timeZone })).location, "https://zoom.us/j/123");
});

test("ring: the moment ring follows section 8", async () => {
  const ring = await import("../public/ring.js");
  // Noon at the top, midnight at the bottom, clockwise.
  assert.deepEqual([ring.angle(12), ring.angle(18), ring.angle(0), ring.angle(11, 30), ring.angle(22)], [0, 90, -180, -7.5, 150]);
  assert.deepEqual([ring.point(0, 44), ring.point(90, 44), ring.point(180, 44)], [[60, 16], [104, 60], [60, 104]]);
  // Night arc: radius 33, from 22:00 (150 degrees) clockwise to 06:00 (270 degrees), exactly as in mock-up 04.
  assert.equal(ring.arc(150, 270, 33), "M76.5 88.58A33 33 0 0 1 27 60");
  // Mock-up 04's dial at 11:30: the dot on radius 44, the hand to radius 30, the gap 18 degrees each side.
  const svg = ring.ringSVG({ h: 11, m: 30 });
  assert.match(svg, /class="r-dot" cx="54.26" cy="16.38" r="8"/);
  assert.match(svg, /class="r-hand" d="M60 60L56.08 30.26" stroke-width="5"/);
  assert.match(svg, /class="r-ring" cx="60" cy="60" r="44" pathLength="360" stroke-width="5" stroke-linecap="round" transform="rotate\(-79.5 60 60\)"/);
  const near = (p, q) => Math.abs(p[0] - q[0]) < 0.02 && Math.abs(p[1] - q[1]) < 0.02;
  assert.ok(near(ring.point(-7.5 + 18, 44), [68.02, 16.73]) && near(ring.point(-7.5 - 18, 44), [41.06, 20.29]), "gap ends match the mock-up");
  assert.match(svg, /class="r-night" d="M76.5 88.58A33 33 0 0 1 27 60" stroke-width="8"/);
  assert.match(svg, /class="r-pivot" cx="60" cy="60" r="4"/);
  assert.match(svg, /class="r-disc" cx="60" cy="60" r="46"/);
  assert.match(svg, /class="r-check" d="M42 62l12 12 24-27" stroke-width="6"/);
  assert.match(svg, /class="r-halo" cx="54.26" cy="16.38" r="15"/);
  assert.match(svg, /role="img" aria-label="Day dial showing 11:30 in the morning, reminder not set yet"/);
  // Every state draws and says what it is, with the time in words.
  for (const st of ring.STATES) assert.match(ring.ringSVG({ h: 17, state: st }), new RegExp('class="ring ring-' + st + '"'));
  assert.match(ring.ringSVG({ h: 1, state: "nope" }), /class="ring ring-open"/);
  assert.deepEqual([["held", 17, 0], ["soon", 9, 5], ["now", 0, 0], ["kept", 12, 30], ["missed", 21, 15]].map(([st, h, m]) => ring.ringLabel(h, m, st)), [
    "Day dial showing 5:00 in the afternoon, reminder set", "Day dial showing 9:05 in the morning, starting soon",
    "Day dial showing 12:00 at night, happening now", "Day dial showing 12:30 in the afternoon, done", "Day dial showing 9:15 at night, missed"]);
  assert.match(ring.ringSVG({ h: 1, label: 'a "b" <c>' }), /aria-label="a &quot;b&quot; &lt;c>"/);
  // The states themselves live in app.css: a 36-degree gap that closes in 320 ms, the disc for Now, muted for Missed.
  const css = readFileSync(join(root, "public/app.css"), "utf8");
  for (const rule of [".ring .r-night{stroke:var(--night-arc)}", ".ring .r-ring{stroke:var(--ink);stroke-dasharray:324 36;transition:stroke-dasharray .32s var(--spring)",
    ".ring-held .r-ring,.ring-soon .r-ring,.ring-kept .r-ring{stroke-dasharray:360 0}", ".ring .r-out{fill:var(--card)", ".ring-soon .r-halo{display:block;fill:var(--moment);opacity:.28",
    ".ring-now .r-disc{display:block;fill:var(--moment)}", ".ring-now .r-pivot,.ring-now .r-dot{fill:var(--on-moment)}", ".ring-kept .r-hand,.ring-kept .r-pivot{display:none}",
    ".ring-missed .r-ring,.ring-missed .r-hand{stroke:var(--muted)}", ".ring-missed .r-dot{fill:var(--card);stroke:var(--muted)"]) assert.ok(css.includes(rule), "app.css: " + rule);
});

test("validation", () => {
  assert.throws(() => R.encode({ start: "2026-12-01 10:00" }), /title is required/);
  assert.throws(() => R.encode({ title: "x", start: "2026-12-01 10:00", durationMinutes: 0 }), /durationMinutes/);
});

test("ics: valid structure, folded lines, alerts, credit", () => {
  const ics = R.toICS(sample);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "only CRLF line breaks");
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, "line too long: " + line);
  assert.match(ics, /DTSTART:20261205T123000Z/);
  assert.match(ics, /DTEND:20261205T140000Z/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /TRIGGER:PT0M/);
  assert.match(ics.replace(/\r\n /g, ""), /Made with remmynd\.space/);
});

test("calendar URLs carry the credit line", () => {
  assert.match(decodeURIComponent(R.googleCalendarUrl(sample)), /Made with remmynd\.space/);
  assert.match(R.outlookUrl(sample, { office: true }), /^https:\/\/outlook\.office\.com\//);
});

test("website and library produce the same links", () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8");
  const pick = name => app.split("\n").find(l => l.startsWith("const " + name + "="));
  const siteEnc = new Function(pick("enc") + "; return enc;")();
  const siteDec = new Function(pick("dec") + "; return dec;")();
  const frag = R.encode(sample);
  const fromSite = siteDec(frag);
  assert.equal(fromSite.t, sample.title);
  assert.equal(parseInt(fromSite.s, 36) * 60000, Date.parse("2026-12-05T12:30:00Z"));
  const siteFrag = siteEnc({ t: "Café launch", s: Math.round(Date.parse("2026-12-24T10:00:00Z") / 60000).toString(36), l: "Mumbai" });
  const lib = R.decode(siteFrag);
  assert.equal(lib.title, "Café launch");
  assert.equal(lib.location, "Mumbai");
  assert.equal(lib.start.toISOString(), "2026-12-24T10:00:00.000Z");

  // Shared and private links, with the host's zone last, match the library byte for byte.
  const siteLink = new Function("BASE", pick("enc") + ";" + pick("linkFor") + "; return linkFor;")("https://remmynd.space/");
  const start = new Date("2026-12-24T10:00:00Z");
  const r = { t: "Café launch", s: Math.round(start.getTime() / 60000).toString(36), l: "Mumbai", z: "Asia/Kolkata" };
  const ev = { title: "Café launch", start, location: "Mumbai", timeZone: "Asia/Kolkata" };
  assert.equal(siteLink(r, null, false), R.createLink(ev));
  assert.equal(siteLink(r, null, true), R.createLink(ev, { private: true }));
  assert.match(app, /R\.createLink\(ev,\{base:BASE,private:F\.priv\.checked\}\)/, "the maker makes links with the library itself");
  assert.match(app, /^import \* as R from "\/remmynd\.js";$/m, "app.js imports the library");
});

test("website script parses", () => {
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\s*>([\s\S]*?)<\/script\b[^>]*>/gi)].map(m => m[1]);
  assert.equal(scripts.length, 1, "only the theme line stays inline; the app is app.js");
  for (const js of scripts) assert.doesNotThrow(() => new Function(js), "inline script has a syntax error");
  assert.match(html, /<script src="\/db\.js" defer><\/script>\n<script type="module" src="\/app\.js"><\/script>\n<script src="\/push\.js" defer><\/script>/, "db.js, then app.js, then push.js");
  const app = readFileSync(join(root, "public/app.js"), "utf8").replace(/^import .*$/gm, "");
  assert.doesNotThrow(() => new Function(app), "public/app.js has a syntax error");
  for (const f of ["sw.js", "db.js"]) assert.doesNotThrow(() => new Function(readFileSync(join(root, "public", f), "utf8")), "public/" + f + " has a syntax error");
});

test("styles: app.css carries the 2.0 tokens and self-hosted fonts", () => {
  const css = readFileSync(join(root, "public/app.css"), "utf8");
  const tokens = readFileSync(join(root, "docs/v2/tokens.css"), "utf8");
  const tokenBlock = tokens.slice(0, tokens.indexOf("/* How the mock-up values")).trim();
  assert.ok(css.includes(tokenBlock), "public/app.css holds docs/v2/tokens.css unchanged");
  const components = css.slice(css.indexOf("/* ---------- theme switch support"));
  assert.ok(components.length > 1000, "component styles follow the tokens");
  assert.doesNotMatch(components, /#[0-9a-f]{3,8}\b|rgba?\(/i, "components use token names, not raw colours");

  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(m => m[1]);
  assert.deepEqual(faces.map(f => /font-family:\s*"([^"]+)"/.exec(f)[1]), ["Geist", "Geist Mono"]);
  for (const f of faces) {
    assert.match(f, /font-display:\s*swap/);
    const file = /url\("([^"]+)"\)/.exec(f)[1];
    assert.ok(statSync(join(root, "public", file)).size > 10000, file + " is in public/");
  }
  assert.match(readFileSync(join(root, "public/fonts/OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);

  const html = readFileSync(join(root, "public/index.html"), "utf8");
  assert.ok(!/<style[\s>]/.test(html), "no inline style block left in index.html");
  assert.ok(!/\sstyle="/.test(html), "no inline style attributes left in index.html");
  assert.match(html, /<link rel="stylesheet" href="\/app\.css">/);
  for (const f of readdirSync(join(root, "public")).filter(f => /\.(html|css|js|webmanifest)$/.test(f))) {
    assert.doesNotMatch(readFileSync(join(root, "public", f), "utf8"), /fonts\.(googleapis|gstatic)\.com/, f + " loads Google Fonts");
  }
  const sw = readFileSync(join(root, "public/sw.js"), "utf8");
  for (const f of ["./app.css", "./fonts/geist-5.3-latin.woff2", "./fonts/geist-mono-5.3-latin.woff2"]) assert.ok(sw.includes('"' + f + '"'), "sw.js caches " + f);
});

test("theme switch: Auto, Light and Dark, kept in rm:theme, with matching theme-color", () => {
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  const tokens = readFileSync(join(root, "docs/v2/tokens.css"), "utf8");
  const light = /:root\s*{[^}]*--paper:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)[1];
  const dark = /:root\[data-theme="dark"\]\s*{[^}]*--paper:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)[1];
  assert.match(html, new RegExp('id="tc-light" content="' + light + '" media="\\(prefers-color-scheme: light\\)"'));
  assert.match(html, new RegExp('id="tc-dark" content="' + dark + '" media="\\(prefers-color-scheme: dark\\)"'));
  // One switch in the footer and one in the menu, each Auto, Light, Dark.
  assert.deepEqual([...html.matchAll(/data-theme-set="(\w+)"[^>]*>(\w+)</g)].map(m => m[1] + ":" + m[2]), ["auto:Auto", "light:Light", "dark:Dark", "auto:Auto", "light:Light", "dark:Dark"]);
  assert.match(html, /<head>[\s\S]*localStorage\.getItem\("rm:theme"\)[\s\S]*<link rel="stylesheet" href="\/app\.css">/, "saved theme is applied before styles load");

  // Run the page's theme code against a tiny fake document.
  const appJs = readFileSync(join(root, "public/app.js"), "utf8");
  const src = appJs.slice(appJs.indexOf("const PAPER="), appJs.indexOf("/* ---------- install (PWA)"));
  const metas = { "#tc-light": { content: "" }, "#tc-dark": { content: "" } };
  const buttons = ["auto", "light", "dark"].map(t => { const b = { dataset: { themeSet: t }, attrs: {}, on: {} }; b.setAttribute = (k, v) => { b.attrs[k] = v; }; b.addEventListener = (e, f) => { b.on[e] = f; }; return b; });
  const docEl = { dataset: {} };
  const store = new Map();
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const document = { documentElement: docEl, querySelectorAll: () => buttons };
  new Function("$", "document", "localStorage", src)(s => metas[s], document, localStorage);
  const pressed = () => buttons.filter(b => b.attrs["aria-pressed"] === "true").map(b => b.dataset.themeSet);

  assert.deepEqual(pressed(), ["auto"]);
  assert.equal(docEl.dataset.theme, undefined);
  assert.deepEqual([metas["#tc-light"].content, metas["#tc-dark"].content], [light, dark]);
  buttons[2].on.click();
  assert.equal(docEl.dataset.theme, "dark");
  assert.equal(store.get("rm:theme"), "dark");
  assert.deepEqual([metas["#tc-light"].content, metas["#tc-dark"].content], [dark, dark]);
  assert.deepEqual(pressed(), ["dark"]);
  buttons[1].on.click();
  assert.deepEqual([docEl.dataset.theme, store.get("rm:theme"), metas["#tc-dark"].content], ["light", "light", light]);
  buttons[0].on.click();
  assert.equal(docEl.dataset.theme, undefined);
  assert.equal(store.has("rm:theme"), false, "Auto clears the saved choice");
});

test("worker: /ics file, www redirect, named pages, static passthrough", async () => {
  const worker = (await import("../worker/index.js")).default;
  const env = { ASSETS: { fetch: () => new Response("static", { status: 200 }) } };
  const s = Math.round(Date.parse("2026-12-05T12:30:00Z") / 60000).toString(36);
  const d = Buffer.from(JSON.stringify({ t: "Demo day", s, l: "https://lu.ma/demo", u: "https://remmynd.space/#x" })).toString("base64url");

  const ics = await worker.fetch(new Request("https://remmynd.space/ics?d=" + d), env);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get("content-type"), /text\/calendar/);
  const body = await ics.text();
  assert.match(body, /SUMMARY:Demo day/);
  assert.match(body, /DTSTART:20261205T123000Z/);
  assert.match(body.replace(/\r\n /g, ""), /Made with remmynd\.space/);

  assert.equal((await worker.fetch(new Request("https://remmynd.space/ics?d=broken"), env)).status, 400);
  assert.equal((await worker.fetch(new Request("https://remmynd.space/ics", { method: "POST" }), env)).status, 405);

  const www = await worker.fetch(new Request("https://www.remmynd.space/abc?x=1"), env);
  assert.equal(www.status, 301);
  assert.equal(www.headers.get("location"), "https://remmynd.space/abc?x=1");

  const ex = await worker.fetch(new Request("https://remmynd.space/example"), env);
  assert.equal(ex.status, 302);
  assert.equal(ex.headers.get("location"), "https://remmynd.space/#example");

  assert.equal(await (await worker.fetch(new Request("https://remmynd.space/badge.svg"), env)).text(), "static");
});

// Just enough of Cloudflare's HTMLRewriter for the Worker's routes: remove elements matched by
// tag or tag[attr="value"], append HTML at the end of <head>, and replace what is inside #id.
class TestRewriter {
  constructor() { this.rules = []; }
  on(selector, handler) { this.rules.push([selector, handler]); return this; }
  transform(res) {
    const rules = this.rules;
    const body = new ReadableStream({ async start(c) {
      let html = await res.text();
      for (const [selector, h] of rules) {
        if (selector.startsWith("#")) {
          const open = new RegExp("<([a-z]+)\\b[^>]*\\bid=\"" + selector.slice(1) + "\"[^>]*>").exec(html);
          assert.ok(open, "the page has " + selector);
          const from = open.index + open[0].length, to = html.indexOf("</" + open[1] + ">", from);
          let inner = null;
          h.element({ setInnerContent: (c, o) => { assert.ok(o && o.html, "set as HTML"); inner = c; } });
          if (inner !== null) html = html.slice(0, from) + inner + html.slice(to);
          continue;
        }
        const [, tag, attr, val] = /^([a-z]+)(?:\[([a-z:-]+)="([^"]*)"\])?$/.exec(selector);
        if (tag === "head") {
          let extra = "";
          h.element({ append: (s, o) => { assert.ok(o && o.html, "preview tags are appended as HTML"); extra += s; } });
          html = html.replace("</head>", extra + "</head>");
          continue;
        }
        const re = tag === "title" ? /<title\b[^>]*>[\s\S]*?<\/title>/g : new RegExp("<" + tag + "\\b[^>]*>", "g");
        html = html.replace(re, el => {
          if (attr && !el.includes(attr + '="' + val + '"')) return el;
          let gone = false;
          h.element({ remove: () => { gone = true; } });
          return gone ? "" : el;
        });
      }
      c.enqueue(new TextEncoder().encode(html));
      c.close();
    } });
    return new Response(body, res);
  }
}

function shellEnv() {
  const shell = readFileSync(join(root, "public/index.html"), "utf8");
  return { ASSETS: { fetch: req => new URL(req.url).pathname === "/"
    ? new Response(shell, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600", etag: '"shell"' } })
    : new Response("static") } };
}

test("worker: /r/ links get escaped preview tags and are never cached", async () => {
  const worker = (await import("../worker/index.js")).default;
  const env = shellEnv();
  const saved = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = TestRewriter;
  try {
    const get = async path => { const res = await worker.fetch(new Request("https://remmynd.space" + path), env); return { res, html: await res.text() }; };
    const count = (html, re) => (html.match(re) || []).length;
    const path = R.toPath({ title: "Demo day", start: "2026-11-13 17:00", timeZone: "Asia/Kolkata" });
    const { res, html } = await get(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    assert.equal(res.headers.get("etag"), null);
    assert.ok(html.includes("<title>Demo day · remmynd</title>"));
    assert.ok(html.includes('<meta property="og:title" content="Demo day">'));
    assert.ok(html.includes('<meta property="og:description" content="Fri 13 Nov, 5:00 PM IST · Tap to get reminded">'));
    assert.ok(html.includes('<meta name="twitter:title" content="Demo day">'));
    assert.ok(html.includes('<meta name="twitter:description" content="Fri 13 Nov, 5:00 PM IST · Tap to get reminded">'));
    assert.ok(html.includes('<meta property="og:url" content="https://remmynd.space' + path + '">'));
    assert.ok(html.includes('<meta property="og:image" content="https://remmynd.space/og.png">'), "the image stays the static og.png");
    assert.equal(count(html, /property="og:title"/g), 1);
    assert.equal(count(html, /<title>/g), 1);
    assert.equal(count(html, /rel="canonical"/g), 0);

    // A hostile title stays text.
    const evil = '"><script>alert(1)</script><meta x="';
    const e = await get(R.toPath({ title: evil, start: "2026-11-13 17:00", timeZone: "Asia/Kolkata" }));
    assert.ok(!e.html.includes("<script>alert(1)"), "no script injected");
    assert.ok(e.html.includes('<meta property="og:title" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;meta x=&quot;">'));
    assert.ok(e.html.includes("<title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;meta x=&quot; · remmynd</title>"));

    // No zone in the link: the time is printed in UTC.
    const u = await get(R.toPath({ title: "Launch", start: "2026-11-13T11:30Z" }));
    assert.ok(u.html.includes('<meta property="og:description" content="Fri 13 Nov, 11:30 AM UTC · Tap to get reminded">'));

    // Bad payloads get the plain shell, still never cached.
    const noTitle = Buffer.from(JSON.stringify({ t: "", s: "htqsu" })).toString("base64url");
    for (const bad of ["/r/", "/r/zzz", "/r/" + "a".repeat(2001), "/r/abc%3Cdef", "/r/" + noTitle]) {
      const b = await get(bad);
      assert.equal(b.res.status, 200, bad);
      assert.equal(b.res.headers.get("cache-control"), "no-store", bad);
      assert.ok(b.html.includes('<meta property="og:title" content="remmynd">'), bad + " gets the plain shell");
    }
    assert.equal((await worker.fetch(new Request("https://remmynd.space" + path, { method: "POST" }), env)).status, 405);
  } finally { globalThis.HTMLRewriter = saved; }
});

test("worker: /new redirects exact times to the /r/ link", async () => {
  const worker = (await import("../worker/index.js")).default;
  const env = shellEnv();
  const go = q => worker.fetch(new Request("https://remmynd.space/new?" + q), env);

  let res = await go("t=Demo+day&at=2026-12-05T18:00&tz=Asia/Kolkata&d=90&l=https://lu.ma/demo");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const to = res.headers.get("location");
  assert.match(to, /^https:\/\/remmynd\.space\/r\/[A-Za-z0-9_-]+$/);
  const r = R.decode(to);
  assert.deepEqual([r.title, r.start.toISOString(), r.durationMinutes, r.location, r.timeZone], ["Demo day", "2026-12-05T12:30:00.000Z", 90, "https://lu.ma/demo", "Asia/Kolkata"]);
  assert.equal(to, R.createLink(R.fromQuery("t=Demo+day&at=2026-12-05T18:00&tz=Asia/Kolkata&d=90&l=https://lu.ma/demo")), "the Worker and the library make the same link");

  res = await go("t=Demo&at=2026-12-05T18:00Z");
  assert.equal(res.status, 302);
  assert.equal(R.decode(res.headers.get("location")).start.toISOString(), "2026-12-05T18:00:00.000Z");
  res = await go("t=Demo&at=2026-12-05T18:00%2B05:30");
  assert.equal(R.decode(res.headers.get("location")).start.toISOString(), "2026-12-05T12:30:00.000Z");

  // No zone, or something missing: the shell, which reads the time in the visitor's zone or opens the maker.
  for (const q of ["t=Demo&at=2026-12-05T18:00", "at=2026-12-05T18:00&tz=UTC", "t=Demo&at=soon&tz=UTC", "t=Demo&at=2026-12-05T18:00&tz=Mars/Base"]) {
    res = await go(q);
    assert.equal(res.status, 200, q);
    assert.equal(res.headers.get("cache-control"), "no-store", q);
    assert.match(await res.text(), /<title>remmynd<\/title>/, q);
  }
  assert.equal((await worker.fetch(new Request("https://remmynd.space/new?t=x", { method: "POST" }), env)).status, 405);
});

test("connector: an MCP server that makes and reads reminder links, and stores nothing", async () => {
  const worker = (await import("../worker/index.js")).default;
  const { TOOLS, SUPPORTED } = await import("../worker/mcp.js");
  const env = shellEnv();
  const V = "2026-07-28";
  const meta = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
  const post = (body, headers = {}) => worker.fetch(new Request("https://remmynd.space/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), env);
  // A modern request: version in _meta and in the headers, which must match the body.
  const call = (method, params = {}, headers) => post({ jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: meta } },
    { "mcp-protocol-version": V, "mcp-method": method, ...(method === "tools/call" ? { "mcp-name": params.name } : {}), ...headers });
  const json = async res => ({ status: res.status, body: await res.json() });
  const tool = async (name, args) => (await json(await call("tools/call", { name, arguments: args }))).body.result;

  // Discovery and the tool list.
  let r = await json(await call("server/discover"));
  assert.equal(r.status, 200);
  assert.equal(r.body.result.resultType, "complete");
  assert.deepEqual(r.body.result.supportedVersions, SUPPORTED);
  assert.ok(SUPPORTED.includes("2026-07-28") && SUPPORTED.includes("2025-06-18"));
  assert.deepEqual(r.body.result.capabilities, { tools: {} });
  assert.equal(r.body.result._meta["io.modelcontextprotocol/serverInfo"].name, "remmynd");
  assert.match(r.body.result.instructions, /IANA time zone/);
  r = await json(await call("tools/list"));
  assert.deepEqual(r.body.result.tools.map(t => t.name), ["make_reminder_link", "make_reminder_from_text", "read_reminder_link"], "always the same order");
  for (const t of r.body.result.tools) {
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.openWorldHint, false, t.name);
    assert.ok(t.outputSchema && t.description && t.title, t.name);
  }
  assert.deepEqual(r.body.result.tools, TOOLS);

  // make_reminder_link: the same link the library and the website make.
  let out = await tool("make_reminder_link", { title: "Demo day", start: "2026-12-04T17:00", time_zone: "Asia/Kolkata", duration_minutes: 90, location: "https://lu.ma/demo", host: "Northwind" });
  assert.equal(out.isError, false);
  assert.equal(out.resultType, "complete");
  const expected = R.createLink({ title: "Demo day", start: "2026-12-04T17:00", timeZone: "Asia/Kolkata", durationMinutes: 90, location: "https://lu.ma/demo", host: "Northwind" });
  assert.equal(out.structuredContent.link, expected);
  assert.deepEqual([out.structuredContent.starts_at, out.structuredContent.time_zone, out.structuredContent.duration_minutes, out.structuredContent.private], ["2026-12-04T11:30:00.000Z", "Asia/Kolkata", 90, false]);
  assert.equal(out.content[0].text, "Demo day · Fri 4 Dec, 5:00 PM IST · 1 h 30 min · https://lu.ma/demo\n" + expected);
  assert.deepEqual(JSON.parse(out.content[1].text), out.structuredContent, "the structured result also comes as JSON text");
  out = await tool("make_reminder_link", { title: "Demo day", start: "2026-12-04T11:30Z", private: true });
  assert.match(out.structuredContent.link, /^https:\/\/remmynd\.space\/#[A-Za-z0-9_-]+$/, "a private link keeps everything after #");
  assert.match(out.content[0].text, /Private link/);

  // Mistakes come back as tool errors the assistant can fix, not protocol errors.
  for (const [args, said] of [
    [{ title: "Demo", start: "2026-12-04T17:00" }, /Which time zone/],
    [{ title: "Demo", start: "2026-12-04T17:00", time_zone: "Mars/Base" }, /isn't a time zone/],
    [{ title: " ", start: "2026-12-04T17:00Z" }, /title/],
    [{ title: "Demo", start: "soon", time_zone: "UTC" }, /Could not read the time/],
    [{ title: "Demo", start: "2026-12-04T17:00Z", duration_minutes: 0 }, /1 to 1440/]
  ]) {
    out = await tool("make_reminder_link", args);
    assert.equal(out.isError, true, JSON.stringify(args));
    assert.match(out.content[0].text, said);
  }

  // make_reminder_from_text reads a line like the bar does, in the person's zone.
  out = await tool("make_reminder_from_text", { text: "Dentist Tue 4pm at Smile Clinic", time_zone: "Europe/London", now: "2026-11-11T10:00:00Z" });
  assert.equal(out.isError, false);
  assert.deepEqual([out.structuredContent.title, out.structuredContent.starts_at, out.structuredContent.location, out.structuredContent.time_zone], ["Dentist", "2026-11-17T16:00:00.000Z", "Smile Clinic", "Europe/London"]);
  out = await tool("make_reminder_from_text", { text: "Standup tomorrow 9:30 for 15 min https://meet.example/abc", time_zone: "Asia/Kolkata", now: "2026-11-11T10:00:00Z" });
  assert.deepEqual([out.structuredContent.starts_at, out.structuredContent.duration_minutes, out.structuredContent.location], ["2026-11-12T04:00:00.000Z", 15, "https://meet.example/abc"]);
  out = await tool("make_reminder_from_text", { text: "Dentist sometime", time_zone: "Europe/London" });
  assert.equal(out.isError, true);
  assert.match(out.content[0].text, /No day or time/);
  out = await tool("make_reminder_from_text", { text: "Dentist Tue 4pm", time_zone: "nowhere" });
  assert.equal(out.isError, true);

  // read_reminder_link reads both kinds of link, and says plainly when it isn't one.
  out = await tool("read_reminder_link", { link: expected });
  assert.deepEqual([out.structuredContent.title, out.structuredContent.duration_minutes, out.structuredContent.host, out.structuredContent.link], ["Demo day", 90, "Northwind", expected]);
  out = await tool("read_reminder_link", { link: "https://example.com/hello" });
  assert.equal(out.isError, true);

  // Protocol errors: unknown tool and method, unsupported version, headers that don't match the body.
  r = await json(await call("tools/call", { name: "delete_everything", arguments: {} }));
  assert.equal(r.body.error.code, -32602);
  r = await json(await call("prompts/list"));
  assert.deepEqual([r.status, r.body.error.code], [404, -32601]);
  r = await json(await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" } } }, { "mcp-protocol-version": "1900-01-01", "mcp-method": "tools/list" }));
  assert.deepEqual([r.status, r.body.error.code, r.body.error.data.supported], [400, -32022, SUPPORTED]);
  for (const h of [{ "mcp-method": "tools/list" }, { "mcp-protocol-version": "2025-11-25" }, { "mcp-name": "read_reminder_link" }]) {
    r = await json(await call("tools/call", { name: "make_reminder_link", arguments: {} }, h));
    assert.deepEqual([r.status, r.body.error.code], [400, -32020], JSON.stringify(h));
  }
  r = await json(await call("tools/list", {}, { "mcp-method": "tools/call" }));
  assert.deepEqual([r.status, r.body.error.code], [400, -32020]);
  const b64 = "=?base64?" + Buffer.from("read_reminder_link").toString("base64") + "?=";
  r = await json(await call("tools/call", { name: "read_reminder_link", arguments: { link: expected } }, { "mcp-name": b64 }));
  assert.equal(r.body.result.isError, false, "an encoded Mcp-Name is decoded before it's compared");

  // Legacy clients: initialize, then plain requests, with no session id minted.
  let res = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } } });
  r = await json(res);
  assert.deepEqual([r.body.result.protocolVersion, r.body.result.capabilities, r.body.result.serverInfo.name], ["2025-06-18", { tools: { listChanged: false } }, "remmynd"]);
  assert.equal(res.headers.get("mcp-session-id"), null);
  r = await json(await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-01-01" } }));
  assert.equal(r.body.result.protocolVersion, "2025-11-25", "an unknown version gets the newest handshake version");
  assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-protocol-version": "2025-06-18" })).status, 202);
  r = await json(await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" }));
  assert.equal(r.body.result.tools.length, 3);
  assert.equal(r.body.result.resultType, undefined, "legacy results keep the legacy shape");
  r = await json(await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "make_reminder_link", arguments: { title: "Demo day", start: "2026-12-04T17:00", time_zone: "Asia/Kolkata", duration_minutes: 90, location: "https://lu.ma/demo", host: "Northwind" } } }));
  assert.equal(r.body.result.structuredContent.link, expected, "no header at all reads as 2025-03-26");
  assert.equal((await json(await post({ jsonrpc: "2.0", id: 4, method: "ping" }))).body.result.resultType, undefined);

  // Transport rules: GET has no stream, a browser gets the docs, bad origins, bodies and batches are refused.
  const get = headers => worker.fetch(new Request("https://remmynd.space/mcp", { headers }), env);
  assert.equal((await get({ accept: "text/event-stream" })).status, 405);
  res = await get({ accept: "text/html,application/xhtml+xml" });
  assert.deepEqual([res.status, res.headers.get("location")], [302, "https://remmynd.space/docs#connector"]);
  assert.equal((await worker.fetch(new Request("https://remmynd.space/mcp", { method: "DELETE" }), env)).status, 405);
  assert.equal((await worker.fetch(new Request("https://remmynd.space/mcp", { method: "OPTIONS" }), env)).status, 204);
  assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "null" })).status, 403);
  assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://app.example" })).status, 200);
  assert.equal((await post("{nope")).status, 400);
  assert.equal((await post([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status, 400);
  assert.equal((await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(40000) } }))).status, 413);
  assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "text/plain" })).status, 415);
  res = await call("tools/list");
  assert.deepEqual([res.headers.get("cache-control"), res.headers.get("content-type"), res.headers.get("set-cookie")], ["no-store", "application/json", null]);

  // Nothing is stored: the connector never gets the database or any other binding.
  const index = readFileSync(join(root, "worker/index.js"), "utf8"), mcp = readFileSync(join(root, "worker/mcp.js"), "utf8");
  assert.match(index, /return handleMcp\(request, url\);/);
  assert.doesNotMatch(mcp, /env\.|fetch\(|console\./);
});

test("embed: the reminder card any site can show, drawn from the link and never stored", async () => {
  const worker = (await import("../worker/index.js")).default;
  const { EMBED_CSP } = await import("../worker/embed.js");
  const env = shellEnv();
  const get = (path, init) => worker.fetch(new Request("https://remmynd.space" + path, init), env);
  const link = R.createLink({ title: "Demo <day> & \"night\"", start: "2026-12-05T18:00", timeZone: "Asia/Kolkata", durationMinutes: 90, host: "North<wind>" });
  const code = link.split("/r/")[1];

  let res = await get("/embed/" + code + "?theme=dark");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
  assert.equal(res.headers.get("content-security-policy"), EMBED_CSP);
  assert.match(EMBED_CSP, /frame-ancestors \*/, "any site may frame the card");
  assert.match(EMBED_CSP, /script-src 'self'; style-src 'self'/, "and it runs only this site's own files");
  assert.equal(res.headers.get("x-frame-options"), null);
  const html = await res.text();
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.ok(html.includes('<b class="em-title">Demo &lt;day&gt; &amp; &quot;night&quot;</b>'), "the title is escaped");
  assert.ok(html.includes("Reminder · from North&lt;wind&gt;"), "so is the host");
  assert.ok(html.includes('href="https://remmynd.space/r/' + code + '" target="_blank" rel="noopener"'), "Remind me opens the shared link in a new tab");
  assert.ok(html.includes("Sat 5 Dec, 6:00 PM IST"), "without script, the time in the host's zone");
  assert.match(html, /<svg class="ring ring-(open|soon|now|missed)"/);
  assert.match(html, /data-start="\d+" data-end="\d+"/);
  assert.ok(html.includes('<link rel="stylesheet" href="/embed.css">') && html.includes('<script type="module" src="/embed.js"></script>'));
  assert.doesNotMatch(html, /\son[a-z]+="|\sstyle="|<script>/, "nothing the card's policy would block");
  assert.doesNotMatch(await (await get("/embed/" + code)).text(), /data-theme/, "no theme asked for: it follows the system");

  res = await get("/embed/example");
  assert.equal(res.status, 200);
  const ex = await res.text();
  assert.ok(ex.includes(" data-example") && ex.includes('href="https://remmynd.space/example"'));
  for (const bad of ["/embed/", "/embed/zzz", "/embed/" + "a".repeat(2100), "/embed/abc.def"]) assert.equal((await get(bad)).status, 404, bad);
  assert.equal((await get("/embed/" + code, { method: "POST" })).status, 405);
  assert.equal((await get("/embed/" + code, { method: "HEAD" })).status, 200);

  // The page's script shows the time in the visitor's zone; its styles use the tokens.
  const js = readFileSync(join(root, "public/embed.js"), "utf8"), css = readFileSync(join(root, "public/embed.css"), "utf8");
  assert.match(js, /^import \{ ringSVG, ringLabel \} from "\/ring\.js";$/m);
  assert.match(js, /new Intl\.DateTimeFormat\(undefined, \{ hour: "numeric", minute: "2-digit" \}\)/);
  const parts = css.split("/* ---------- the card ---------- */");
  assert.equal(parts.length, 2);
  assert.doesNotMatch(parts[1].replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, "embed.css: below the tokens, token names only");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /(^|[;{\s])color-scheme\s*:/, "no color-scheme, so the frame stays see-through on any page");
  assert.ok(!firstVisit({ cache: true }).some(f => /^embed\./.test(f)), "the app's first visit doesn't load the card's files");

  // The library and the command line write the snippet; private links are refused.
  assert.equal(R.embedURL(link), "https://remmynd.space/embed/" + code);
  assert.equal(R.embedURL(link + "/", { theme: "light" }), "https://remmynd.space/embed/" + code + "?theme=light");
  assert.equal(R.embedURL("http://localhost:8787/r/" + code), "http://localhost:8787/embed/" + code, "self-hosted links keep their host");
  assert.equal(R.embedHTML(link, { theme: "dark" }), '<iframe src="https://remmynd.space/embed/' + code + '?theme=dark" title="Reminder: Demo <day> &amp; &quot;night&quot;" width="440" height="112" style="width:100%;max-width:440px;border:0" loading="lazy"></iframe>');
  assert.throws(() => R.embedURL(R.createLink({ title: "x", start: "2026-12-05T18:00Z" }, { private: true })), /Private links can't be embedded/);
  assert.throws(() => R.embedHTML("https://example.com/hello"), /Not a remmynd shared link/);
  const cli = (...args) => execFileSync(process.execPath, [join(root, "bin/remmynd.js"), ...args], { encoding: "utf8" });
  assert.ok(cli("Demo day", "--at", "2026-12-05 18:00", "--tz", "Asia/Kolkata", "--embed").includes('<iframe src="https://remmynd.space/embed/'));
  assert.throws(() => execFileSync(process.execPath, [join(root, "bin/remmynd.js"), "Demo", "--at", "2026-12-05 18:00", "--tz", "UTC", "--embed", "--private"], { stdio: "pipe" }), /needs a shared link/);

  // For hosts shows a live example and the snippet; the docs explain it.
  const hosts = readFileSync(join(root, "public/hosts/index.html"), "utf8"), docs = readFileSync(join(root, "public/docs/index.html"), "utf8");
  assert.ok(hosts.includes('<iframe class="embed-demo" src="/embed/example" title="Example reminder card" width="440" height="112" loading="lazy"></iframe>'));
  for (const page of [hosts, docs]) assert.ok(page.includes("&lt;iframe src=&quot;https://remmynd.space/embed/your-link&quot;"), "the snippet is shown as text");
  assert.ok(docs.includes('<h2 id="embed">Reminder card</h2>'));
});

test("qr: codes drawn on the device follow the standard", async () => {
  const { qrMatrix, qrSVG } = await import("../public/qr.js");
  const size = text => qrMatrix(text).length;
  // The smallest version that fits, at level M: 14 bytes fit version 1, 15 need version 2.
  assert.equal(size("12345678901234"), 21);
  assert.equal(size("123456789012345"), 25);
  const link = R.createLink({ title: "Demo day", start: "2026-11-13 17:00", timeZone: "Asia/Kolkata", location: "https://zoom.us/j/123" });
  for (const text of ["https://remmynd.space/", link, link + "?x=" + "a".repeat(300)]) {
    const m = qrMatrix(text), n = m.length, v = (n - 17) / 4;
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 40, "a real version");
    // Finder patterns in three corners: a dark ring, a light ring, a dark 3x3 centre.
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      assert.equal(m[cy + dy][cx + dx], d !== 2, "finder at " + cx + "," + cy);
    }
    // Timing patterns between the finders, and the dark module.
    for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
    assert.equal(m[n - 8][8], true);
    // Format information: both copies agree, the BCH check holds, and it says level M.
    const a = [], b = [];
    for (let i = 0; i <= 5; i++) a.push(m[i][8]);
    a.push(m[7][8], m[8][8], m[8][7]);
    for (let i = 9; i < 15; i++) a.push(m[8][14 - i]);
    for (let i = 0; i < 8; i++) b.push(m[8][n - 1 - i]);
    for (let i = 8; i < 15; i++) b.push(m[n - 15 + i][8]);
    assert.deepEqual(a, b, "both copies of the format information match");
    const bits = a.reduce((x, on, i) => x | (on ? 1 << i : 0), 0) ^ 0x5412;
    let rem = bits >>> 10;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    assert.equal((bits >>> 10 << 10) | rem, bits, "format BCH");
    assert.equal(bits >>> 13, 0, "error correction level M");
    if (v >= 7) {
      let ver = 0;
      for (let i = 0; i < 18; i++) if (m[Math.floor(i / 3)][n - 11 + i % 3]) ver |= 1 << i;
      let r = ver >>> 12;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      assert.equal(ver >>> 12, v, "version information");
      assert.equal(ver, (v << 12) | r, "version BCH");
    }
  }
  assert.deepEqual(qrMatrix(link), qrMatrix(link), "the same link always draws the same code");
  assert.match(qrSVG(link, { label: 'Demo "day"' }), /^<svg class="qr" viewBox="0 0 \d+ \d+" role="img" aria-label="Demo &#34;day&#34;"/);
  assert.throws(() => qrMatrix("x".repeat(2400)), /Too long/);
  // Loaded only when asked for, and small: the spec allows 6 KB compressed for a QR routine.
  assert.ok(gzipSync(readFileSync(join(root, "public/qr.js"))).length < 6000, "qr.js under 6 KB compressed");
  const app = readFileSync(join(root, "public/app.js"), "utf8");
  assert.match(app, /await import\("\/qr\.js"\)/);
  assert.doesNotMatch(app, /^import .*qr\.js/m, "qr.js is not part of the first visit");
});

test("published badge files match the library", () => {
  assert.equal(readFileSync(join(root, "public/badge.svg"), "utf8"), R.badgeSVG());
  assert.equal(readFileSync(join(root, "public/badge-dark.svg"), "utf8"), R.badgeSVG({ theme: "dark" }));
  // The badge carries the moment ring in the 2.0 colours: amber on light, lime on dark.
  assert.match(R.badgeSVG(), /A8\.8 8\.8 0 1 1 [^"]+" stroke="#0E0F11"[^>]*\/><circle [^>]*fill="#F2A000"/);
  assert.match(R.badgeSVG({ theme: "dark" }), /fill="#17191D"[\s\S]*fill="#C8F53B"/);
  assert.equal(R.describeWhen(new Date("2026-11-13T11:30:00Z"), "Asia/Kolkata"), "Fri 13 Nov, 5:00 PM IST");
  assert.equal(R.describeWhen(new Date("2026-11-13T11:30:00Z")), "Fri 13 Nov, 11:30 AM UTC");
  assert.match(R.badgeMarkdown("https://remmynd.space/#abc"), /^\[!\[Remind me\]/);
});

test("CLI prints a working link", () => {
  const out = execFileSync(process.execPath, [join(root, "bin/remmynd.js"), "Demo", "day", "--at", "2026-12-05 18:00", "--tz", "Asia/Kolkata", "--json", "--badge", "md"], { encoding: "utf8" });
  const j = JSON.parse(out);
  assert.equal(R.decode(j.link).title, "Demo day");
  assert.match(j.link, /^https:\/\/remmynd\.space\/r\//);
  assert.match(j.badge, /badge\.svg/);
  const priv = execFileSync(process.execPath, [join(root, "bin/remmynd.js"), "Demo", "--at", "2026-12-05 18:00", "--tz", "UTC", "--private"], { encoding: "utf8" }).trim();
  assert.match(priv, /^https:\/\/remmynd\.space\/#/);
  assert.equal(R.decode(priv).title, "Demo");
});

test("package version matches the library", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.version, R.VERSION);
});

/* ---------- guards: the rules in section 3 of docs/v2/SPEC.md ---------- */

const SITE = "remmynd.space";
// Hosts a script in public/ may name, for links out only. The page never loads from them.
const LINK_OUT_HOSTS = new Set([
  SITE,                  // our own address: shared links and the badge snippet
  "calendar.google.com", // Google Calendar's add-event page
  "www.w3.org",          // the SVG namespace, never fetched
  "maps.apple.com",      // Directions to a place, on Apple devices
  "www.google.com",      // Directions to a place, elsewhere
]);
// <link rel> values that make the browser fetch the address.
const LOADING_RELS = new Set(["stylesheet", "preload", "modulepreload", "prefetch", "prerender", "preconnect", "dns-prefetch", "icon", "apple-touch-icon", "apple-touch-icon-precomposed", "apple-touch-startup-image", "mask-icon", "manifest"]);

// True when the browser would fetch this address from remmynd.space itself.
function sameSite(ref) {
  const r = ref.trim();
  if (/^(data|blob):/i.test(r) || !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(r)) return true;
  try { const u = new URL(r, "https://" + SITE + "/"); return /^https?:$/.test(u.protocol) && u.hostname === SITE; } catch { return false; }
}

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([^\s=/>"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}
const srcset = v => v.split(",").map(s => s.trim().split(/\s+/)[0]).filter(Boolean);

// What a stylesheet fetches: url() and @import.
const cssLoads = css => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)|@import\s+(["'])([^"']+)\3/gi)]
  .map(m => ({ ref: m[2] ?? m[4], by: "css", file: true }));

// What a script fetches when the address is written as a plain string. "file" marks what a
// visit downloads (static imports, the service worker, src); the rest, dynamic import() included,
// are fetched only when needed.
function jsLoads(js) {
  const kinds = [
    [/\b(fetch|sendBeacon|EventSource|WebSocket|import)\s*\(\s*(["'`])([^"'`]*)\2/g, false],
    [/\b(importScripts|Worker|SharedWorker|register)\s*\(\s*(["'`])([^"'`]*)\2/g, true],
    [/\b(import|export)\b[^"'`;()]*?\bfrom\s*(["'`])([^"'`]*)\2/g, true],
    [/\b(import)\s*(["'`])([^"'`]*)\2/g, true],
    [/\.(src)\s*=\s*(["'`])([^"'`]*)\2/g, true],
  ];
  return kinds.flatMap(([re, file]) => [...js.matchAll(re)].map(m => ({ ref: m[3], by: m[1], file })));
}

// Replaces until nothing changes, so a comment or block hidden inside another can't survive one pass.
const untilStable = (s, re, to) => { let prev; do { prev = s; s = s.replace(re, to); } while (s !== prev); return s; };
const stripComments = s => untilStable(s, /<!--[\s\S]*?-->/g, "");
// An end tag may carry anything before its ">" ("</script >", "</script foo>") and any letter case.
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;

// Inline script bodies of an HTML page (not JSON data blocks), or a whole script file.
function scriptsIn(file, text) {
  if (/\.m?js$/.test(file)) return [text];
  if (!/\.(html|svg)$/.test(file)) return [];
  return [...stripComments(text).matchAll(SCRIPT_BLOCK)]
    .filter(m => !/type\s*=\s*["']?[^"'\s>]*json/i.test(m[1])).map(m => m[2]);
}

// What a page or SVG fetches by itself. Markup written inside a script is not markup.
function markupLoads(file, html) {
  const out = scriptsIn(file, html).flatMap(jsLoads);
  html = untilStable(stripComments(html), /(<script\b[^>]*>)[\s\S]*?<\/script\b[^>]*>/gi, "$1");
  html = untilStable(html, /<style\b[^>]*>([\s\S]*?)<\/style\b[^>]*>/gi, (_, css) => { out.push(...cssLoads(css)); return ""; });
  for (const [, name, rest] of html.matchAll(/<([a-z][a-z0-9:-]*)\b([^>]*)>/gi)) {
    const tag = name.toLowerCase(), a = attrs(rest), add = (ref, at) => out.push({ ref, by: "<" + tag + " " + at + ">", file: true });
    if (a.style) cssLoads(a.style).forEach(l => add(l.ref, "style"));
    if (a.src && /^(script|img|iframe|frame|embed|video|audio|source|track|input)$/.test(tag)) add(a.src, "src");
    if (a.srcset && /^(img|source)$/.test(tag)) srcset(a.srcset).forEach(r => add(r, "srcset"));
    if (a.poster && tag === "video") add(a.poster, "poster");
    if (a.data && tag === "object") add(a.data, "data");
    if (a.href && tag === "base") add(a.href, "href");
    if (a.href && tag === "link" && (a.rel || "").toLowerCase().split(/\s+/).some(r => LOADING_RELS.has(r))) add(a.href, "href");
    if (a.imagesrcset && tag === "link") srcset(a.imagesrcset).forEach(r => add(r, "imagesrcset"));
    if (/^(image|use|feimage|script)$/.test(tag)) for (const k of ["href", "xlink:href"]) if (a[k]) add(a[k], k);
  }
  return out;
}

// Addresses in a web app manifest (icons, screenshots, start_url, scope, shortcuts).
function manifestLoads(text) {
  const out = [], walk = v => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) typeof x === "string" && /^(src|start_url|scope|url)$/.test(k) ? out.push({ ref: x, by: "manifest " + k, file: true }) : walk(x);
  };
  walk(JSON.parse(text));
  return out;
}

function loadsIn(file, text) {
  if (/\.css$/.test(file)) return cssLoads(text);
  if (/\.m?js$/.test(file)) return jsLoads(text);
  if (/\.(webmanifest|json)$/.test(file)) return manifestLoads(text);
  if (/\.(html|svg)$/.test(file)) return markupLoads(file, text);
  return [];
}

const TEXT = /\.(html|css|m?js|svg|webmanifest|json|txt|xml)$/;
const publicFiles = (d = "") => readdirSync(join(root, "public", d)).flatMap(f => statSync(join(root, "public", d, f)).isDirectory() ? publicFiles(join(d, f)) : [join(d, f)]);

test("no third parties: nothing in public/ loads from another host", () => {
  // The guard must catch what it guards against.
  const hostile = [
    ["a.html", '<script src="https://cdn.example.com/x.js"></script>'],
    ["a.html", '<link rel="stylesheet" href="//fonts.example.com/css">'],
    ["a.html", '<link rel="preconnect" href="https://fonts.example.com">'],
    ["a.html", '<img srcset="a.png 1x, https://img.example.com/b.png 2x">'],
    ["a.html", '<p style="background:url(https://img.example.com/c.png)"></p>'],
    ["a.html", '<script>fetch("https://api.example.com/hit")</script>'],
    ["a.css", '@import url("https://css.example.com/a.css");'],
    ["a.js", 'import x from "https://esm.example.com/y.js";'],
    ["a.js", 'navigator.sendBeacon("https://stats.example.com/b")'],
    ["a.svg", '<svg><image href="https://img.example.com/d.png"/></svg>'],
    ["a.webmanifest", '{"icons":[{"src":"https://img.example.com/i.png"}]}'],
    ["a.html", '<script>x</script ><img src="https://img.example.com/e.png">'],
    ["a.html", '<!--<!-- -->--><SCRIPT SRC="https://cdn.example.com/f.js"></SCRIPT>'],
  ];
  for (const [f, text] of hostile) assert.ok(loadsIn(f, text).some(l => !sameSite(l.ref)), "the guard misses " + text);
  const fine = '<a href="https://github.com/x">Source</a><link rel="canonical" href="https://remmynd.space/"><img src="icon.svg"><script>const s=\'<img src="https://x.example.com/b.svg">\'</script>';
  assert.deepEqual(loadsIn("b.html", fine).filter(l => !sameSite(l.ref)), [], "links out, and markup inside a script string, are allowed");

  const problems = [];
  for (const f of publicFiles().filter(f => TEXT.test(f))) {
    const text = readFileSync(join(root, "public", f), "utf8");
    for (const l of loadsIn(f, text)) if (!sameSite(l.ref)) problems.push(f + ": " + l.by + " loads " + l.ref + " (self-host it instead)");
    for (const js of scriptsIn(f, text)) {
      for (const m of js.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)|["'`]\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
        const host = (m[1] ?? m[2]).toLowerCase();
        if (!LINK_OUT_HOSTS.has(host)) problems.push(f + ": a script names " + host + " (add it to LINK_OUT_HOSTS only if it is a link out)");
      }
    }
  }
  assert.deepEqual(problems, []);
});

// Bytes on the wire. Text counts gzipped (a little larger than the brotli Cloudflare usually
// serves); fonts and images are already compressed and count as they are.
const wireSize = f => { const b = readFileSync(join(root, "public", f)); return TEXT.test(f) ? gzipSync(b).length : b.length; };

// The files a first visit downloads: index.html and everything it loads by itself
// (stylesheets, fonts, scripts and their imports, icons, the manifest, the service worker),
// plus, with cache, what the service worker stores when it installs on that same visit.
function firstVisit({ cache }) {
  const seen = new Set(), queue = ["index.html"];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    assert.ok(existsSync(join(root, "public", f)), "a first visit asks for " + f + ", which isn't in public/");
    seen.add(f);
    // Manifest icons are fetched when the app is installed; the service worker caches them anyway.
    if (!TEXT.test(f) || /\.(webmanifest|json)$/.test(f)) continue;
    const text = readFileSync(join(root, "public", f), "utf8");
    const refs = loadsIn(f, text).filter(l => l.file).map(l => l.ref);
    if (f === "sw.js" && cache) {
      const shell = /const SHELL\s*=\s*\[([^\]]*)\]/.exec(text);
      assert.ok(shell, "sw.js lists the files it caches in const SHELL = [...]");
      refs.push(...[...shell[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1]));
    }
    for (const r of refs) {
      if (!sameSite(r) || /^(data:|blob:|#)/i.test(r.trim())) continue;
      let p = decodeURIComponent(new URL(r, "https://" + SITE + "/" + f).pathname);
      if (p.endsWith("/")) p += "index.html";
      queue.push(p.slice(1));
    }
  }
  return [...seen].sort();
}

test("size budgets: app code under 70 KB, first visit under 150 KB", t => {
  const KB = 1000; // the stricter reading
  const sum = files => files.reduce((n, f) => n + wireSize(f), 0);
  const all = firstVisit({ cache: true }), page = firstVisit({ cache: false });
  for (const f of ["index.html", "app.css", "push.js", "sw.js", "fonts/geist-5.3-latin.woff2", "fonts/geist-mono-5.3-latin.woff2"]) assert.ok(all.includes(f), "the first visit includes " + f);
  const code = all.filter(f => /\.(html|css|m?js)$/.test(f));
  const k = n => (n / KB).toFixed(1) + " KB";
  t.diagnostic("app code " + k(sum(code)) + " (" + code.join(", ") + ")");
  t.diagnostic("first visit " + k(sum(all)) + ": the page " + k(sum(page)) + ", the service worker's cache adds " + k(sum(all) - sum(page)));
  assert.ok(sum(code) < 70 * KB, "app code is " + k(sum(code)) + ", over the 70 KB budget");
  assert.ok(sum(all) < 150 * KB, "the first visit is " + k(sum(all)) + ", over the 150 KB budget");
});

test("public/remmynd.js is the library, byte for byte", () => {
  assert.ok(readFileSync(join(root, "public/remmynd.js")).equals(readFileSync(join(root, "lib/remmynd.js"))),
    "public/remmynd.js differs from lib/remmynd.js. Copy it: cp lib/remmynd.js public/remmynd.js");
});

test("no logs: wrangler.toml keeps Workers observability off", () => {
  const toml = readFileSync(join(root, "wrangler.toml"), "utf8").replace(/#.*$/gm, "");
  const table = /^\[observability\][ \t]*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml);
  assert.ok(table, "wrangler.toml has an [observability] table");
  assert.match(table[1], /^\s*enabled\s*=\s*false\s*$/m, "[observability] says enabled = false");
  assert.doesNotMatch(toml, /^\s*\[\[?(observability\.|tail_consumers)/m, "no observability sub-tables or tail consumers");
  assert.doesNotMatch(toml, /^\s*(observability\s*=|head_sampling_rate|invocation_logs|logpush|tail_consumers)\b/m, "no other logging settings");
});

// Every tracked file (or every file on disk when git isn't available), except the test folder.
function repoFiles() {
  const skip = new Set([".git", "node_modules", "test", ".wrangler"]);
  const walk = d => readdirSync(d).flatMap(f => skip.has(f) ? [] : statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
  try { return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).map(f => join(root, f)); }
  catch { return walk(root); }
}

test("repository credits zoof04 only", () => {
  const files = repoFiles();
  // Other product and tool names must not appear anywhere in the repository.
  const banned = new RegExp([["sig", "ship"], ["cla", "ude"], ["anth", "ropic"]].map(p => p.join("")).join("|"), "i");
  for (const f of files) {
    if (/\.(png|ico)$/.test(f) || f.startsWith(join(root, "test"))) continue;
    assert.ok(!banned.test(readFileSync(f, "utf8")), "unexpected mention in " + f);
  }
});

test("ticket: ring, host time and length, the Held chime, view transitions and two panes", () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8"), css = readFileSync(join(root, "public/app.css"), "utf8");
  const pick = name => app.split("\n").find(l => l.startsWith("const " + name + "="));
  const lengthText = new Function(pick("lengthText") + "; return lengthText;")();
  assert.deepEqual([15, 30, 60, 90, 120, 150].map(lengthText), ["15 min", "30 min", "1 hour", "1 h 30 min", "2 hours", "2 h 30 min"]);
  assert.match(app, /^import \{ ringSVG, ringLabel \} from "\/ring\.js";$/m);
  for (const part of ['<span class="label">Reminder</span>', 't-from">from ', '<div class="t-when">', 'your time · ', '<span class="label">Host time</span>', '<span class="label">Length</span>', 'id="sleep"'])
    assert.ok(app.includes(part), "the ticket has " + part);
  // Held: the chime is 659 Hz then 988 Hz, 90 ms each, after the 320 ms close, with an off switch kept in rm:sound.
  assert.match(app, /\[\[659,0\],\[988,\.09\]\]/);
  assert.match(app, /setTimeout\(chime,320\)/);
  assert.match(app, /localStorage\.getItem\("rm:sound"\)!=="off"/);
  assert.match(readFileSync(join(root, "public/index.html"), "utf8"), /data-sound="on"[^>]*>On<\/button><button type="button" data-sound="off"[^>]*>Off</);
  // Line to ticket uses a same-document view transition, with a plain swap where there is none or motion is reduced.
  assert.match(app, /function swap\(fn\)\{if\(document\.startViewTransition&&!STILL\.matches\)\{const t=document\.startViewTransition\(fn\);t\.ready\.catch\(\(\)=>\{\}\);t\.finished\.catch\(\(\)=>\{\}\);\}else fn\(\);\}/);
  assert.match(app, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  // Two panes from 960 px: the maker on the left, the ticket on the right.
  assert.match(css, /@media \(min-width:960px\)\{[^@]*#home:not\(\[hidden\]\)\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,460px\)/);
  assert.match(css, /@media \(max-width:959px\)\{[^@]*\.maker\{display:contents\}/);
});

test("words: the maker uses the spec's wording", () => {
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  const app = readFileSync(join(root, "public/app.js"), "utf8");
  for (const w of ["Reminders that make sure it happens.",
    "Write it in one line and share the link. Anyone who taps it is reminded in layers and followed through until it's done. No account needed.",
    ">New reminder<", 'placeholder="Demo day Fri 5pm zoom.us/j/123"', "Private link", "Keeps the title and time out of link previews.",
    "A free tool by <a href=\"https://zoof04.com\">Zoof04 Inc.</a> MIT licence."]) assert.ok(html.includes(w), "index.html says: " + w);
  for (const w of ["Enter makes the link", "Not a link yet. Press Enter to make it.", "Held. You\\'re set.", "Your reminder stack", "Nudge me until I\\'m in",
    "Up to 3 nudges, 10 minutes apart.", "Sign in to get it by email too", "More ways to be reminded", ". Confirm there.", "Calendar and a notification on this "]) assert.ok(app.includes(w), "app.js says: " + w);
  assert.match(app, /CAL_NAME=\{apple:"Apple Calendar",google:"Google Calendar",outlook:"Outlook"\}/, "Sent to Apple Calendar. Confirm there. (and Google or Outlook)");
  assert.doesNotMatch(app, /Added to (Apple|Google)/, "never claim it was added");
  assert.doesNotMatch(html + app, /microphone|Speak it/i, "no microphone in 2.0");
});

test("privacy and free wording match the approved text", () => {
  const approved = "Your reminder lives in the link and on your device. For phone alerts we keep only an anonymous ping time, deleted once it's sent.";
  for (const f of ["README.md", "docs/PRINCIPLES.md", "public/index.html", "public/privacy/index.html"]) {
    assert.ok(readFileSync(join(root, f), "utf8").includes(approved), f + " uses the approved privacy sentence");
  }
  const principles = readFileSync(join(root, "docs/PRINCIPLES.md"), "utf8");
  assert.ok(principles.includes("## 2. Free, no account needed, no tracking"), "principle 2 title");
  // Optional sign-in, in the owner's approved words, everywhere privacy is described.
  const signin = "If you sign in, we keep your email address and your reminders so they sync across your devices and can be emailed to you. Private links stay on your device. Delete it all any time.";
  for (const f of ["README.md", "docs/PRINCIPLES.md", "public/privacy/index.html"]) assert.ok(readFileSync(join(root, f), "utf8").includes(signin), f + " explains what signing in keeps");
  assert.ok(readFileSync(join(root, "public/privacy/index.html"), "utf8").includes("delivered by <a href=\"https://resend.com/legal/privacy-policy\">Resend</a>"), "the privacy page names who delivers the emails");
  for (const f of repoFiles()) {
    if (/\.(png|ico|woff2)$/.test(f) || f.startsWith(join(root, "test")) || f.includes(join("docs", "v2")) || f.endsWith("CHANGELOG.md")) continue;
    assert.doesNotMatch(readFileSync(f, "utf8"), /no sign-up|No account on either side/i, f + " still promises no sign-up");
  }
  assert.ok(principles.includes('"Reminders that make sure it happens."'), "principle 5 states the aim");
  // Retired promises. The 2.0 spec in docs/v2 quotes them only to retire them.
  const retired = /nothing stored|no "?pro"? tier|is a phase/i;
  for (const f of repoFiles()) {
    if (/\.(png|ico)$/.test(f) || f.startsWith(join(root, "test")) || f.startsWith(join(root, "docs", "v2"))) continue;
    assert.ok(!retired.test(readFileSync(f, "utf8")), "retired wording in " + f);
  }
});

test("git history credits zoof04 only", { skip: !existsGit() }, () => {
  const log = execFileSync("git", ["log", "--format=%an%n%ae%n%B"], { cwd: root, encoding: "utf8" });
  const banned = new RegExp([["cla", "ude"], ["anth", "ropic"]].map(p => p.join("")).join("|"), "i");
  assert.ok(!banned.test(log), "a commit message or author mentions another tool");
});

function existsGit() {
  try { execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "ignore" }); return true; } catch { return false; }
}

/* ---------- push notifications ---------- */
function mockDB() {
  const rows = new Map();
  const exec = (sql, a) => {
    sql = sql.replace(/\s+/g, " ").trim();
    const all = [...rows.values()];
    if (sql.startsWith("SELECT COUNT(*) AS n FROM pings WHERE endpoint = ?")) return { results: [{ n: all.filter(r => r.endpoint === a[0]).length }] };
    if (sql.startsWith("INSERT OR REPLACE INTO pings")) { rows.set(a[0], { id: a[0], endpoint: a[1], at: a[2], created: a[3] }); return { results: [] }; }
    if (sql === "DELETE FROM pings WHERE id = ? AND endpoint = ?") { const r = rows.get(a[0]); if (r && r.endpoint === a[1]) rows.delete(a[0]); return { results: [] }; }
    if (sql.startsWith("SELECT id, endpoint, at FROM pings WHERE at <= ?")) return { results: all.filter(r => r.at <= a[0]).sort((x, y) => x.at - y.at) };
    if (sql === "DELETE FROM pings WHERE endpoint = ?") { all.filter(r => r.endpoint === a[0]).forEach(r => rows.delete(r.id)); return { results: [] }; }
    if (sql === "DELETE FROM pings WHERE id = ?") { rows.delete(a[0]); return { results: [] }; }
    if (sql === "DELETE FROM pings WHERE at < ?") { all.filter(r => r.at < a[0]).forEach(r => rows.delete(r.id)); return { results: [] }; }
    throw new Error("unexpected SQL: " + sql);
  };
  const prepare = sql => ({ bind: (...a) => ({ run: async () => exec(sql, a), all: async () => exec(sql, a), first: async () => exec(sql, a).results[0] }) });
  return { rows, prepare, batch: async stmts => Promise.all(stmts.map(s => s.run())) };
}

async function vapidEnv() {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
  return { env: { DB: mockDB(), VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_SUBJECT: "mailto:connect@zoof04.com" }, publicJwk: publicKey.export({ format: "jwk" }) };
}

test("push: schedule, cancel and reject bad input", async () => {
  const worker = (await import("../worker/index.js")).default;
  const { env } = await vapidEnv();
  env.ASSETS = { fetch: () => new Response("static") };
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
  const req = (path, body, headers = {}) => worker.fetch(new Request("https://remmynd.space" + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), env);
  const now = Date.now();

  const key = await worker.fetch(new Request("https://remmynd.space/push/key"), env);
  assert.equal((await key.json()).key, env.VAPID_PUBLIC_KEY);

  const ok = await req("/push/schedule", { endpoint, pings: [{ id: "aaaaaaaaaaaa", at: now + 3600e3 }, { id: "bbbbbbbbbbbb", at: now + 7200e3 }] });
  assert.equal(ok.status, 200);
  assert.equal(env.DB.rows.size, 2);
  assert.deepEqual(Object.keys([...env.DB.rows.values()][0]).sort(), ["at", "created", "endpoint", "id"], "only id, endpoint and times are stored");

  assert.equal((await req("/push/schedule", { endpoint: "https://evil.example/push", pings: [{ id: "cccccccccccc", at: now + 1e5 }] })).status, 400, "unknown push host rejected");
  assert.equal((await req("/push/schedule", { endpoint, pings: [{ id: "x", at: now + 1e5 }] })).status, 400, "short id rejected");
  assert.equal((await req("/push/schedule", { endpoint, pings: [{ id: "dddddddddddd", at: now + 500 * 864e5 }] })).status, 400, "too far ahead rejected");
  assert.equal((await req("/push/schedule", { endpoint, pings: [{ id: "eeeeeeeeeeee", at: now + 1e5 }] }, { origin: "https://evil.example" })).status, 403, "cross-site rejected");

  await req("/push/cancel", { endpoint: "https://fcm.googleapis.com/fcm/send/someone-else", ids: ["aaaaaaaaaaaa"] });
  assert.equal(env.DB.rows.size, 2, "another device can't cancel your pings");
  await req("/push/cancel", { endpoint, ids: ["aaaaaaaaaaaa"] });
  assert.equal(env.DB.rows.size, 1);

  const off = await worker.fetch(new Request("https://remmynd.space/push/key"), { ASSETS: env.ASSETS });
  assert.equal(off.status, 503, "key route says when push isn't set up");
});

test("push: VAPID signature verifies with the public key", async () => {
  const { vapidAuthorization } = await import("../worker/push.js");
  const { env, publicJwk } = await vapidEnv();
  const auth = await vapidAuthorization("https://web.push.apple.com/abc", env);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth);
  assert.ok(m, "header shape");
  assert.equal(m[4], env.VAPID_PUBLIC_KEY);
  const claims = JSON.parse(Buffer.from(m[2], "base64url"));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "mailto:connect@zoof04.com");
  const key = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(m[3], "base64url"), new TextEncoder().encode(m[1] + "." + m[2]));
  assert.ok(valid, "signature is valid ES256");
});

test("push: due pings are sent once per device, then deleted", async () => {
  const { sendDuePings } = await import("../worker/push.js");
  const { env } = await vapidEnv();
  const now = Date.now();
  const add = (id, endpoint, at) => env.DB.rows.set(id, { id, endpoint, at, created: now });
  add("due-1-aaaaaa", "https://fcm.googleapis.com/a", now - 1000);
  add("due-2-aaaaaa", "https://fcm.googleapis.com/a", now);
  add("later-aaaaaa", "https://fcm.googleapis.com/a", now + 3600e3);
  add("gone-aaaaaaa", "https://web.push.apple.com/gone", now);
  add("gone-later-a", "https://web.push.apple.com/gone", now + 3600e3);
  const calls = [];
  const send = async endpoint => { calls.push(endpoint); return endpoint.endsWith("/gone") ? 410 : 201; };
  const r = await sendDuePings(env, now, send);
  assert.equal(r.sent, 1);
  assert.deepEqual(calls.sort(), ["https://fcm.googleapis.com/a", "https://web.push.apple.com/gone"], "one push per device");
  assert.deepEqual([...env.DB.rows.keys()], ["later-aaaaaa"], "sent and expired-device rows are gone");
});

test("push client script parses", () => {
  const src = readFileSync(join(root, "public/push.js"), "utf8");
  assert.doesNotThrow(() => new Function(src));
});

test("service worker: an empty push shows what's due, from on-device data only", async () => {
  const vm = await import("node:vm");
  const src = readFileSync(join(root, "public/sw.js"), "utf8");
  const now = Date.now();
  const data = new Map();
  const seed = a => data.set(a.id, { ...a });
  const base = { rkey: "k1", title: "Demo day", start: now + 3600e3, place: "https://lu.ma/demo", share: "https://remmynd.space/#abc", shown: false };
  seed({ ...base, id: "before-1", at: now - 1000, kind: "before" });
  seed({ ...base, id: "start-1", at: now + 3600e3, kind: "start" });
  const store = {
    getAll() { const r = {}; queueMicrotask(() => { r.result = [...data.values()].map(x => ({ ...x })); }); return r; },
    put(a) { data.set(a.id, { ...a }); return {}; }, delete(id) { data.delete(id); return {}; }, createIndex() {}
  };
  const db = { transaction() { const t = { objectStore: () => store }; setTimeout(() => t.oncomplete && t.oncomplete(), 0); return t; }, createObjectStore: () => store };
  const indexedDB = { open() { const q = {}; setTimeout(() => { q.result = db; q.onsuccess && q.onsuccess(); }, 0); return q; } };
  const shown = [], listeners = {};
  const ctx = {
    indexedDB, crypto, btoa, atob, URL, fetch: async () => ({}), caches: {}, location: { origin: "https://remmynd.space" },
    Notification: { prototype: { actions: null }, maxActions: 2 }, console,
    self: { addEventListener: (t, f) => { listeners[t] = f; }, navigator: {}, clients: {},
      registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); }, pushManager: { getSubscription: async () => null } } }
  };
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(readFileSync(join(root, "public", f.replace(/^\//, "")), "utf8"), ctx));
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const push = async () => { let p; listeners.push({ waitUntil: x => { p = x; } }); await p; };

  await push();
  assert.equal(shown.length, 1, "only the due alert is shown");
  assert.equal(shown[0].title, "Demo day starts in 1 hour");
  assert.match(shown[0].body, /lu\.ma\/demo/);
  assert.equal(JSON.stringify(shown[0].actions.map(a => a.title)), JSON.stringify(["Snooze 10 min", "Open"]));
  assert.equal(shown[0].data.url, "https://remmynd.space/#abc", "1-hour alert opens the reminder");
  assert.equal(shown[0].badge, "/badge-mono-96.png");
  assert.equal(data.get("before-1").shown, true, "marked as shown");

  shown.length = 0;
  data.set("start-1", { ...data.get("start-1"), at: now - 500 });
  await push();
  assert.equal(shown[0].title, "Demo day is starting now");
  assert.equal(shown[0].data.url, "https://lu.ma/demo", "start alert opens the event link");
  assert.equal(shown[0].requireInteraction, true);

  shown.length = 0;
  await push();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, "remmynd", "a push with nothing due still shows something (iPhone requires it)");
});

test("service worker: /r/ pages are never cached, and offline pages get the shell", async () => {
  const vm = await import("node:vm");
  const src = readFileSync(join(root, "public/sw.js"), "utf8");
  const stored = new Map();
  let online = true;
  const cache = { put: async (k, v) => { stored.set(typeof k === "string" ? k : k.url, v); }, addAll: async () => {} };
  const caches = { open: async () => cache, match: async k => stored.get(typeof k === "string" ? k : k.url) || undefined, keys: async () => [] };
  const fetch = async req => { if (!online) throw new TypeError("offline"); return new Response("page " + new URL(req.url).pathname); };
  const listeners = {};
  const ctx = {
    URL, Response, fetch, caches, console, setTimeout, indexedDB: {}, crypto, btoa, atob,
    location: { origin: "https://remmynd.space" }, Notification: { prototype: { actions: null }, maxActions: 2 },
    self: { addEventListener: (t, f) => { listeners[t] = f; }, navigator: {}, clients: {}, registration: {} }
  };
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(readFileSync(join(root, "public", f.replace(/^\//, "")), "utf8"), ctx));
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const open = async path => {
    let p;
    listeners.fetch({ request: { url: "https://remmynd.space" + path, method: "GET", mode: "navigate" }, respondWith: x => { p = x; } });
    const res = await p;
    await new Promise(r => setTimeout(r, 0));
    return res;
  };
  await open("/r/eyJ0IjoiRGVtbyJ9");
  assert.equal(stored.size, 0, "a /r/ page, with its preview tags, is not stored");
  await open("/new?t=Demo&at=2026-12-05T18:00");
  assert.equal(stored.size, 0, "nor is a /new page");
  await open("/");
  assert.ok(stored.has("./index.html"), "the plain shell is stored");
  online = false;
  assert.equal(await (await open("/r/eyJ0IjoiRGVtbyJ9")).text(), "page /", "offline, a /r/ link opens the cached shell");
});

// A small in-memory IndexedDB: versions, upgrades, stores keyed by keyPath, getAll/put/delete.
function fakeIndexedDB(state) {
  const store = name => ({
    createIndex() {},
    put(v) { const st = state.stores[name]; st.rows.set(v[st.keyPath], v); return {}; },
    delete(k) { state.stores[name].rows.delete(k); return {}; },
    getAll() { const r = {}; setTimeout(() => { r.result = [...state.stores[name].rows.values()]; r.onsuccess && r.onsuccess({ target: r }); }, 0); return r; }
  });
  const db = {
    objectStoreNames: { contains: n => n in state.stores },
    createObjectStore(n, { keyPath }) { state.stores[n] = { keyPath, rows: new Map() }; return store(n); },
    transaction(n) { const t = { objectStore: () => store(n) }; setTimeout(() => t.oncomplete && t.oncomplete(), 5); return t; },
    close() {}
  };
  return { open(name, version) {
    const q = {};
    setTimeout(() => {
      q.result = db;
      if (version > state.version) { const oldVersion = state.version; state.version = version; q.transaction = { objectStore: store }; q.onupgradeneeded({ oldVersion }); }
      setTimeout(() => q.onsuccess(), 2);
    }, 0);
    return q;
  } };
}

test("on-device storage: version 2 adds reminders and links, built from version 1 alerts", async () => {
  const vm = await import("node:vm");
  const load = state => { const ctx = { indexedDB: fakeIndexedDB(state), setTimeout, self: {} }; vm.createContext(ctx); vm.runInContext(readFileSync(join(root, "public/db.js"), "utf8"), ctx); return ctx.self.remmyndDB; };
  const alert = (id, rkey, kind) => ({ id, rkey, kind, title: rkey === "k1" ? "Demo day" : "Call Mum", start: 1798000000000, place: "https://lu.ma/demo", share: "https://remmynd.space/r/" + rkey, shown: false, at: 1797996400000 });
  const v1 = { version: 1, stores: { alerts: { keyPath: "id", rows: new Map([["a1", alert("a1", "k1", "before")], ["a2", alert("a2", "k1", "start")], ["a3", alert("a3", "k2", "start")]]) } } };
  const DB = load(v1);
  const reminders = await DB.getAll("reminders");
  assert.equal(v1.version, 2);
  assert.deepEqual(reminders.map(r => r.rkey).sort(), ["k1", "k2"], "one reminder per rkey");
  const k1 = reminders.find(r => r.rkey === "k1");
  assert.deepEqual([k1.title, k1.place, k1.share, k1.state, k1.nudge], ["Demo day", "https://lu.ma/demo", "https://remmynd.space/r/k1", "held", false]);
  assert.equal((await DB.getAll("alerts")).length, 3, "alerts are kept");
  await DB.put("links", { share: "https://remmynd.space/r/x", title: "Demo day", start: 1798000000000, createdAt: 1, private: false });
  assert.deepEqual((await DB.getAll("links")).map(l => l.share), ["https://remmynd.space/r/x"]);
  // A first visit gets all three stores, empty.
  const fresh = { version: 0, stores: {} };
  const DB2 = load(fresh);
  assert.deepEqual(await DB2.getAll("reminders"), []);
  assert.deepEqual(Object.keys(fresh.stores).sort(), ["alerts", "links", "reminders"]);
  // Nothing else opens the database: push.js and sw.js go through db.js.
  for (const f of ["push.js", "sw.js", "app.js"]) assert.doesNotMatch(readFileSync(join(root, "public", f), "utf8"), /indexedDB\.open/, f + " opens IndexedDB itself");
});

// Run public/push.js against stand-ins for the browser: permission, push, storage and the server.
function loadPush(vm, src, { permission = "granted", ask = "granted", push = true, ios = false } = {}) {
  const alerts = new Map(), posts = [];
  const state = { asked: false };
  const Notification = { permission, requestPermission: () => { state.asked = true; Notification.permission = ask; return Promise.resolve(ask); } };
  let subscribed = null;
  const reg = { pushManager: { getSubscription: async () => subscribed, subscribe: async () => (subscribed = { endpoint: "https://fcm.googleapis.com/fcm/send/abc" }) } };
  const ctx = {
    crypto, btoa, atob, console, setTimeout, Promise, Uint8Array, JSON,
    navigator: { userAgent: ios ? "iPhone" : "Mozilla/5.0", maxTouchPoints: 0, ...(push ? { serviceWorker: { ready: Promise.resolve(reg) } } : {}) },
    document: { querySelector: () => null },
    fetch: async (path, opts) => { if (path === "/push/key") return { ok: true, json: async () => ({ key: "BL1wKLc" }) }; posts.push([path, JSON.parse(opts.body)]); return { ok: true, json: async () => ({ ok: true }) }; },
    remmyndDB: {
      getAll: async () => [...alerts.values()],
      putMany: async (_, list) => list.forEach(a => alerts.set(a.id, a)),
      delMany: async (_, ids) => ids.forEach(id => alerts.delete(id))
    },
    __rm: { OWN: true, IOS: ios, STANDALONE: false, TZ: "Asia/Kolkata", openSheet() {}, toast() {}, fShort: d => d.toISOString().slice(11, 16) },
    addEventListener() {}
  };
  if (push) { ctx.PushManager = function () {}; ctx.Notification = Notification; }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { push: ctx.__rmPush, alerts, posts, state };
}

test("stack: Remind me turns on notifications inside the tap, and the Notification row says where things stand", async () => {
  const vm = await import("node:vm");
  const src = readFileSync(join(root, "public/push.js"), "utf8");
  const load = opts => loadPush(vm, src, opts);
  const el = () => ({ isConnected: true, innerHTML: "", querySelector: () => ({ addEventListener() {} }) });
  const day = { r: { t: "Demo day", l: "https://lu.ma/demo" }, start: new Date(Date.now() + 2 * 864e5), share: "https://remmynd.space/r/x", morningAt: null };

  // Allowed already: two alerts, scheduled as two anonymous pings, and the row says so.
  let t = load(), d = { ...day, el: el() };
  await t.push.remind(d);
  assert.deepEqual([...t.alerts.values()].map(a => a.kind).sort(), ["before", "check", "start"]);
  assert.equal(t.posts.length, 1);
  assert.equal(t.posts[0][0], "/push/schedule");
  assert.deepEqual(Object.keys(t.posts[0][1].pings[0]).sort(), ["at", "id"], "the server gets an id and a time, nothing about the event");
  assert.match(d.el.innerHTML, /1 hour before, and at the start/);
  assert.match(d.el.innerHTML, /Notifications on\. Turn them off/);
  await t.push.remind(d);
  assert.equal(t.alerts.size, 3, "holding twice doesn't double the alerts");

  // Not asked yet: the prompt starts inside the tap, before anything is awaited.
  t = load({ permission: "default" }); d = { ...day, el: el() };
  const pending = t.push.remind(d);
  assert.equal(t.state.asked, true, "permission is asked synchronously");
  await pending;
  assert.equal(t.alerts.size, 3);

  // Said no: nothing is scheduled, and the row says where it's blocked.
  t = load({ permission: "default", ask: "denied" }); d = { ...day, el: el() };
  await t.push.remind(d);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(t.posts.length, 0);
  assert.match(d.el.innerHTML, /Blocked in this browser's settings/);

  // Already started, an iPhone outside the Home Screen, and a browser without push.
  t = load(); d = { ...day, start: new Date(Date.now() - 6e4), el: el() };
  await t.push.remind(d);
  assert.match(d.el.innerHTML, /It has already started/);
  t = load({ push: false, ios: true }); d = { ...day, el: el() };
  await t.push.remind(d);
  await new Promise(r => setTimeout(r, 10));
  assert.match(d.el.innerHTML, /On iPhone, add remmynd to your Home Screen first/);
  t = load({ push: false }); d = { ...day, el: el() };
  await t.push.remind(d);
  await new Promise(r => setTimeout(r, 10));
  assert.match(d.el.innerHTML, /Not available in this browser/);
});

test("follow through: the check alert, nudges, and stopping them", async () => {
  const vm = await import("node:vm");
  const src = readFileSync(join(root, "public/push.js"), "utf8");
  const start = new Date(Math.ceil((Date.now() + 2 * 864e5) / 6e4) * 6e4);
  const el = () => ({ isConnected: true, innerHTML: "", querySelector: () => ({ addEventListener() {} }) });
  const kinds = t => [...t.alerts.values()].sort((a, b) => a.at - b.at).map(a => a.kind + "@" + Math.round((a.at - start) / 6e4));

  // The check comes when it ends: start plus its length, or 30 minutes when the link has none.
  let t = loadPush(vm, src);
  await t.push.remind({ r: { t: "Demo day", d: 45 }, start, share: "https://remmynd.space/r/x", morningAt: null, el: el() });
  assert.deepEqual(kinds(t), ["before@-60", "start@0", "check@45"]);
  t = loadPush(vm, src);
  await t.push.remind({ r: { t: "Demo day" }, start, share: "https://remmynd.space/r/x", morningAt: null, el: el() });
  assert.deepEqual(kinds(t), ["before@-60", "start@0", "check@30"]);

  // Nudges: 10, 20 and 30 minutes after the start, numbered, only with the switch on.
  t = loadPush(vm, src);
  const d = { r: { t: "Demo day", d: 60 }, start, share: "https://remmynd.space/r/x", morningAt: null, el: el(), nudge: true };
  await t.push.remind(d);
  assert.deepEqual(kinds(t), ["before@-60", "start@0", "nudge@10", "nudge@20", "nudge@30", "check@60"]);
  assert.deepEqual([...t.alerts.values()].filter(a => a.kind === "nudge").map(a => a.n).sort(), [1, 2, 3]);
  assert.ok(t.posts.every(([, body]) => !body.pings || body.pings.length <= 8), "within 8 pings per request");
  // Opening the link stops the nudges; the check stays.
  assert.equal(await t.push.cancel([...t.alerts.values()][0].rkey, ["nudge"]), 3);
  assert.deepEqual(kinds(t), ["before@-60", "start@0", "check@60"]);
  assert.equal(t.posts.at(-1)[0], "/push/cancel");
  // The switch adds them back, once.
  assert.equal(await t.push.setNudge(d, true), 3);
  assert.equal(await t.push.setNudge(d, true), 0);
  assert.equal(await t.push.setNudge(d, false), 3);

  // Not yet: everything waiting goes, and one alert comes back at the chosen time.
  const at = start.getTime() + 864e5;
  assert.equal(await t.push.replan(d, at), true);
  assert.deepEqual([...t.alerts.values()].map(a => [a.kind, a.at]), [["replan", at]]);
  // Drop: nothing left.
  await t.push.cancel([...t.alerts.values()][0].rkey);
  assert.equal(t.alerts.size, 0);

  // Overnight (sleep-safe): one morning alert, no check or nudges in the night.
  t = loadPush(vm, src);
  await t.push.remind({ r: { t: "Launch", d: 60 }, start, share: "https://remmynd.space/r/y", morningAt: new Date(start.getTime() + 8 * 36e5), el: el(), nudge: true });
  assert.deepEqual(kinds(t), ["after@480"]);
});

test("follow through: check and nudge alerts on the device, Done and Not yet", async () => {
  const vm = await import("node:vm");
  const src = readFileSync(join(root, "public/sw.js"), "utf8");
  const now = Date.now();
  const stores = { alerts: new Map(), reminders: new Map() };
  const base = { rkey: "k1", title: "Demo day", start: now - 15 * 60e3, place: "https://lu.ma/demo", share: "https://remmynd.space/r/abc", shown: false };
  [{ ...base, id: "c1", kind: "check", at: now - 1000 }, { ...base, id: "n2", kind: "nudge", n: 2, at: now - 500 }, { ...base, id: "n3", kind: "nudge", n: 3, at: now + 10 * 60e3 },
    { ...base, rkey: "k2", title: "Call Mum", id: "r1", kind: "replan", at: now - 200 }].forEach(a => stores.alerts.set(a.id, a));
  stores.reminders.set("k1", { rkey: "k1", title: "Demo day", state: "held" });
  const keyOf = (store, v) => store === "alerts" ? v.id : v.rkey;
  const DB = { getAll: async st => [...stores[st].values()].map(v => ({ ...v })), put: async (st, v) => { stores[st].set(keyOf(st, v), { ...v }); }, del: async (st, k) => { stores[st].delete(k); } };
  const shown = [], opened = [], posts = [], listeners = {};
  const ctx = {
    URL, console, setTimeout, crypto, btoa, atob, location: { origin: "https://remmynd.space" }, caches: {},
    fetch: async (path, opts) => { posts.push([path, JSON.parse(opts.body)]); return { ok: true, json: async () => ({}) }; },
    Notification: { prototype: { actions: null }, maxActions: 2 }, importScripts: () => {},
    self: { addEventListener: (t, f) => { listeners[t] = f; }, navigator: {}, remmyndDB: DB,
      clients: { matchAll: async () => [], openWindow: async url => { opened.push(url); } },
      registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); }, pushManager: { getSubscription: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }) } } }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const wait = async fn => { let p; fn(x => { p = x; }); await p; };

  await wait(w => listeners.push({ waitUntil: w }));
  const by = t => shown.find(n => n.title === t);
  const check = by("Demo day: did you make it?"), nudge = by("Demo day has started"), back = by("Call Mum");
  assert.ok(check && nudge && back, "check, nudge and re-plan alerts are shown");
  assert.deepEqual(Array.from(check.actions, a => a.title), ["Done", "Not yet"]);
  assert.equal(check.data.url, "https://remmynd.space/r/abc", "a tap opens the ticket, which asks the same question");
  assert.equal(nudge.body, "Nudge 2 of 3. Tap to open.");
  assert.equal(nudge.data.url, "https://lu.ma/demo");
  assert.deepEqual(Array.from(back.actions, a => a.title), ["Done", "Not yet"]);
  assert.equal(by("Demo day: did you make it?") && shown.filter(n => /Nudge 3/.test(n.body)).length, 0, "nudge 3 waits for its time");

  // Tapping the nudge opens the link and stops the nudges still waiting.
  await wait(w => listeners.notificationclick({ action: "", notification: { close() {}, data: nudge.data }, waitUntil: w }));
  assert.deepEqual(opened, ["https://lu.ma/demo"]);
  assert.equal(stores.alerts.has("n3"), false, "nudge 3 is cancelled");
  assert.ok(stores.reminders.get("k1").openedAt, "opened is kept on the reminder");

  // Not yet opens the ticket with the re-plan sheet.
  await wait(w => listeners.notificationclick({ action: "notyet", notification: { close() {}, data: check.data }, waitUntil: w }));
  assert.equal(opened.at(-1), "https://remmynd.space/r/abc?act=replan");

  // Done marks it kept, without opening anything, and cancels what's left.
  stores.alerts.set("x1", { ...base, id: "x1", kind: "nudge", n: 3, at: now + 60e3 });
  await wait(w => listeners.notificationclick({ action: "done", notification: { close() {}, data: check.data }, waitUntil: w }));
  assert.equal(stores.reminders.get("k1").state, "kept");
  assert.ok(stores.reminders.get("k1").doneAt);
  assert.equal(stores.alerts.has("x1"), false);
  assert.deepEqual(posts.at(-1), ["/push/cancel", { endpoint: "https://fcm.googleapis.com/fcm/send/abc", ids: ["x1"] }]);
  assert.equal(opened.length, 2, "Done opens nothing");
});

test("lists: Coming up and My links, grouped Today, This week, Later, Kept", () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8"), html = readFileSync(join(root, "public/index.html"), "utf8");
  const line = p => app.split("\n").find(l => l.startsWith(p));
  const groupOf = new Function(line("function parts(") + line("const dayNum=") + line("const groupOf=") + "; return groupOf;")();
  const relText = new Function(line("const relText=") + "; return relText;")();
  const tz = "Asia/Kolkata", at = (d, h, mi = 0) => R.zonedTime(2026, 11, d, h, mi, tz).getTime(), now = at(11, 10);
  // By the viewer's own calendar day: today until midnight, then the next seven days, then later.
  assert.deepEqual([at(11, 23, 59), at(12, 0, 5), at(18, 9), at(19, 9), at(10, 23)].map(t => groupOf(t, now, tz)), ["today", "week", "week", "later", "earlier"]);
  assert.deepEqual([relText(at(11, 10, 42), at(11, 11), now), relText(at(11, 13), at(11, 14), now), relText(at(11, 9, 30), at(11, 10, 30), now), relText(at(11, 8), at(11, 9), now)],
    ["in 42 min", "in 3 h", "now", "ended"]);
  assert.match(html, /<a href="\/#coming-up" id="tab-coming">Coming up<\/a><a href="\/#links" id="tab-links">My links<\/a>/);
  for (const w of ['"Swipe a row left, or tap ⋯, for "', '"Re-plan, Done and Delete."', '"Copy, Edit and Delete."', '"J and K move, "', '"Delete removes, Enter opens."',
    '[["replan","Re-plan"],["done","Done"],["delete","Delete"]]', '[["copy","Copy"],["edit","Edit"],["delete","Delete"]]',
    "Nothing coming up yet. Write one in the bar below, then tap Remind me.", "No reminders made yet. Write one in the bar below and press Enter.", 'GROUPS={today:"Today",week:"This week",later:"Later",kept:"Kept"']) assert.ok(app.includes(w), "app.js has " + w);
  assert.match(app, /if\(k==="j"\|\|k==="k"\)/, "J and K move");
  assert.match(app, /rowAct\(li\.dataset\.rkey,k==="d"\?"done":"replan",i\)/, "D marks done, S re-plans");
  assert.doesNotMatch(readFileSync(join(root, "public/push.js"), "utf8"), /renderHome|coming-up/, "the old home card is gone");
});

test("extras: Kept N of M this month, Ctrl or Cmd + K, and the floating countdown", async () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8"), html = readFileSync(join(root, "public/index.html"), "utf8");
  const line = p => app.split("\n").find(l => l.startsWith(p));

  // Kept N of M this month: what came due this month (once it's over, or when it was marked done); kept is what was marked Done.
  const keptCount = new Function(line("function parts(") + line("function offsetMin(") + line("function zonedToUTC(") + line("const keptCount=") + "; return keptCount;")();
  const tz = "Asia/Kolkata", at = (mo, d, h, mi = 0) => R.zonedTime(2026, mo, d, h, mi, tz).getTime(), now = at(11, 20, 12);
  const recs = [
    { start: at(11, 3, 9), state: "kept", doneAt: at(11, 3, 10) }, // kept this month
    { start: at(10, 31, 9), state: "kept", doneAt: at(11, 1, 8) }, // marked done on the 1st: this month
    { start: at(10, 30, 9), state: "kept", doneAt: at(10, 30, 10) }, // last month
    { start: at(11, 10, 9), state: "held" }, // over, never marked done
    { start: at(11, 10, 9), state: "dropped" }, // dropped: not kept
    { start: at(11, 2, 9), replanAt: at(11, 2, 10), state: "held" }, // re-planned, and that time has passed too
    { start: at(11, 20, 11, 30), state: "held" }, // still going (an hour long): not yet
    { start: at(11, 19, 9), replanAt: at(11, 21, 9), state: "held" }, // re-planned to tomorrow: not yet
    { start: at(11, 25, 9), state: "held" }, // later this month: not yet
  ];
  assert.deepEqual(keptCount(recs, now, tz), { k: 2, n: 5 });
  assert.deepEqual(keptCount([], now, tz), { k: 0, n: 0 });
  assert.match(html, /<p class="kept" id="kept" hidden><svg class="s-on"[^>]*aria-hidden="true">[\s\S]*?<\/svg><span id="kept-n"><\/span><\/p>/);
  assert.ok(app.includes('$("#kept-n").textContent="Kept "+kc.k+" of "+kc.n+" this month";$("#kept").hidden=!(up&&kc.k);'), "shown on Coming up once one is kept, never as a zero");

  // Ctrl or Cmd + K, and Search and commands in the menu, open the palette; it loads only then.
  assert.match(app, /if\(\(e\.metaKey\|\|e\.ctrlKey\)&&!e\.altKey&&!e\.shiftKey&&\(e\.key\|\|""\)\.toLowerCase\(\)==="k"\)\{e\.preventDefault\(\);openPalette\(\);\}/);
  assert.ok(app.includes('import("/palette.js")') && app.includes('$("#cmd-btn").addEventListener("click",openPalette)'));
  assert.ok(html.includes('<button type="button" class="btn" id="cmd-btn">Search and commands<kbd id="cmd-k">Ctrl K</kbd></button>'));
  const P = await import("../public/palette.js");
  const called = [];
  const api = {
    host: "remmynd.space", theme: "dark", sound: true, accountLabel: "Sign in to sync and get email", install: null, when: t => (t > now ? "soon" : "before"),
    recs: [
      ...[1, 2, 3, 4, 5, 6].map(i => ({ title: "Call " + i, start: now + i * 36e5, share: "https://remmynd.space/r/c" + i, state: "held" })),
      { title: "Dentist", start: now - 864e5, doneAt: now - 8e7, state: "kept", share: "https://remmynd.space/r/d" },
      { title: "Gone", start: now + 36e5, state: "dropped", share: "https://remmynd.space/r/g" },
    ],
    links: [{ title: "Call 1", start: now + 36e5, share: "https://remmynd.space/r/c1" }, { title: "Book club", start: now + 2 * 864e5, share: "https://remmynd.space/#bc", private: true }],
    pages: [["Why", "https://remmynd.space/why"], ["GitHub", "https://github.com/Remmynd/remmynd"], ["Privacy", "/privacy"]],
    go: u => called.push(["go", u]), newOne: t => called.push(["new", t]), setTheme: t => called.push(["theme", t]), setSound: on => called.push(["sound", on]), account: () => called.push(["account"]),
  };
  const items = P.commands(api, now), labels = list => list.map(i => i.group + ": " + i.label);
  const first = P.pick(items, "", api.newOne);
  assert.deepEqual(labels(first).slice(0, 8), ["Do: New reminder", "Go to: Coming up", "Go to: My links", "Reminders: Call 1", "Reminders: Call 2", "Reminders: Call 3", "Reminders: Call 4", "Reminders: Call 5"], "what's next first, five before you type");
  assert.ok(!labels(first).includes("Reminders: Gone") && !labels(first).includes("Reminders: Call 6"));
  assert.deepEqual(labels(P.pick(items, "call 6", api.newOne)), ["Reminders: Call 6", "Make: New reminder: call 6"], "typing finds the rest");
  assert.deepEqual(labels(P.pick(items, "book", api.newOne)), ["Links: Book club", "Make: New reminder: book"], "a link that is also a reminder is listed once");
  assert.equal(P.pick(items, "book", api.newOne)[0].hint, "soon · private");
  assert.deepEqual(labels(P.pick(items, "dark", api.newOne)), ["Settings: Theme: Dark", "Make: New reminder: dark"]);
  assert.equal(items.find(i => i.label === "Theme: Dark").hint, "On");
  assert.ok(!items.some(i => /float/i.test(i.label)), "no float command unless the ticket can float");
  assert.ok(P.commands({ ...api, float: () => {} }, now).some(i => i.label === "Float the countdown above my windows"));
  assert.deepEqual(labels(P.pick(items, "github", api.newOne)), ["Pages: GitHub", "Make: New reminder: github"]);
  const make = P.pick(items, "Dentist tue 4pm", api.newOne);
  assert.deepEqual(labels(make), ["Make: New reminder: Dentist tue 4pm"], "nothing matches: it offers to make it");
  make[0].run();
  P.pick(items, "call 2", api.newOne)[0].run();
  items.find(i => i.label === "Turn the sound off").run();
  items.find(i => i.label === "Theme: Light").run();
  assert.deepEqual(called, [["new", "Dentist tue 4pm"], ["go", "https://remmynd.space/r/c2"], ["sound", false], ["theme", "light"]]);
  const pal = readFileSync(join(root, "public/palette.js"), "utf8");
  assert.match(pal, /role="combobox" aria-expanded="true" aria-controls="pal-list"/);
  assert.match(pal, /role="listbox"/);
  assert.match(pal, /setAttribute\("aria-activedescendant"/);

  // The floating countdown: offered only where Document Picture-in-Picture exists, loaded only when asked for.
  assert.ok(app.includes('const PIP="documentPictureInPicture" in window') && app.includes('const floatRow=()=>{if(!PIP||FL.no)return"";') && app.includes('import("/float.js")'));
  assert.ok(app.includes("Float it above my windows"));
  const F = await import("../public/float.js");
  assert.deepEqual([F.left(41 * 6e4 + 58e3), F.left(5 * 36e5 + 41 * 6e4 + 58e3), F.left(3 * 864e5 + 5), F.left(-1)], ["41:58", "5:41:58", "3 days", "00:00"]);
  const ev = { title: "Demo day", at: now, end: now + 36e5 };
  assert.deepEqual([F.face(ev, now - 2 * 36e5), F.face(ev, now - 6e4), F.face(ev, now + 1), F.face(ev, now + 36e5)].map(f => [f.state, f.big, f.small]),
    [["held", "2:00:00", "until Demo day"], ["soon", "01:00", "until Demo day"], ["now", "Now", "Demo day"], ["missed", "Ended", "Demo day"]]);
  const fl = readFileSync(join(root, "public/float.js"), "utf8");
  assert.match(fl, /for \(const href of \["\/app\.css", "\/float\.css"\]\)/, "the window uses the site's own stylesheets");
  assert.match(fl, /win\.setInterval\(paint, 1000\)/, "the floating window keeps its own time, so a background tab doesn't slow it");

  // None of it is in the first visit, and the new stylesheets use tokens only.
  assert.ok(!firstVisit({ cache: true }).some(f => /^(palette|float)\./.test(f)));
  for (const f of ["palette.css", "float.css"]) assert.doesNotMatch(readFileSync(join(root, "public", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, f + " uses token names, not raw colours");
});

test("share target: text shared from another app lands in the bar", async () => {
  // Installed on Android, remmynd is in the share sheet; what's shared opens /share?title=&text=&url=.
  const man = JSON.parse(readFileSync(join(root, "public/manifest.webmanifest"), "utf8"));
  assert.deepEqual(man.share_target, { action: "/share", method: "GET", enctype: "application/x-www-form-urlencoded", params: { title: "title", text: "text", url: "url" } });

  // The Worker answers with the app itself, never stored, and refuses anything but GET and HEAD.
  const worker = (await import("../worker/index.js")).default;
  const env = shellEnv();
  let res = await worker.fetch(new Request("https://remmynd.space/share?text=Dentist+Tue+4pm"), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(await res.text(), /<html/);
  assert.equal((await worker.fetch(new Request("https://remmynd.space/share", { method: "POST" }), env)).status, 405);

  // The page makes one line of title, text and link (each once), and reads it like anything typed in the bar.
  const app = readFileSync(join(root, "public/app.js"), "utf8");
  const line = p => app.split("\n").find(l => l.startsWith(p));
  const shareLine = new Function(line("const shareLine=") + "; return shareLine;")();
  const q = o => new URLSearchParams(o);
  assert.equal(shareLine(q({ title: "Concert tickets", url: "https://tix.example/e/42" })), "Concert tickets https://tix.example/e/42");
  assert.equal(shareLine(q({ text: "Standup tomorrow 9:30 https://meet.example/abc", url: "https://meet.example/abc" })), "Standup tomorrow 9:30 https://meet.example/abc", "a link already in the text isn't added twice");
  assert.equal(shareLine(q({ title: "Dentist Tue 4pm", text: "Dentist Tue 4pm" })), "Dentist Tue 4pm");
  assert.equal(shareLine(q({ text: "Book club\n  Thursday   7pm" })), "Book club Thursday 7pm", "the bar is one line");
  assert.equal(shareLine(q({ text: "x".repeat(900) })).length, 600, "no longer than the bar takes");
  assert.equal(shareLine(q({})), "");
  assert.match(app, /if\(p==="\/share"\|\|p==="\/share\/"\)return fromShare\(\);/);
  assert.match(app, /history\.replaceState\(null,"","\/"\)/, "the address goes back to / so a reload doesn't share it again");
  const p = R.parse(shareLine(q({ title: "Dentist appointment Tue 4pm", url: "https://smile.example/visit" })), { timeZone: "Asia/Kolkata", now: new Date("2026-11-11T10:00:00Z") });
  assert.deepEqual([p.title, p.start.toISOString(), p.place], ["Dentist appointment", "2026-11-17T10:30:00.000Z", "https://smile.example/visit"]);
});

test("my plan: say when and where, and the alerts and emails repeat it back", async () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8"), sw = readFileSync(join(root, "public/sw.js"), "utf8");
  // On a held reminder, a short line kept with the reminder (synced when signed in), never in the link.
  assert.ok(app.includes('<label class="plan" for="s-plan"><span class="opt-text"><b>My plan</b><span>Say when and where. Your alerts repeat it back.</span></span><input id="s-plan" type="text" maxlength="120"'));
  assert.ok(app.includes('value="\'+esc(rec.plan||"")+\'"'), "the saved plan is escaped back into the field");
  assert.match(app, /const v=x\.value\.replace\(\/\\s\+\/g," "\)\.trim\(\)\.slice\(0,120\);if\(v===\(S\.rec\.plan\|\|""\)\)return;S\.rec\.plan=v;keepRec\(\);/);
  assert.ok(app.includes("Plan saved. Your alerts will repeat it."));
  const pick = name => app.split("\n").find(l => l.startsWith("const " + name + "="));
  assert.doesNotMatch(pick("linkFor") + pick("enc"), /plan/, "the plan never goes in a link");
  // When it's time, the ticket shows it.
  assert.match(app, /plan\?'<p class="plan-say"><span class="label">Your plan<\/span>'\+esc\(plan\)\+'<\/p>':''/);

  // Phone alerts: the service worker reads the plan from this device when it shows an alert.
  const block = sw.slice(sw.indexOf("const short ="), sw.indexOf("const PLATFORM_HAS_ACTIONS"));
  const view = new Function(block + "; return view;")();
  const start = Date.UTC(2026, 11, 4, 11, 30), a = { title: "Demo day", start, place: "https://zoom.us/j/123" };
  assert.match(view({ ...a, kind: "before", at: start - 36e5 }, "At my desk, 5 minutes early").body, /zoom\.us\/j\/123\nYour plan: At my desk, 5 minutes early$/);
  assert.equal(view({ ...a, kind: "start", at: start }, "At my desk").body, "Tap to open zoom.us/j/123\nYour plan: At my desk");
  assert.equal(view({ ...a, kind: "nudge", at: start + 6e5, n: 2 }, "At my desk").body, "Nudge 2 of 3. Tap to open.\nYour plan: At my desk");
  assert.equal(view({ ...a, kind: "check", at: start + 36e5 }, "At my desk").body, "Tap Done, or Not yet to pick another time.", "the check asks its question only");
  assert.equal(view({ ...a, kind: "start", at: start }, "").body, "Tap to open zoom.us/j/123", "no plan, no line");
  assert.match(sw, /const plans = new Map\(\(await DB\.getAll\("reminders"\)\.catch\(\(\) => \[\]\)\)\.map\(r => \[r\.rkey, typeof r\.plan === "string" \? r\.plan\.slice\(0, 120\) : ""\]\)\);/);
  assert.match(sw, /const v = view\(a, plans\.get\(a\.rkey\)\);/);

  // Reminder emails, when signed in.
  const { reminderMail } = await import("../worker/account.js");
  const d = { title: "Demo day", start, tz: "Asia/Kolkata", place: "Studio 4", share: "https://remmynd.space/r/abc", plan: "  At my desk,\n 5 minutes <early>  " };
  const m = reminderMail(d, "before", "https://remmynd.space/api/mail/stop?u=1&t=x", "https://remmynd.space");
  assert.match(m.text, /^In 1 hour: Demo day\nFri 4 Dec, 5:00 PM IST\nStudio 4\nYour plan: At my desk, 5 minutes <early>\n/);
  assert.ok(m.html.includes("Your plan</span>At my desk, 5 minutes &lt;early&gt;</p>"), "escaped in the HTML email");
  const none = reminderMail({ ...d, plan: undefined }, "start", "https://remmynd.space/api/mail/stop?u=1&t=x", "https://remmynd.space");
  assert.doesNotMatch(none.text + none.html, /Your plan/);
  assert.equal(reminderMail({ ...d, plan: "x".repeat(500) }, "start", "s", "https://remmynd.space").text.match(/Your plan: (x+)/)[1].length, 120);
});

test("smart paste: the browser's on-device AI reads an email or a poster into one line", async () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8"), sp = readFileSync(join(root, "public/smartpaste.js"), "utf8");
  // Offered only on a long paste or an image, only where the browser has the Prompt API, and loaded only then.
  assert.ok(app.includes('C.input.addEventListener("paste",e=>{const d=e.clipboardData;if(!d||!("LanguageModel" in self))return;'));
  assert.ok(app.includes('if(image||t.length>80||/\\n/.test(t.trim()))import("/smartpaste.js").then(m=>m.offer({text:t,image,form:C.form,put:newOne,toast,R,timeZone:TZ}))'));
  assert.ok(!firstVisit({ cache: true }).some(f => /^smartpaste\./.test(f)), "the first visit doesn't download it");
  assert.doesNotMatch(readFileSync(join(root, "public/smartpaste.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, "smartpaste.css uses token names");

  // It runs on the device: it never asks a server for anything, and says so before it starts.
  assert.doesNotMatch(sp, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.ok(sp.includes("Runs on this device. Nothing is sent anywhere."));
  assert.ok(sp.includes('if (ready === "unavailable")'), "no offer where the model can't run");
  assert.match(sp, /initialPrompts: \[\{ role: "system", content: instructions\(new Date\(\), timeZone\) \}\]/);
  assert.match(sp, /m\.addEventListener\("downloadprogress"/, "a first download shows its progress");
  assert.match(sp, /session\.prompt\(\[\{ role: "user", content \}\], \{ responseConstraint: SCHEMA \}\)/);
  assert.match(sp, /finally \{ if \(session\) session\.destroy\(\); \}/);
  assert.match(sp, /\{ type: "image", value: image \}/, "an image goes to the model with the text");

  const S = await import("../public/smartpaste.js");
  assert.deepEqual(S.SCHEMA.required, ["title", "date", "time", "time_zone", "duration_minutes", "place"]);
  assert.equal(S.SCHEMA.additionalProperties, false);
  const said = S.instructions(new Date("2026-11-11T10:00:00Z"), "Asia/Kolkata");
  assert.ok(said.includes("Today is Wednesday, 11 November 2026 and the reader's time zone is Asia/Kolkata."));
  assert.ok(said.includes("Never invent a date or time."));

  // The answer becomes one line the bar reads like anything typed, in the reader's zone.
  const tz = "Asia/Kolkata", now = new Date("2026-11-11T10:00:00Z");
  const line = r => S.lineFrom(r, tz, R.zonedTime);
  const read = l => { const p = R.parse(l, { timeZone: tz, now }); return [p.title, p.start && p.start.toISOString(), p.dur, p.place]; };
  let out = line({ title: "Quarterly review", date: "2026-12-05", time: "18:00", time_zone: "", duration_minutes: 90, place: "Studio 4, Main Street" });
  assert.deepEqual(out, { line: "Quarterly review 2026-12-05 18:00 for 90 min at Studio 4, Main Street", found: true });
  assert.deepEqual(read(out.line), ["Quarterly review", "2026-12-05T12:30:00.000Z", 90, "Studio 4, Main Street"]);
  out = line({ title: "Webinar", date: "2026-12-05", time: "09:00", time_zone: "America/New_York", duration_minutes: 0, place: "https://zoom.us/j/1" });
  assert.equal(out.line, "Webinar 2026-12-05 19:30 https://zoom.us/j/1", "a time written in another zone is moved into the reader's");
  assert.deepEqual(read(out.line), ["Webinar", "2026-12-05T14:00:00.000Z", null, "https://zoom.us/j/1"]);
  assert.equal(line({ title: "Standup", date: "2026-12-07", time: "09:30", time_zone: "Asia/Kolkata", duration_minutes: 15, place: "meet.example/abc" }).line, "Standup 2026-12-07 09:30 for 15 min meet.example/abc");
  assert.equal(line({ title: "Dentist", date: "2026-11-17", time: "", time_zone: "", duration_minutes: 0, place: "Smile Clinic" }).line, "Dentist 2026-11-17 at Smile Clinic", "a date alone: the bar reads it as 9 AM");
  assert.deepEqual(line({ title: "Book club", date: "", time: "19:00", time_zone: "", duration_minutes: 0, place: "" }), { line: "Book club", found: false });
  for (const date of ["2026-13-40", "2026-11-31", "12/05/2026", "soon"]) assert.equal(line({ title: "X", date, time: "10:00" }).found, false, date);
  assert.equal(line({ title: "Leap", date: "2028-02-29" }).found, true);
  assert.equal(line({ title: "X", date: "2026-12-05", time: "25:99" }).line, "X 2026-12-05", "a time that isn't one is left out");
  assert.equal(line({ title: "X", date: "2026-12-05", duration_minutes: 5000 }).line, "X 2026-12-05", "and so is a length out of range");
  assert.equal(line({ title: "  Two\n  lines  ", date: "", place: "" }).line, "Two lines");
  assert.equal(line({ title: "t".repeat(500) }).line.length, 120);
  assert.deepEqual(line(null), { line: "", found: false });
});

test("follow through: the re-plan sheet's choices", () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8");
  const line = p => app.split("\n").find(l => l.startsWith(p));
  const replanOptions = new Function(line("function parts(") + line("function offsetMin(") + line("function zonedToUTC(") + line("const replanOptions=") + "; return replanOptions;")();
  const tz = "Asia/Kolkata", at = (y, mo, d, h, mi = 0) => R.zonedTime(y, mo, d, h, mi, tz).getTime();
  const show = now => replanOptions(now, tz).map(o => [o.key, o.at]);
  // Wednesday 11 Nov 2026, 10:00: in 10 minutes, tonight at 8, tomorrow at 9, Monday at 9.
  assert.deepEqual(show(new Date(at(2026, 11, 11, 10))), [["in10", at(2026, 11, 11, 10, 10)], ["tonight", at(2026, 11, 11, 20)], ["tomorrow", at(2026, 11, 12, 9)], ["monday", at(2026, 11, 16, 9)]]);
  // After 7:00 PM there is no "tonight".
  assert.deepEqual(show(new Date(at(2026, 11, 11, 19, 5))).map(o => o[0]), ["in10", "tomorrow", "monday"]);
  // On a Sunday, tomorrow is Monday: one choice, not two.
  assert.deepEqual(show(new Date(at(2026, 11, 15, 10))).map(o => o[0]), ["in10", "tonight", "tomorrow"]);
  // On a Monday, "Monday" means next week's.
  assert.equal(show(new Date(at(2026, 11, 16, 10))).find(o => o[0] === "monday")[1], at(2026, 11, 23, 9));
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  for (const w of ["Not yet? Pick when.", "We'll bring it back then, one tap from the link.", "Pick a time", "Drop this reminder",
    "How it looks in chats", "Scan to send it to your phone", "No account. The reminder travels in the link.", "Download QR code"]) assert.ok(html.includes(w), "index.html says: " + w);
  for (const w of ["Open the link", "Directions", "Not yet", "Done", "We ask once whether you made it. Then we stop.", "Starting now", " · fresh start"]) assert.ok(app.includes(w), "app.js says: " + w);
});

test("sleep-safe: the 9 AM alert reads as already started", async () => {
  const src = readFileSync(join(root, "public/sw.js"), "utf8");
  const viewSrc = src.slice(src.indexOf("const short ="), src.indexOf("const PLATFORM_HAS_ACTIONS"));
  const view = new Function(viewSrc + "; return view;")();
  const start = Date.parse("2026-12-10T22:22:00Z");
  const v = view({ kind: "after", title: "Launch", start, at: start + 5 * 3600e3, place: "https://lu.ma/x" });
  assert.match(v.title, /^Launch started at /);
  assert.equal(v.body, "Tap to open lu.ma/x");
});

/* ---------- step 8: the website ---------- */

const PAGES = ["why", "hosts", "docs", "privacy", "install", "roadmap", "press", "about", "open", "blog", "blog/since-2-0", "changelog"];
const pageFile = p => p === "404" ? "public/404.html" : "public/" + p + "/index.html";
const readPage = p => readFileSync(join(root, pageFile(p)), "utf8");
const squash = s => s.replace(/\s+/g, " ").replace(/> </g, "><").trim();
const cut = (html, re) => { const m = re.exec(html); assert.ok(m, "missing " + re); return squash(m[0]); };
const visible = html => html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");

test("website: every page shares one header, footer and menu", () => {
  const all = [...PAGES, "404"];
  const header = p => cut(readPage(p), /<header class="site-head">[\s\S]*?<\/header>/).replace(/ aria-current="page"/g, "");
  const footer = html => cut(html, /<footer class="site-foot">[\s\S]*?<\/footer>/);
  const menu = html => cut(html, /<nav class="menu-links"[\s\S]*?<\/nav>/);
  const app = readFileSync(join(root, "public/index.html"), "utf8");
  for (const p of all) {
    assert.equal(header(p), header("why"), p + ": the header differs from /why");
    assert.equal(footer(readPage(p)), footer(app), p + ": the footer differs from the app's");
    assert.equal(menu(readPage(p)), menu(app), p + ": the menu differs from the app's");
  }
  // The menu: Why, For hosts, Docs, Roadmap, GitHub, and the theme switch (spec section 7).
  assert.deepEqual([...menu(app).matchAll(/>([^<]+)<\/a>/g)].map(m => m[1]), ["Why", "For hosts", "Docs", "Roadmap", "GitHub"]);
  assert.match(app, /id="menu"[\s\S]*aria-labelledby="theme-m"[\s\S]*aria-labelledby="sound-m"[\s\S]*id="install"/, "the app's menu has the theme, sound and Install");
  assert.ok(footer(app).includes('A free tool by <a href="https://zoof04.com">Zoof04 Inc.</a> MIT licence.'), "footer words, spec section 9 as changed by the owner");

  const here = { why: "/why", hosts: "/hosts", docs: "/docs", roadmap: "/roadmap", install: "/install" };
  for (const p of all) {
    const html = readPage(p);
    const current = [...cut(html, /<header class="site-head">[\s\S]*?<\/header>/).matchAll(/href="([^"]+)" aria-current="page"/g)].map(m => m[1]);
    assert.deepEqual(current, here[p] ? [here[p]] : [], p + ": the header marks the page it is on");
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, p + ": one h1");
    assert.match(html, /<title>[^<]+ · remmynd<\/title>/, p + ": title");
    assert.match(html, /<meta name="description" content="[^"]{40,}">/, p + ": description");
    if (p === "404") assert.match(html, /<meta name="robots" content="noindex">/);
    else assert.match(html, new RegExp('<link rel="canonical" href="https://remmynd\\.space/' + p + '">'), p + ": canonical address without a slash");
    assert.match(html, /<script>try\{var t=localStorage\.getItem\("rm:theme"\)[\s\S]*<link rel="stylesheet" href="\/app\.css">\n<link rel="stylesheet" href="\/site\.css">\n<script src="\/site\.js" defer><\/script>/, p + ": theme before styles, then app.css, site.css and site.js");
    assert.match(html, /<body class="site">\n<a class="skip" href="#main">Skip to content<\/a>[\s\S]*<main id="main">/, p + ": skip link to the main content");
    assert.ok(!/\sstyle="|<style[\s>]/.test(html), p + ": no inline styles");
    // Every address on remmynd.space that a page links to exists.
    for (const [, href] of html.matchAll(/\shref="(\/[^"#]*)[^"]*"/g)) {
      if (href === "/" || /^\/(changelog|stats|new|example)$/.test(href)) continue;
      const f = href.slice(1);
      assert.ok(existsSync(join(root, "public", f)) && statSync(join(root, "public", f)).isFile() || existsSync(join(root, "public", f, "index.html")), p + " links to " + href + ", which doesn't exist");
    }
    for (const [, id] of html.matchAll(/\shref="#([^"]+)"/g)) assert.ok(html.includes('id="' + id + '"'), p + " links to #" + id + ", which isn't on the page");
  }

  // The sitemap lists the home page and every page, and nothing else.
  const sitemap = [...readFileSync(join(root, "public/sitemap.xml"), "utf8").matchAll(/<loc>https:\/\/remmynd\.space\/([^<]*)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(sitemap.sort(), ["", ...PAGES].sort());
  // Folders are served without the slash, and CHANGELOG.md is bundled as text for /changelog.
  const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
  assert.match(toml, /^html_handling = "drop-trailing-slash"$/m);
  assert.match(toml, /\[\[rules\]\]\ntype = "Text"\nglobs = \["\*\*\/\*\.md"\]/);
  // llms.txt describes /new with every parameter.
  const llms = readFileSync(join(root, "public/llms.txt"), "utf8");
  assert.match(llms, /^# remmynd\n\n> /);
  for (const k of ["t", "at", "tz", "d", "l", "n", "h"]) assert.ok(llms.includes("- `" + k + "`: "), "llms.txt explains " + k);
  // The site's styles use token names only.
  assert.doesNotMatch(readFileSync(join(root, "public/site.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, "site.css uses token names, not raw colours");
});

test("website: about, open numbers and the blog", () => {
  // The footer's company links are remmynd's own pages now, on the site and in the app.
  for (const html of [readPage("about"), readFileSync(join(root, "public/index.html"), "utf8")])
    assert.ok(html.includes('<span class="label" id="f-company">Company</span><a href="/about">About</a><a href="/blog">Blog</a><a href="/open">Open numbers</a><a href="/press">Press</a><a href="/privacy">Privacy</a></nav>'));
  const about = readPage("about");
  assert.ok(about.includes("remmynd is made by Zoof04 Inc."));
  assert.ok(about.includes('href="mailto:connect@zoof04.com"') && about.includes("/blob/main/docs/PRINCIPLES.md"));
  for (const p of ["The link is the product.", "Free, no account needed, no tracking.", "Honest buttons.", "Small on purpose.", "Calm, plain language.", "Open by default."]) assert.ok(about.includes("<b>" + p + "</b>"), "/about lists the principle: " + p);
  // /open repeats the approved privacy sentences word for word.
  const open = readPage("open");
  assert.ok(open.includes("Your reminder lives in the link and on your device. For phone alerts we keep only an anonymous ping time, deleted once it's sent."));
  // The blog lists every post, newest first, and each post says when it was written.
  const blog = readPage("blog"), posts = [...blog.matchAll(/<li><a href="(\/blog\/[^"]+)"><time datetime="(\d{4}-\d{2}-\d{2})">/g)];
  assert.ok(posts.length >= 1);
  assert.deepEqual(posts.map(m => m[2]), posts.map(m => m[2]).slice().sort().reverse(), "newest first");
  for (const [, href, date] of posts) {
    const post = readPage(href.slice(1));
    assert.ok(post.includes('<time datetime="' + date + '">'), href + " is dated");
    assert.ok(post.includes('<a class="u" href="/blog">Blog</a>'), href + " links back to the blog");
  }
  const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
  for (const p of ["/about", "/open", "/blog", ...posts.map(m => m[1])]) assert.ok(sitemap.includes("<loc>https://remmynd.space" + p + "</loc>"), "sitemap lists " + p);
});

test("website: every figure is real and checkable", async () => {
  // /why: only the section 10 figures, each with its source linked (docs/v2/SPEC.md).
  const why = readPage("why");
  const sources = {
    s1: "https://doi.org/10.1007/s00426-020-01357-6",
    s2: "https://eprints.whiterose.ac.uk/id/eprint/107519/",
    s3: "https://bmjopen.bmj.com/content/6/10/e012116.full",
    s4: "https://marketing.wharton.upenn.edu/wp-content/uploads/2016/10/nickerson20and20rogers_FINAL.pdf",
    s5: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01278/full",
  };
  for (const [id, url] of Object.entries(sources)) assert.ok(why.includes('<li id="' + id + '"><a href="' + url + '">'), "/why links source " + id);
  for (const fig of ["50 to 80 percent of everyday memory failures", "8 percent of healthy young adults", "24 percent did", "from 54 to 67 percent across 21 studies",
    "by 25 percent, a single one by 6", "about half the time", "turnout rose 4.1 points among those reached", "The plain reminder call did nothing."]) assert.ok(why.includes(fig), "/why says: " + fig);
  assert.ok(why.includes("An honest limit: these studies come from clinics, elections and laboratories, not from reminder links. They tell us what to build. They do not promise a number for remmynd."));
  // No other number on /why: the figures, the years and volumes of the sources, and the source marks 1 to 5.
  const allowed = new Set(["50", "80", "8", "24", "54", "67", "21", "25", "6", "4.1", "1998", "2021", "2016", "2010", "2020", "10", "9", "2", "1", "3", "4", "5"]);
  const main = visible(why.slice(why.indexOf("<main"), why.indexOf("</main>")));
  for (const n of main.match(/\d+(?:\.\d+)?/g)) assert.ok(allowed.has(n), "/why shows " + n + ", which isn't one of the section 10 figures");

  // No invented social proof anywhere on the site.
  const invented = /trusted by|testimonial|\bfunding\b|backed by|seed round|as seen (in|on)|\d[\d,.]*\s*[kKmM]?\+?\s+(users|customers|teams|companies)\b/i;
  for (const p of [...PAGES, "404"]) assert.doesNotMatch(visible(readPage(p)), invented, p + " makes a claim we can't check");
  assert.doesNotMatch(visible(readFileSync(join(root, "public/index.html"), "utf8")), invented);

  // /hosts: the test count is this suite's, the live tiles start hidden, and the QR code is a real one.
  const hosts = readPage("hosts");
  const tests = readdirSync(join(root, "test")).filter(f => f.endsWith(".test.js")).reduce((n, f) => n + (readFileSync(join(root, "test", f), "utf8").match(/^test\(/gm) || []).length, 0);
  assert.ok(hosts.includes('<b id="tests">' + tests + "</b>"), "the tests tile on /hosts says " + tests + ", the number of tests in test/");
  assert.match(hosts, /<div data-stat="stars" hidden>[\s\S]*<div data-stat="downloads" hidden>/, "live tiles stay hidden until their number arrives");
  assert.ok(hosts.includes("&lt; 70 KB</b><span>of app code, compressed."), "the size tile matches the budget test above");
  // /open: every number is one a test or the live data keeps true.
  const open = readPage("open");
  assert.ok(open.includes('<b id="open-tests">' + tests + "</b>"), "/open counts the same tests");
  assert.match(open, /<div data-stat="stars" hidden>[\s\S]*<div data-stat="downloads" hidden>/);
  assert.ok(open.includes("&lt; 70 KB</b><span>of app code on a first visit, compressed") && open.includes("&lt; 150 KB</b><span>for the whole first visit, fonts included"), "the budgets the size test enforces");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length, "0 runtime dependencies, as /open says");
  assert.ok(open.includes("<b>0</b><span>runtime dependencies in the npm package</span>"));
  const openNums = visible(open.slice(open.indexOf("<main"), open.indexOf("</main>"))).match(/\d+(?:\.\d+)?/g);
  assert.deepEqual([...new Set(openNums)].sort(), [String(tests), "70", "150", "0"].sort(), "/open shows no number a test doesn't keep true");
  const { qrSVG } = await import("../public/qr.js");
  assert.ok(hosts.includes(qrSVG("https://remmynd.space/example", { label: "QR code that opens an example reminder" })), "the QR code on /hosts is drawn by qr.js for remmynd.space/example");

  // Every release date the site gives matches the changelog.
  for (const [, v, y, mo, d] of readFileSync(join(root, "CHANGELOG.md"), "utf8").matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4})-(\d{2})-(\d{2})$/gm)) {
    const words = Number(d) + " " + new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" }) + " " + y;
    assert.ok(readPage("roadmap").includes("v" + v + "<br><span>" + words + "</span>"), "roadmap gives " + v + " as " + words);
    assert.ok(readPage("press").includes(v + " on " + words), "press gives " + v + " as " + words);
  }
  assert.ok(readPage("press").includes("Current version</th><td>" + R.VERSION + " on "), "press names the current version");
  // The roadmap links to GitHub Issues: the repository has no Discussions.
  assert.ok(readPage("roadmap").includes('href="https://github.com/Remmynd/remmynd/issues">Suggest on GitHub'));
});

test("worker: /changelog renders CHANGELOG.md inside the site page, escaped", async () => {
  const { renderChangelog } = await import("../worker/changelog.js");
  const md = [
    "# Changelog", "", "Intro with [a doc](docs/RELEASING.md) and [Keep](https://keepachangelog.com/).", "",
    "## [Unreleased]", "", "### Added", "",
    "- `remmynd.space/r/…` links and **bold**", "  carried on to a second line.",
    "- Hostile <script>alert(1)</script> and [bad](javascript:steal) and `<b>code</b>`", "",
    "## [1.0.0] - 2026-11-09", "", "- First.", "",
    "[Unreleased]: https://github.com/Remmynd/remmynd/compare/v1.0.0...HEAD",
  ].join("\n");
  const html = renderChangelog(md);
  assert.ok(!html.includes("<h1"), "the page has its own h1");
  assert.ok(html.includes('<p>Intro with <a href="https://github.com/Remmynd/remmynd/blob/main/docs/RELEASING.md">a doc</a> and <a href="https://keepachangelog.com/">Keep</a>.</p>'));
  assert.ok(html.includes('<h2 id="unreleased">Unreleased</h2>'));
  assert.ok(html.includes('<h2 id="1-0-0">1.0.0 <span>2026-11-09</span></h2>'));
  assert.ok(html.includes("<h3>Added</h3>"));
  assert.ok(html.includes("<li><code>remmynd.space/r/…</code> links and <strong>bold</strong> carried on to a second line.</li>"));
  assert.ok(html.includes("Hostile &lt;script&gt;alert(1)&lt;/script&gt; and bad and <code>&lt;b&gt;code&lt;/b&gt;</code>"), "markup stays text and javascript: links are dropped");
  assert.ok(!/<script|javascript:/i.test(html));
  assert.ok(!html.includes("compare/v1.0.0"), "reference lines are not shown");
  assert.ok(!renderChangelog("# C\n\n## [Unreleased]\n\n## [2.0.0] - 2026-11-11\n\n- New.\n").includes("Unreleased"), "an empty Unreleased section is left out");

  const worker = (await import("../worker/index.js")).default;
  const shell = readPage("changelog");
  const env = { ASSETS: { fetch: req => new URL(req.url).pathname === "/changelog"
    ? new Response(shell, { headers: { "content-type": "text/html; charset=utf-8", etag: '"c"' } }) : new Response("nope", { status: 404 }) } };
  const saved = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = TestRewriter;
  try {
    const res = await worker.fetch(new Request("https://remmynd.space/changelog"), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("etag"), null);
    const page = await res.text();
    const real = renderChangelog(readFileSync(join(root, "CHANGELOG.md"), "utf8"));
    assert.ok(page.includes('<div class="prose log" id="log">' + real + "</div>"), "the rendered changelog fills #log");
    assert.ok(!page.includes("Read the changelog"), "the fallback line is replaced");
    assert.ok(page.includes('<footer class="site-foot">') && page.includes('<header class="site-head">'), "inside the site's header and footer");
    assert.match(real, /<h2 id="1-0-0">1\.0\.0 <span>2026-11-09<\/span><\/h2>/);
    assert.equal((await worker.fetch(new Request("https://remmynd.space/changelog", { method: "POST" }), env)).status, 405);
  } finally { globalThis.HTMLRewriter = saved; }
});

test("worker: /stats asks GitHub and npm itself, and gives null when it can't", async () => {
  const { fetchStats, statsResponse } = await import("../worker/stats.js");
  const asked = [];
  const ok = async (url, init) => {
    asked.push([url, init]);
    if (url === "https://api.github.com/repos/Remmynd/remmynd") return Response.json({ stargazers_count: 12, name: "remmynd" });
    if (url === "https://api.npmjs.org/downloads/point/last-week/remmynd") return Response.json({ downloads: 3456 });
    throw new Error("unexpected " + url);
  };
  assert.deepEqual(await fetchStats(ok), { stars: 12, downloads: 3456 });
  for (const [, init] of asked) assert.deepEqual(Object.keys(init.headers).sort(), ["Accept", "User-Agent"], "nothing about the visitor is sent");

  const broken = async url => url.includes("github") ? new Response("rate limited", { status: 403 }) : new Response("not json");
  assert.deepEqual(await fetchStats(broken), { stars: null, downloads: null });
  assert.deepEqual(await fetchStats(async () => { throw new Error("offline"); }), { stars: null, downloads: null });
  assert.deepEqual(await fetchStats(async () => Response.json({ stargazers_count: "12", downloads: -1 })), { stars: null, downloads: null });

  const full = await statsResponse(new Request("https://remmynd.space/stats"), {}, null, ok);
  assert.equal(full.headers.get("cache-control"), "public, max-age=3600");
  assert.match(full.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(await full.json(), { stars: 12, downloads: 3456 });
  const part = await statsResponse(new Request("https://remmynd.space/stats"), {}, null, async url => url.includes("github") ? ok(url, {}) : new Response("", { status: 500 }));
  assert.equal(part.headers.get("cache-control"), "public, max-age=300", "a gap is tried again sooner");
  assert.deepEqual(await part.json(), { stars: 12, downloads: null });
  assert.equal((await statsResponse(new Request("https://remmynd.space/stats", { method: "POST" }), {}, null, ok)).status, 405);

  // The route, through the Worker.
  const worker = (await import("../worker/index.js")).default;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ok;
  try { assert.deepEqual(await (await worker.fetch(new Request("https://remmynd.space/stats"), {}, { waitUntil() {} })).json(), { stars: 12, downloads: 3456 }); }
  finally { globalThis.fetch = realFetch; }
  // The service worker never caches it, and the page asks only remmynd.space.
  assert.match(readFileSync(join(root, "public/sw.js"), "utf8"), /url\.pathname === "\/stats"\) return;/);
  assert.match(readFileSync(join(root, "public/site.js"), "utf8"), /fetch\("\/stats"\)/);
});

test("website: site.js shares the app's theme code and runs", () => {
  const site = readFileSync(join(root, "public/site.js"), "utf8"), app = readFileSync(join(root, "public/app.js"), "utf8");
  const theme = js => /const PAPER=[\s\S]*?b\.dataset\.themeSet===t\)\)\);\}/.exec(js)[0];
  assert.equal(theme(site), theme(app), "site.js and app.js apply the theme the same way");
  assert.doesNotThrow(() => new Function(site), "public/site.js has a syntax error");

  // Run it against a small fake page: the menu opens and closes, and a missing number keeps its tile hidden.
  const el = (extra = {}) => { const e = { hidden: false, attrs: {}, on: {}, dataset: {}, textContent: "", focus() { focused = e; }, ...extra };
    e.setAttribute = (k, v) => { e.attrs[k] = v; }; e.addEventListener = (k, f) => { e.on[k] = f; }; return e; };
  let focused = null;
  const link = el(), x = el(), menu = el({ hidden: true }), btn = el(), docKeys = {};
  menu.querySelector = () => link; menu.querySelectorAll = () => [link, x];
  const stars = el({ hidden: true, dataset: { stat: "stars" } }), downloads = el({ hidden: true, dataset: { stat: "downloads" } });
  for (const t of [stars, downloads]) { const b = el(); t.querySelector = () => b; t.b = b; }
  const byId = { "#menu": menu, "#menu-btn": btn, "#menu-x": x };
  const document = { documentElement: { dataset: {} }, activeElement: btn,
    querySelector: s => byId[s] || null,
    querySelectorAll: s => s === "[data-stat]" ? [stars, downloads] : [],
    addEventListener: (k, f) => { docKeys[k] = f; } };
  let answer;
  const fetch = url => { assert.equal(url, "/stats"); return Promise.resolve({ ok: true, json: () => Promise.resolve(answer) }); };
  answer = { stars: 1234, downloads: null };
  new Function("document", "localStorage", "fetch", "navigator", site)(document, { getItem: () => null }, fetch, {});
  btn.on.click();
  assert.equal(menu.hidden, false);
  assert.equal(btn.attrs["aria-expanded"], "true");
  assert.equal(focused, link, "the first link takes focus");
  docKeys.keydown({ key: "Escape" });
  assert.equal(menu.hidden, true);
  assert.equal(focused, btn, "focus goes back to the Menu button");
  return new Promise(r => setTimeout(r, 0)).then(() => {
    assert.equal(stars.hidden, false);
    assert.equal(stars.b.textContent, "1,234");
    assert.equal(downloads.hidden, true, "a missing number keeps its tile hidden");
  });
});

/* ---------- step 9: polish ---------- */

test("accessibility: every token colour pair meets WCAG AA in both themes", () => {
  const css = readFileSync(join(root, "docs/v2/tokens.css"), "utf8");
  const block = re => Object.fromEntries([...re.exec(css)[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const light = block(/:root\s*{([\s\S]*?)\n}/), dark = { ...light, ...block(/:root\[data-theme="dark"\]\s*{([\s\S]*?)\n}/) };
  const rgb = v => { const h = /^#([0-9a-f]{6})$/i.exec(v); if (h) return [0, 2, 4].map(i => parseInt(h[1].slice(i, i + 2), 16)).concat(1);
    const m = /^rgba?\(([^)]+)\)$/.exec(v); assert.ok(m, "a colour: " + v); const p = m[1].split(",").map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // [text, background, minimum]: every pairing the app and the website use for text.
  const pairs = [["ink", "paper", 4.5], ["ink", "card", 4.5], ["ink", "well", 4.5], ["ink-2", "paper", 4.5], ["ink-2", "card", 4.5], ["ink-2", "hairline", 4.5],
    ["muted", "paper", 4.5], ["muted", "card", 4.5], ["muted", "well", 4.5], ["paper", "ink", 4.5], ["on-moment", "moment", 4.5], ["on-moment-tint", "moment-tint", 4.5],
    ["on-band", "band", 4.5], ["on-band-muted", "band", 4.5], ["band-accent", "band", 3]];
  for (const [name, t] of [["light", light], ["dark", dark]]) for (const [fg, bg, min] of pairs) {
    const base = rgb(t.card), b = over(rgb(t[bg]), base), f = over(rgb(t[fg]), b), r = ratio(f, b);
    assert.ok(r >= min, `${name}: --${fg} on --${bg} is ${r.toFixed(2)}:1, under ${min}:1`);
  }
});

test("accessibility: tap targets, dialogs, headings and focus", () => {
  const app = readFileSync(join(root, "public/app.css"), "utf8"), site = readFileSync(join(root, "public/site.css"), "utf8"), js = readFileSync(join(root, "public/app.js"), "utf8");
  // 44 px targets (spec section 3) on every control that has its own size.
  for (const [css, sel, prop] of [[app, ".seg button", "min-height"], [app, ".tabs a", "min-height"], [app, ".foot-grid nav a", "min-height"], [app, ".foot-grid nav a", "min-width"],
    [app, ".t-where", "min-height"], [app, ".brand", "min-height"], [app, ".ghost", "min-height"], [site, ".site-nav a", "min-height"], [site, ".site-nav a", "min-width"], [site, ".snippet .copy", "height"]]) {
    const rule = new RegExp("(?:^|})" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}", "m").exec(css);
    assert.ok(rule, "a rule for " + sel);
    assert.match(rule[1], new RegExp("(?:^|;)" + prop + ":var\\(--tap\\)"), sel + " sets " + prop + " to the 44 px --tap");
  }
  assert.match(app, /\.t-where a\{padding:14px 0;margin:-14px 0;/, "the place link on the ticket is 44 px tall to tap");
  // Every sheet is a modal dialog with a name; Tab stays inside it and focus comes back when it closes.
  for (const f of ["public/index.html", ...PAGES.map(pageFile)]) {
    const html = readFileSync(join(root, f), "utf8");
    for (const [, a] of html.matchAll(/<div class="sheet"([^>]*)>/g)) assert.match(a, /role="dialog" aria-modal="true" aria-label(ledby)?="[^"]+"/, f + ": a sheet is a named modal dialog");
    for (const [, a] of html.matchAll(/<img\b([^>]*)>/g)) assert.match(a, /\salt="/, f + ": every image has alt text");
    for (const [, a, inner] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) assert.ok(/aria-label="[^"]+"/.test(a) || untilStable(inner, /<[^>]+>/g, "").trim(), f + ": a button without a name");
    let last = 0;
    for (const [, l] of html.matchAll(/<h([1-4])[\s>]/g)) { assert.ok(!last || +l <= last + 1, f + ": heading h" + l + " follows h" + last); last = +l; }
  }
  assert.match(js, /document\.addEventListener\("keydown",e=>\{if\(e\.key!=="Tab"\)return;const s=\[\.\.\.document\.querySelectorAll\("\.sheet"\)\]\.find\(x=>!x\.hidden\)/, "Tab is kept inside an open sheet");
  assert.match(js, /new MutationObserver\([\s\S]*?lastOut\.focus\(\{preventScroll:true\}\)/, "focus returns when a sheet closes");
  assert.match(readFileSync(join(root, "public/site.js"), "utf8"), /Keep Tab inside the sheet while it is open/);
  // Motion: everything stops when the person asks for reduced motion.
  assert.match(app, /@media \(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
  // Old zone names the browser still reports show today's city names.
  assert.match(js, /CITY=\{Calcutta:"Kolkata",Saigon:"Ho Chi Minh",Kiev:"Kyiv",Katmandu:"Kathmandu",Rangoon:"Yangon"\}/);
  // A web address in an older link without https:// still opens as a link on the ticket.
  assert.match(js, /function showView\(r,key,priv\)\{if\(r\.l&&!isHttp\(r\.l\)&&webish\(r\.l\)\)r=\{\.\.\.r,l:"https:\/\/"\+r\.l\};/);
});

/* ---------- brand, credit and security ---------- */

test("credit: Zoof04 Inc. on every page and in every place that names the maker", () => {
  const read = f => readFileSync(join(root, f), "utf8");
  assert.match(read("LICENSE"), /^Copyright \(c\) 2026 Zoof04 Inc\.$/m);
  assert.equal(JSON.parse(read("package.json")).author, "Zoof04 Inc. (https://zoof04.com)");
  for (const [f, w] of [["README.md", "© 2026 Zoof04 Inc."], ["README.md", "## Name and logo"], ["brand/BRAND.md", "## Name and logo"], ["brand/BRAND.md", "[Zoof04 Inc.](https://zoof04.com)"],
    ["docs/PRINCIPLES.md", "built and maintained by [Zoof04 Inc.]"], ["public/llms.txt", "Made by Zoof04 Inc."], ["public/press/index.html", "Belong to Zoof04 Inc. and are not covered by the MIT licence"]]) assert.ok(read(f).includes(w), f + " says: " + w);
  for (const f of ["public/index.html", ...[...PAGES, "404"].map(pageFile)]) {
    const html = read(f);
    assert.ok(html.includes('<meta name="author" content="Zoof04 Inc.">'), f + ": author meta");
    assert.ok(html.includes('A free tool by <a href="https://zoof04.com">Zoof04 Inc.</a> MIT licence.'), f + ": footer credit");
    assert.ok(html.includes("© 2026 Zoof04 Inc."), f + ": copyright line");
  }
  // No credit to a bare "zoof04" is left (git identity, e-mail addresses, URLs and released changelog entries aside).
  for (const f of repoFiles()) {
    if (/\.(png|ico|woff2)$/.test(f) || f.startsWith(join(root, "test")) || f.includes(join("docs", "v2", "reference")) || f.endsWith("CHANGELOG.md")) continue;
    const bare = readFileSync(f, "utf8").match(/(?:\bby (?:<a [^>]*>|\[)?|© |Copyright \(c\) \d{4} )zoof04\b(?! Inc\.)/i);
    assert.ok(!bare, f + " credits " + (bare && bare[0]) + " instead of Zoof04 Inc.");
  }
  // The 1.x tagline is gone; the 2.0 headline is the tagline everywhere.
  for (const f of repoFiles()) {
    if (/\.(png|ico|woff2)$/.test(f) || f.startsWith(join(root, "test")) || f.includes(join("docs", "v2")) || f.endsWith("CHANGELOG.md") || f.endsWith("BRAND.md")) continue;
    assert.doesNotMatch(readFileSync(f, "utf8"), /reminders, as a link/i, f + " still uses the 1.x tagline");
  }
});

test("security: a strict content security policy, HSTS and security.txt", () => {
  const headers = readFileSync(join(root, "public/_headers"), "utf8");
  const csp = /^\/\*\n(?:  .*\n)*?  Content-Security-Policy: (.+)$/m.exec(headers);
  assert.ok(csp, "every response carries a Content-Security-Policy");
  const dir = Object.fromEntries(csp[1].split(";").map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir["default-src"], ["'self'"]);
  for (const k of ["style-src", "font-src", "connect-src", "worker-src", "manifest-src"]) assert.deepEqual(dir[k], ["'self'"], k);
  assert.deepEqual(dir["object-src"], ["'none'"]); assert.deepEqual(dir["base-uri"], ["'none'"]); assert.deepEqual(dir["frame-ancestors"], ["'none'"]);
  assert.doesNotMatch(csp[1], /unsafe-inline|unsafe-eval|\*|https?:/, "no wildcards, no other hosts, no unsafe sources");
  // The one inline script on every page (the theme line) is allowed by its hash, and nothing else is inline.
  const hashes = dir["script-src"].filter(v => v.startsWith("'sha256-")).map(v => v.slice(8, -1));
  for (const f of ["public/index.html", ...[...PAGES, "404"].map(pageFile)]) {
    const html = readFileSync(join(root, f), "utf8");
    const inline = [...html.matchAll(/<script\s*>([\s\S]*?)<\/script\b[^>]*>/gi)].map(m => m[1]);
    assert.equal(inline.length, 1, f + ": one inline script");
    assert.ok(hashes.includes(createHash("sha256").update(inline[0]).digest("base64")), f + ": the inline script's hash is in script-src");
    assert.doesNotMatch(html, /\son[a-z]+="|\sstyle="|javascript:/i, f + ": no inline handlers, styles or javascript: links");
  }
  for (const f of readdirSync(join(root, "public")).filter(f => f.endsWith(".js"))) {
    let js = readFileSync(join(root, "public", f), "utf8");
    // The one exception: embedHTML() in the library writes a snippet for other sites' pages, sized with a style attribute.
    if (f === "remmynd.js") js = js.replace(/export function embedHTML\([\s\S]*?\n\}\n/, "");
    assert.doesNotMatch(js, /setAttribute\(\s*["']style|\sstyle=\\?["']|\beval\(|new Function\(/, "public/" + f + " writes nothing the policy would block");
  }
  assert.match(headers, /^  Strict-Transport-Security: max-age=31536000; includeSubDomains$/m);
  assert.match(headers, /^  X-Frame-Options: DENY$/m);
  const sec = readFileSync(join(root, "public/.well-known/security.txt"), "utf8");
  assert.match(sec, /^Contact: mailto:connect@zoof04\.com$/m);
  assert.match(sec, /^Canonical: https:\/\/remmynd\.space\/\.well-known\/security\.txt$/m);
  const expires = Date.parse(/^Expires: (\S+)$/m.exec(sec)[1]);
  assert.ok(expires > Date.now() && expires < Date.now() + 400 * 864e5, "security.txt expires within the next year, as RFC 9116 asks");
  assert.match(readFileSync(join(root, ".github/dependabot.yml"), "utf8"), /package-ecosystem: github-actions/);
});

test("brand images are the 2.0 set, at the sizes their files name", () => {
  const size = f => { const b = readFileSync(join(root, f)); assert.equal(b.toString("ascii", 1, 4), "PNG", f + " is a PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(size("public/og.png"), [1200, 630]);
  for (const f of readdirSync(join(root, "brand/social"))) { const m = /(\d+)x(\d+)\.png$/.exec(f); if (m) assert.deepEqual(size("brand/social/" + f), [+m[1], +m[2]], f); }
  const man = JSON.parse(readFileSync(join(root, "public/manifest.webmanifest"), "utf8"));
  assert.match(man.description, /^Reminders that make sure it happens\./);
  for (const s of man.screenshots) assert.deepEqual(size("public/" + s.src).join("x"), s.sizes, s.src);
});

test("pipelines: workflows pin their actions, keep tokens to themselves and declare permissions", () => {
  const dir = join(root, ".github/workflows");
  for (const f of readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
    const y = readFileSync(join(dir, f), "utf8");
    assert.match(y, /^permissions:\n/m, f + " declares its permissions at the top");
    for (const [, ref, comment] of y.matchAll(/uses:\s*(\S+)(.*)$/gm)) {
      assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, f + ": " + ref + " is pinned to a full commit, not a tag");
      assert.match(comment, /^\s+# v\d+(\.\d+)*$/, f + ": " + ref + " names its version in a comment, for Dependabot and readers");
    }
    for (const m of y.matchAll(/- uses: actions\/checkout@\S+.*\n((?:\s{8,}.*\n)*)/g)) assert.match(m[1], /persist-credentials: false/, f + ": checkout leaves no token in .git/config");
  }
  const ci = readFileSync(join(dir, "ci.yml"), "utf8");
  assert.match(ci, /^on:\n  push:\n    branches: \[main\]\n  pull_request:\n  merge_group:\n/m, "CI runs on pushes to main, pull requests and the merge queue");
  const live = readFileSync(join(dir, "live-check.yml"), "utf8");
  assert.match(live, /loads from another host/, "the live check fails if a page loads from another host");
  assert.match(live, /content-security-policy: default-src 'self'/, "the live check looks for the security policy header");
});

test("security: crafted input can't make the library or the page slow", () => {
  const fast = (label, fn) => { const t = performance.now(); fn(); const ms = performance.now() - t; assert.ok(ms < 250, label + " took " + ms.toFixed(0) + " ms"); };
  fast("decode with many r/-? parts", () => R.decode("r/-?".repeat(20000) + "\n"));
  fast("decode with many #", () => R.decode("#".repeat(50000)));
  fast("fromQuery with many #", () => R.fromQuery("#".repeat(50000) + "\n"));
  fast("createLink with a base of slashes", () => R.createLink({ title: "x", start: "2026-12-05T18:00Z" }, { base: "/".repeat(50000) + "x" }));
  fast("parse with invite and many spaces", () => R.parse("invite" + " ".repeat(50000) + "x", { now: new Date("2026-11-10T12:00:00Z"), timeZone: "UTC" }));
  // The same link reads back in every form.
  const link = R.createLink({ title: "Demo", start: "2026-12-05T18:00Z" }), payload = link.split("/r/")[1];
  for (const form of [link, link + "/", link + "?x=1", "r/" + payload, payload, "https://remmynd.space/#" + payload]) assert.equal(R.decode(form)?.title, "Demo", form);
  assert.equal(R.createLink({ title: "x", start: "2026-12-05T18:00Z" }, { base: "https://example.org//#y" }).split("/r/")[0], "https://example.org");
  // The page looks up named examples among its own keys only, so #constructor is just an unknown link.
  assert.match(readFileSync(join(root, "public/app.js"), "utf8"), /const PRESETS=new Map\(Object\.entries\(\{[\s\S]*?const preset=PRESETS\.get\(h\);if\(typeof preset==="function"\)return showView\(preset\(\),h,false\);/);
});

/* ---------- UX: remind after making, delete with undo, edit, night-time ---------- */

test("ux: Remind me right after making, delete with Undo, edit, and a sleep-safe offer", () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8"), html = readFileSync(join(root, "public/index.html"), "utf8"), push = readFileSync(join(root, "public/push.js"), "utf8");
  // The ready screen leads with Remind me, then Share it; Edit goes back to the line.
  assert.match(html, /<div class="ready-do">\s*<button type="button" class="remind" id="f-remind">Remind me<\/button>[\s\S]*?id="f-edit">Edit this reminder<\/button>\s*<\/div>\s*<div class="label">Share it<\/div>/);
  // One tap: open the new reminder and press its own Remind me inside the same tap.
  assert.match(app, /F\.remind\.addEventListener\("click",\(\)=>\{const m=D\.made;if\(!m\)return;const u=new URL\(m\.link\);S\.back=true;history\.pushState\(null,"",u\.pathname\+u\.hash\);route\(\);const b=\$\("#remind"\);if\(b\)b\.click\(\);\}\);/);
  // Delete waits 5 seconds behind Undo; leaving the page finishes it; a held reminder's alerts are cancelled with it.
  assert.match(app, /function later\(key,run,undo,msg\)\{PEND\.set\(key,\{run,t:setTimeout\(\(\)=>\{PEND\.delete\(key\);run\(\);\},5000\)\}\);/);
  assert.match(app, /addEventListener\("pagehide",\(\)=>\{for\(const\[k,p\]of PEND\)/);
  assert.match(app, /const forgetRec=k=>\{if\(window\.remmyndDB\)window\.remmyndDB\.del\("reminders",k\)[^}]*\}\;?[^}]*window\.__rmPush\.cancel\(k\)/);
  assert.match(app, /L\.recs=L\.recs\.filter\(x=>!PEND\.has\("r:"\+x\.rkey\)\);L\.links=L\.links\.filter\(x=>!PEND\.has\("l:"\+x\.share\)\)/, "a pending delete stays out of the lists");
  assert.match(app, /id="s-remove">Remove this reminder<\/button>/, "a held reminder can be removed before it starts");
  assert.match(app, /"Removed\. Delete it from your calendar too\."/);
  assert.match(app, /e\.key==="Delete"\|\|e\.key==="Backspace"/, "the Delete key removes the row in focus");
  assert.match(app, /class="li-more" aria-label="Actions for '\+esc\(t\)\+'" aria-expanded="false"/, "every row has a visible actions button");
  // Edit: the made reminder's parts back in the line; making it again replaces the old link.
  assert.match(app, /D\.replace=link;/);
  assert.match(app, /keepLink\(D\.replace\|\|undefined\);D\.replace=null;/);
  // Night-time: offered only for a reminder at least 12 hours away, and off unless chosen.
  assert.match(app, /night=\(p\.h>=23\|\|p\.h<7\)&&start-Date\.now\(\)>=432e5;/);
  assert.match(app, /if\(o\.interactive&&S\.morning===null\)S\.morning=false;/);
  assert.doesNotMatch(app, /S\.morning=night/);
  // The chime plays once when a held reminder starts while the page is open.
  assert.match(app, /if\(S\.held&&was&&was!=="due"&&ph==="due"&&document\.visibilityState==="visible"\)\{chime\(\);/);
  // A test alert from the Notification row.
  assert.match(push, /id="n-test">Test<\/button>/);
  assert.match(push, /reg\.showNotification\(d\.r\.t, \{ body: "Test alert\. This is how remmynd will remind you\."/);
  // The badge maker lives on For hosts now, not in the app.
  assert.ok(!html.includes('id="badge"') && html.includes('href="/hosts#badge"'));
  assert.doesNotMatch(app, /snippet\(|SNIP/);
});

test("app: every element the app looks up by id is on the page", () => {
  // Removing markup without removing the code that uses it breaks the page at run time (setMode once did).
  const app = readFileSync(join(root, "public/app.js"), "utf8"), html = readFileSync(join(root, "public/index.html"), "utf8");
  const made = new Set([...app.matchAll(/id="([\w-]+)"/g)].map(m => m[1])); // ids the app writes into the page itself
  const missing = [...new Set([...app.matchAll(/\$\("#([\w-]+)"\)/g)].map(m => m[1]))].filter(id => !html.includes('id="' + id + '"') && !made.has(id));
  assert.deepEqual(missing, [], "app.js looks up ids that index.html doesn't have");
});

/* ---------- optional sign-in: passkeys, email codes, sync and email reminders ---------- */

// A test passkey: a real key pair and the bytes an authenticator would sign.
async function testPasskey(alg = "ES256") {
  const { webcrypto } = await import("node:crypto");
  const W = await import("../worker/webauthn.js");
  const pair = alg === "ES256" ? await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
    : await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const spki = W.b64url(await webcrypto.subtle.exportKey("spki", pair.publicKey));
  const id = W.randomId(20);
  const cd = (type, challenge, origin) => W.b64url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })));
  // DER-encode a raw ECDSA signature, the way authenticators send it.
  const der = raw => { const int = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.from([0, ...b]); return [0x02, b.length, ...b]; };
    const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))]; return Uint8Array.from([0x30, body.length, ...body]); };
  async function assertion(challenge, { origin = "https://remmynd.space", rpId = "remmynd.space", counter = 1, flags = 0x05 } = {}) {
    const rpHash = new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
    const auth = Uint8Array.from([...rpHash, flags, (counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255]);
    const clientDataJSON = cd("webauthn.get", challenge, origin);
    const cdHash = new Uint8Array(await webcrypto.subtle.digest("SHA-256", W.fromB64url(clientDataJSON)));
    const signed = Uint8Array.from([...auth, ...cdHash]);
    let sig = new Uint8Array(await webcrypto.subtle.sign(alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" }, pair.privateKey, signed));
    if (alg === "ES256") sig = der(sig);
    return { id, clientDataJSON, authenticatorData: W.b64url(auth), signature: W.b64url(sig) };
  }
  const registration = (challenge, origin = "https://remmynd.space") => ({ id, clientDataJSON: cd("webauthn.create", challenge, origin), publicKey: spki, alg: alg === "ES256" ? -7 : -8 });
  return { id, spki, alg: alg === "ES256" ? -7 : -8, assertion, registration };
}

test("passkeys: registration and sign-in are checked with real signatures", async () => {
  const W = await import("../worker/webauthn.js");
  for (const alg of ["ES256", "EdDSA"]) {
    const k = await testPasskey(alg), origin = "https://remmynd.space";
    const reg = await W.verifyRegistration(k.registration("c1"), { challenge: "c1", origin });
    assert.deepEqual(reg, { id: k.id, publicKey: k.spki, alg: k.alg });
    await assert.rejects(W.verifyRegistration(k.registration("c1", "https://evil.example"), { challenge: "c1", origin }), /origin/);
    await assert.rejects(W.verifyRegistration(k.registration("other"), { challenge: "c1", origin }), /challenge/);
    const ok = { challenge: "c2", origin, rpId: "remmynd.space", publicKey: k.spki, alg: k.alg };
    assert.equal(await W.verifyAssertion(await k.assertion("c2", { counter: 7 }), ok), 7, alg + " signs in");
    await assert.rejects(W.verifyAssertion(await k.assertion("c2"), { ...ok, challenge: "c3" }), /challenge/);
    await assert.rejects(W.verifyAssertion(await k.assertion("c2", { origin: "https://remmynd.space.evil.example" }), ok), /origin/);
    await assert.rejects(W.verifyAssertion(await k.assertion("c2", { rpId: "evil.example" }), ok), /relying party/);
    await assert.rejects(W.verifyAssertion(await k.assertion("c2", { flags: 0x04 }), ok), /present/);
    await assert.rejects(W.verifyAssertion(await k.assertion("c2", { counter: 3 }), { ...ok, signCount: 5 }), /counter/);
    const other = await testPasskey(alg);
    await assert.rejects(W.verifyAssertion(await other.assertion("c2"), ok), /signature/, "another key's signature fails");
  }
});

// The account store, in memory, with the same methods and rules as the D1 one.
function memoryStore() {
  const t = { users: new Map(), passkeys: new Map(), sessions: new Map(), codes: new Map(), challenges: new Map(), items: new Map(), mails: new Map(), sends: new Map() };
  const ik = (u, k, key) => u + "|" + k + "|" + key;
  return { t,
    ready: async () => {},
    userByEmail: async e => [...t.users.values()].find(u => u.email === e) || null,
    userById: async id => t.users.get(id) || null,
    createUser: async u => { t.users.set(u.id, { ...u, email_alerts: 1 }); },
    setEmailAlerts: async (id, on) => { const u = t.users.get(id); if (u) u.email_alerts = on ? 1 : 0; },
    stopEmails: async (id, token) => { const u = t.users.get(id); if (u && u.stop_token === token) u.email_alerts = 0; },
    deleteUser: async id => { for (const k of ["passkeys", "sessions", "mails"]) for (const [x, v] of t[k]) if (v.user_id === id) t[k].delete(x); for (const [x, v] of t.items) if (v.user_id === id) t.items.delete(x); t.users.delete(id); },
    passkeysOf: async id => [...t.passkeys.values()].filter(p => p.user_id === id).map(p => ({ id: p.id, name: p.name, created: p.created, last_used: p.last_used })),
    passkey: async id => t.passkeys.get(id) || null,
    addPasskey: async p => { t.passkeys.set(p.id, { id: p.id, user_id: p.userId, public_key: p.publicKey, alg: p.alg, sign_count: 0, name: p.name, created: p.created, last_used: null }); },
    usePasskey: async (id, count, now) => { const p = t.passkeys.get(id); p.sign_count = count; p.last_used = now; },
    deletePasskey: async (userId, id) => { const p = t.passkeys.get(id); if (p && p.user_id === userId) t.passkeys.delete(id); },
    createSession: async s => { t.sessions.set(s.hash, { token_hash: s.hash, user_id: s.userId, created: s.created, expires: s.expires }); },
    session: async h => t.sessions.get(h) || null,
    extendSession: async (h, expires) => { const s = t.sessions.get(h); if (s) s.expires = expires; },
    deleteSession: async h => { t.sessions.delete(h); },
    code: async e => t.codes.get(e) || null,
    putCode: async c => { t.codes.set(c.email, { ...c, tries: 0 }); },
    tryCode: async e => { const c = t.codes.get(e); if (c) c.tries++; },
    deleteCode: async e => { t.codes.delete(e); },
    countSend: async hour => { t.sends.set(hour, (t.sends.get(hour) || 0) + 1); return t.sends.get(hour); },
    putChallenge: async c => { t.challenges.set(c.id, { id: c.id, challenge: c.challenge, user_id: c.userId || null, kind: c.kind, expires: c.expires }); },
    takeChallenge: async id => { const c = t.challenges.get(id) || null; t.challenges.delete(id); return c; },
    items: async (u, since) => [...t.items.values()].filter(x => x.user_id === u && x.updated > since).sort((a, b) => a.updated - b.updated),
    itemUpdated: async (u, k, key) => t.items.get(ik(u, k, key))?.updated || 0,
    countItems: async u => [...t.items.values()].filter(x => x.user_id === u && !x.deleted).length,
    putItems: async (u, list) => { for (const x of list) { const old = t.items.get(ik(u, x.kind, x.key)); if (!old || x.updated >= old.updated) t.items.set(ik(u, x.kind, x.key), { user_id: u, kind: x.kind, key: x.key, data: x.data, updated: x.updated, deleted: x.deleted ? 1 : 0 }); } },
    reminders: async u => [...t.items.values()].filter(x => x.user_id === u && x.kind === "reminder" && !x.deleted).map(x => ({ key: x.key, data: x.data })),
    setMails: async (u, key, list) => { for (const [id, m] of t.mails) if (m.user_id === u && m.key === key) t.mails.delete(id); for (const m of list) t.mails.set(m.id, { ...m, user_id: u, key }); },
    clearMails: async u => { for (const [id, m] of t.mails) if (m.user_id === u) t.mails.delete(id); },
    dueMails: async now => [...t.mails.values()].filter(m => m.at <= now).sort((a, b) => a.at - b.at).map(m => { const u = t.users.get(m.user_id), i = t.items.get(ik(m.user_id, "reminder", m.key));
      return { id: m.id, kind: m.kind, at: m.at, data: i && !i.deleted ? i.data : null, email: u.email, email_alerts: u.email_alerts, user_id: u.id, stop_token: u.stop_token }; }),
    deleteMail: async id => { t.mails.delete(id); },
    cleanup: async () => {},
  };
}

test("account: sign in with an emailed code, a passkey, sync, email reminders and delete", async () => {
  const A = await import("../worker/account.js");
  const store = memoryStore(), sent = [];
  let now = Date.parse("2026-11-20T08:00:00Z");
  const mailer = async msg => { sent.push(msg); return 200; };
  const base = "https://remmynd.space";
  let jar = "", devEnv = {};
  const call = async (path, body, { origin = base, method = body === undefined ? "GET" : "POST", host = base, ctype = "application/json", mail = mailer, cookie = jar } = {}) => {
    const headers = { "content-type": ctype };
    if (origin) headers.origin = origin;
    if (cookie) headers.cookie = cookie;
    const req = new Request(host + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await A.handleAccount(req, devEnv, new URL(req.url), null, { store, mailer: mail, now });
    const sc = res.headers.get("set-cookie");
    return { status: res.status, body: await res.json().catch(() => null), cookie: sc };
  };

  // Changes need POST, JSON and this site's origin.
  assert.equal((await call("/api/auth/email/start", { email: "a@b.co" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call("/api/auth/email/start", { email: "a@b.co" }, { origin: null })).status, 403);
  assert.equal((await call("/api/auth/email/start", { email: "a@b.co" }, { ctype: "text/plain" })).status, 415);
  assert.equal((await call("/api/auth/signout", undefined, { method: "GET" })).status, 405);
  assert.equal((await call("/api/sync", { since: 0, items: [] })).status, 401, "sync needs a signed-in account");
  assert.deepEqual((await call("/api/me")).body, { signedIn: false });

  // Email code: sent through the mailer; no mailer on the live site is an error; on localhost the code comes back for testing.
  assert.equal((await call("/api/auth/email/start", { email: "Person@Example.com" }, { mail: null })).status, 503);
  assert.equal((await call("/api/auth/email/start", { email: "dev@example.com" }, { host: "http://localhost:8787", origin: "http://localhost:8787", mail: null })).status, 503, "localhost alone never shows the code");
  devEnv = { DEV_SHOW_CODE: "1" };
  assert.match((await call("/api/auth/email/start", { email: "dev@example.com" }, { mail: null })).body.devCode, /^\d{6}$/, "DEV_SHOW_CODE=1 with no email key shows the code, for local tests");
  assert.equal((await call("/api/auth/email/start", { email: "dev2@example.com" })).body.devCode, undefined, "never when email is set up");
  devEnv = {};
  sent.length = 0;
  assert.equal((await call("/api/auth/email/start", { email: "not an email" })).status, 400);
  assert.equal((await call("/api/auth/email/start", { email: "Person@Example.com" })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "person@example.com");
  const code = /Your remmynd code: (\d{6})/.exec(sent[0].subject)[1];
  assert.ok(sent[0].text.includes(code.slice(0, 3) + " " + code.slice(3)));
  assert.equal((await call("/api/auth/email/start", { email: "person@example.com" })).status, 429, "one code a minute");
  const wrong = code === "000000" ? "111111" : "000000";
  assert.equal((await call("/api/auth/email/verify", { email: "person@example.com", code: wrong })).status, 400);
  const signin = await call("/api/auth/email/verify", { email: "person@example.com", code });
  assert.equal(signin.status, 200);
  assert.equal(signin.body.isNew, true);
  assert.match(signin.cookie, /^rm_s=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=15552000; Secure$/);
  assert.equal((await call("/api/auth/email/verify", { email: "person@example.com", code })).status, 400, "a code works once");
  jar = signin.cookie.split(";")[0];
  assert.deepEqual((await call("/api/me")).body, { signedIn: true, email: "person@example.com", emailAlerts: true, passkeys: [] });

  // Add a passkey, then sign in with it.
  const k = await testPasskey("ES256");
  const ro = await call("/api/passkeys/options", {});
  assert.equal(ro.body.publicKey.rp.id, "remmynd.space");
  assert.equal(ro.body.publicKey.authenticatorSelection.residentKey, "required");
  const added = await call("/api/passkeys/add", { challengeId: ro.body.challengeId, ...k.registration(ro.body.publicKey.challenge), name: "iPhone" });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.passkeys.map(p => p.name), ["iPhone"]);
  assert.equal((await call("/api/passkeys/add", { challengeId: ro.body.challengeId, ...k.registration(ro.body.publicKey.challenge) })).status, 400, "a challenge works once");
  const lo = await call("/api/auth/passkey/options", {}, { cookie: "" });
  const pk = await call("/api/auth/passkey/verify", { challengeId: lo.body.challengeId, ...(await k.assertion(lo.body.publicKey.challenge, { counter: 1 })) }, { cookie: "" });
  assert.equal(pk.status, 200);
  assert.match(pk.cookie, /^rm_s=/);
  const lo2 = await call("/api/auth/passkey/options", {}, { cookie: "" });
  const forged = await testPasskey("ES256");
  assert.equal((await call("/api/auth/passkey/verify", { challengeId: lo2.body.challengeId, ...(await forged.assertion(lo2.body.publicKey.challenge)), id: k.id }, { cookie: "" })).status, 400, "another key can't use this passkey's id");

  // Sync: newest wins, private links never stored, and held reminders get emails.
  const start = now + 3 * 3600e3, share = base + "/r/abc";
  const rec = { rkey: "k1", title: "Demo day", start, dur: 60, place: "Room 4", share, state: "held", tz: "Asia/Kolkata" };
  let s1 = await call("/api/sync", { since: 0, items: [
    { kind: "reminder", key: "k1", data: rec, updated: now },
    { kind: "link", key: base + "/#private", data: { share: base + "/#private", title: "Secret" }, updated: now },
    { kind: "link", key: share, data: { share, title: "Demo day" }, updated: now },
  ] });
  assert.equal(s1.status, 200);
  assert.deepEqual(s1.body.items.map(i => i.kind + ":" + i.key).sort(), ["link:" + share, "reminder:k1"], "the private link isn't stored");
  assert.ok(![...store.t.items.values()].some(i => /#private|Secret/.test(i.key + i.data)));
  assert.deepEqual([...store.t.mails.values()].map(m => m.kind + "@" + (m.at - start) / 60e3).sort(), ["before@-60", "start@0"]);
  await call("/api/sync", { since: 0, items: [{ kind: "reminder", key: "k1", data: { ...rec, title: "Old" }, updated: now - 1000 }] });
  assert.equal(JSON.parse(store.t.items.get(store.t.items.keys().next().value).data).title, "Demo day", "an older change doesn't win");
  const since = s1.body.now;

  // Emails: sent when due, with a stop link and only links to this site; a failure is retried.
  now = start - 3600e3;
  let fail = true;
  await A.sendDueMails({}, now, { store, origin: base, mailer: async m => { if (fail) return 500; sent.push(m); return 200; } });
  assert.equal(store.t.mails.size, 2, "a failed send stays for the next minute");
  fail = false;
  const r1 = await A.sendDueMails({}, now, { store, origin: base, mailer: async m => { sent.push(m); return 200; } });
  assert.equal(r1.sent, 1);
  const mail = sent.at(-1);
  assert.equal(mail.subject, "In 1 hour: Demo day");
  assert.equal(mail.to, "person@example.com");
  assert.match(mail.headers["List-Unsubscribe"], /^<https:\/\/remmynd\.space\/api\/mail\/stop\?u=[\w-]+&t=[\w-]+>$/);
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(mail.html.includes('href="' + share + '"') && mail.text.includes("Open it: " + share));
  const evil = A.reminderMail({ ...rec, share: "https://evil.example/x", title: "<b>x</b>" }, "start", base + "/stop", base);
  assert.ok(!evil.html.includes("evil.example") && !evil.text.includes("evil.example") && evil.html.includes("&lt;b&gt;x&lt;/b&gt;"), "links elsewhere are dropped and titles escaped");

  // Done or deleted: the rest of the emails are cancelled. (A tie goes to the change that arrives last.)
  now += 1000;
  await call("/api/sync", { since, items: [{ kind: "reminder", key: "k1", data: { ...rec, state: "kept" }, updated: now }] });
  assert.equal(store.t.mails.size, 0);
  now += 1000;
  await call("/api/sync", { since, items: [{ kind: "reminder", key: "k1", data: rec, updated: now }] });
  assert.equal(store.t.mails.size, 1, "held again: the start email is back");
  now += 1000;
  const del = await call("/api/sync", { since, items: [{ kind: "reminder", key: "k1", deleted: true, updated: now }] });
  assert.ok(del.body.items.some(i => i.key === "k1" && i.deleted));
  assert.equal(store.t.mails.size, 0);

  // Email reminders off and on; the stop link turns them off without signing in.
  now += 1000;
  await call("/api/sync", { since, items: [{ kind: "reminder", key: "k2", data: { ...rec, rkey: "k2", start: now + 7200e3 }, updated: now }] });
  assert.equal(store.t.mails.size, 2);
  assert.equal((await call("/api/account/settings", { emailAlerts: false })).body.emailAlerts, false);
  assert.equal(store.t.mails.size, 0);
  assert.equal((await call("/api/account/settings", { emailAlerts: true })).body.emailAlerts, true);
  assert.equal(store.t.mails.size, 2, "turning emails back on schedules them again");
  const user = [...store.t.users.values()][0];
  const stop = await A.handleAccount(new Request(base + "/api/mail/stop?u=" + user.id + "&t=" + user.stop_token), {}, new URL(base + "/api/mail/stop?u=" + user.id + "&t=" + user.stop_token), null, { store, now });
  assert.match(await stop.text(), /Email reminders are off/);
  assert.equal(user.email_alerts, 0);

  // Sign out ends this session; deleting the account deletes everything.
  const out = await call("/api/auth/signout", {});
  assert.match(out.cookie, /^rm_s=; .*Max-Age=0/);
  assert.equal((await call("/api/sync", { since: 0, items: [] })).status, 401);
  jar = pk.cookie.split(";")[0];
  assert.equal((await call("/api/account/delete", {})).status, 200);
  for (const k of ["users", "passkeys", "sessions", "items", "mails"]) assert.equal(store.t[k].size, 0, k + " are deleted with the account");
});

test("account: the app loads sign-in only when needed and keeps private links on the device", () => {
  const app = readFileSync(join(root, "public/app.js"), "utf8"), acct = readFileSync(join(root, "public/account.js"), "utf8"), html = readFileSync(join(root, "public/index.html"), "utf8");
  assert.match(app, /import\("\/account\.js"\)\.then\(m=>m\.open\(\)\)/, "the sign-in sheet loads when asked for");
  assert.match(app, /if\(localStorage\.getItem\("rm:acct"\)==="1"\)import\("\/account\.js"\)\.then\(m=>m\.boot\(\)\)/, "and on signed-in devices, to sync");
  assert.ok(html.includes('<button type="button" class="btn" id="acct-btn">Sign in to sync and get email</button>'));
  assert.ok(app.includes("Private links stay on this device, so they aren't emailed"));
  assert.match(acct, /const isPrivate = share => String\(share \|\| ""\)\.includes\("\/#"\);/);
  assert.match(acct, /for \(const r of recs\) if \(!isPrivate\(r\.share\)\)/);
  assert.match(acct, /for \(const l of links\) if \(!isPrivate\(l\.share\)\)/);
  assert.match(acct, /PublicKeyCredential/);
  assert.doesNotMatch(readFileSync(join(root, "public/account.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, "account.css uses token names, not raw colours");
  // The first visit doesn't download any of it.
  assert.ok(!firstVisit({ cache: true }).some(f => /^account\./.test(f)));
  // Layout: the sheet's content box carries the spacing, and small buttons (Remove) keep their size
  // instead of the general ".sheet .btn" full width; the toast sizes to its text, not half the screen.
  const ac = readFileSync(join(root, "public/account.css"), "utf8"), appCss = readFileSync(join(root, "public/app.css"), "utf8");
  assert.match(ac, /#ac-body\{display:grid;gap:14px\}/);
  assert.match(ac, /\.ac-key \.btn\{width:auto;flex:none;/);
  assert.match(ac, /\.ac-card \.btn\{margin:0\}/);
  assert.match(appCss, /\.toast\{[^}]*transform:translate\(-50%,16px\);width:max-content;/);
});
