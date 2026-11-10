import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
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
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
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
  assert.deepEqual([...html.matchAll(/data-theme-set="(\w+)"[^>]*>(\w+)</g)].map(m => m[1] + ":" + m[2]), ["auto:Auto", "light:Light", "dark:Dark"]);
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

// Just enough of Cloudflare's HTMLRewriter for the preview route: remove elements matched by
// tag or tag[attr="value"], and append HTML at the end of <head>.
class TestRewriter {
  constructor() { this.rules = []; }
  on(selector, handler) { this.rules.push([selector, handler]); return this; }
  transform(res) {
    const rules = this.rules;
    const body = new ReadableStream({ async start(c) {
      let html = await res.text();
      for (const [selector, h] of rules) {
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

test("published badge files match the library", () => {
  assert.equal(readFileSync(join(root, "public/badge.svg"), "utf8"), R.badgeSVG());
  assert.equal(readFileSync(join(root, "public/badge-dark.svg"), "utf8"), R.badgeSVG({ theme: "dark" }));
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

// Inline script bodies of an HTML page (not JSON data blocks), or a whole script file.
function scriptsIn(file, text) {
  if (/\.m?js$/.test(file)) return [text];
  if (!/\.(html|svg)$/.test(file)) return [];
  return [...text.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/type\s*=\s*["']?[^"'\s>]*json/i.test(m[1])).map(m => m[2]);
}

// What a page or SVG fetches by itself. Markup written inside a script is not markup.
function markupLoads(file, html) {
  const out = scriptsIn(file, html).flatMap(jsLoads);
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, "$1")
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { out.push(...cssLoads(css)); return ""; });
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

test("size budgets: app code under 60 KB, first visit under 150 KB", t => {
  const KB = 1000; // the stricter reading
  const sum = files => files.reduce((n, f) => n + wireSize(f), 0);
  const all = firstVisit({ cache: true }), page = firstVisit({ cache: false });
  for (const f of ["index.html", "app.css", "push.js", "sw.js", "fonts/geist-5.3-latin.woff2", "fonts/geist-mono-5.3-latin.woff2"]) assert.ok(all.includes(f), "the first visit includes " + f);
  const code = all.filter(f => /\.(html|css|m?js)$/.test(f));
  const k = n => (n / KB).toFixed(1) + " KB";
  t.diagnostic("app code " + k(sum(code)) + " (" + code.join(", ") + ")");
  t.diagnostic("first visit " + k(sum(all)) + ": the page " + k(sum(page)) + ", the service worker's cache adds " + k(sum(all) - sum(page)));
  assert.ok(sum(code) < 60 * KB, "app code is " + k(sum(code)) + ", over the 60 KB budget");
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
  assert.match(app, /function swap\(fn\)\{if\(document\.startViewTransition&&!STILL\.matches\)document\.startViewTransition\(fn\);else fn\(\);\}/);
  assert.match(app, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  // Two panes from 960 px: the maker on the left, the ticket on the right.
  assert.match(css, /@media \(min-width:960px\)\{[^@]*#home:not\(\[hidden\]\)\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,460px\)/);
  assert.match(css, /@media \(max-width:959px\)\{[^@]*\.maker\{display:contents\}/);
});

test("words: the maker uses the spec's wording", () => {
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  const app = readFileSync(join(root, "public/app.js"), "utf8");
  for (const w of ["Reminders that make sure it happens.",
    "Write it in one line and share the link. Anyone who taps it is reminded in layers and followed through until it's done. No account on either side.",
    ">New reminder<", 'placeholder="Demo day Fri 5pm zoom.us/j/123"', "Private link", "Keeps the title and time out of link previews.",
    "A free tool by <a href=\"https://zoof04.com\">zoof04</a>. MIT licence."]) assert.ok(html.includes(w), "index.html says: " + w);
  for (const w of ["Enter makes the link", "Not a link yet. Press Enter to make it."]) assert.ok(app.includes(w), "app.js says: " + w);
  assert.doesNotMatch(html + app, /microphone|Speak it/i, "no microphone in 2.0");
});

test("privacy and free wording match the approved text", () => {
  const approved = "Your reminder lives in the link and on your device. For phone alerts we keep only an anonymous ping time, deleted once it's sent.";
  for (const f of ["README.md", "docs/PRINCIPLES.md", "public/index.html"]) {
    assert.ok(readFileSync(join(root, f), "utf8").includes(approved), f + " uses the approved privacy sentence");
  }
  const principles = readFileSync(join(root, "docs/PRINCIPLES.md"), "utf8");
  assert.ok(principles.includes("## 2. Free, no sign-up, no tracking"), "principle 2 title");
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

test("sleep-safe: the 9 AM alert reads as already started", async () => {
  const src = readFileSync(join(root, "public/sw.js"), "utf8");
  const viewSrc = src.slice(src.indexOf("const short ="), src.indexOf("const PLATFORM_HAS_ACTIONS"));
  const view = new Function(viewSrc + "; return view;")();
  const start = Date.parse("2026-12-10T22:22:00Z");
  const v = view({ kind: "after", title: "Launch", start, at: start + 5 * 3600e3, place: "https://lu.ma/x" });
  assert.match(v.title, /^Launch started at /);
  assert.equal(v.body, "Tap to open lu.ma/x");
});
