import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  assert.match(link, /^https:\/\/remmynd\.space\/#[A-Za-z0-9_-]+$/);
  const back = R.decode(link);
  assert.equal(back.title, sample.title);
  assert.equal(back.start.toISOString(), "2026-12-05T12:30:00.000Z");
  assert.equal(back.durationMinutes, 90);
  assert.equal(back.location, sample.location);
  assert.equal(back.host, "zoof04");
  assert.equal(R.decode("https://remmynd.space/#not-a-reminder"), null);
  assert.equal(R.createLink({ title: "x", start: 0 }, { base: "https://example.com/r" }).startsWith("https://example.com/r/#"), true);
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
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  const pick = name => html.split("\n").find(l => l.startsWith("const " + name + "="));
  const siteEnc = new Function(pick("enc") + "; return enc;")();
  const siteDec = new Function(pick("dec") + "; return dec;")();
  const frag = R.createLink(sample).split("#")[1];
  const fromSite = siteDec(frag);
  assert.equal(fromSite.t, sample.title);
  assert.equal(parseInt(fromSite.s, 36) * 60000, Date.parse("2026-12-05T12:30:00Z"));
  const siteFrag = siteEnc({ t: "Café launch", s: Math.round(Date.parse("2026-12-24T10:00:00Z") / 60000).toString(36), l: "Mumbai" });
  const lib = R.decode(siteFrag);
  assert.equal(lib.title, "Café launch");
  assert.equal(lib.location, "Mumbai");
  assert.equal(lib.start.toISOString(), "2026-12-24T10:00:00.000Z");
});

test("website script parses", () => {
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0, "no inline script found");
  for (const js of scripts) assert.doesNotThrow(() => new Function(js), "inline script has a syntax error");
  const sw = readFileSync(join(root, "public/sw.js"), "utf8");
  assert.doesNotThrow(() => new Function(sw), "public/sw.js has a syntax error");
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

test("published badge files match the library", () => {
  assert.equal(readFileSync(join(root, "public/badge.svg"), "utf8"), R.badgeSVG());
  assert.equal(readFileSync(join(root, "public/badge-dark.svg"), "utf8"), R.badgeSVG({ theme: "dark" }));
  assert.match(R.badgeMarkdown("https://remmynd.space/#abc"), /^\[!\[Remind me\]/);
});

test("CLI prints a working link", () => {
  const out = execFileSync(process.execPath, [join(root, "bin/remmynd.js"), "Demo", "day", "--at", "2026-12-05 18:00", "--tz", "Asia/Kolkata", "--json", "--badge", "md"], { encoding: "utf8" });
  const j = JSON.parse(out);
  assert.equal(R.decode(j.link).title, "Demo day");
  assert.match(j.badge, /badge\.svg/);
});

test("package version matches the library", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.version, R.VERSION);
});

test("repository credits zoof04 only", () => {
  // Checks every tracked file (or every file on disk when git isn't available), except this test folder.
  const skip = new Set([".git", "node_modules", "test", ".wrangler"]);
  const walk = d => readdirSync(d).flatMap(f => skip.has(f) ? [] : statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
  let files;
  try { files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).map(f => join(root, f)); }
  catch { files = walk(root); }
  // Other product and tool names must not appear anywhere in the repository.
  const banned = new RegExp([["sig", "ship"], ["cla", "ude"], ["anth", "ropic"]].map(p => p.join("")).join("|"), "i");
  for (const f of files) {
    if (/\.(png|ico)$/.test(f) || f.startsWith(join(root, "test"))) continue;
    assert.ok(!banned.test(readFileSync(f, "utf8")), "unexpected mention in " + f);
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
