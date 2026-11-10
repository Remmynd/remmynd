#!/usr/bin/env node
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { createLink, toICS, decode, badgeHTML, badgeMarkdown, googleCalendarUrl, systemTimeZone, VERSION } from "../lib/remmynd.js";

const HELP = `remmynd ${VERSION} — reminders that make sure it happens

Usage
  remmynd "<what>" --at "<YYYY-MM-DD HH:mm>" [options]
  remmynd read <link>   (shared /r/ or private /# links)

Options
  --at, -a       When, e.g. "2026-12-05 18:00" (local to --tz) or an ISO time with Z
  --tz, -z       IANA time zone for --at (default: ${systemTimeZone()})
  --where, -w    A place or a link
  --notes, -n    One line of notes
  --host         Who is hosting
  --length, -l   Minutes (default 60)
  --private, -p  Make a private link (/#…): no preview, never reaches a server
  --ics [file]   Also write an .ics file ("-" prints it)
  --badge <fmt>  Print a Remind me badge snippet: html or md
  --dark         Use the dark badge
  --google       Also print a Google Calendar link
  --json         Print everything as JSON
  --base <url>   Use your own remmynd host (default https://remmynd.space/)
  -h, --help     Show this help
  -v, --version  Show the version

Examples
  npx remmynd "Demo day" --at "2026-12-05 18:00" --tz Asia/Kolkata --where https://lu.ma/demo
  npx remmynd "Webinar" --at 2026-12-10T15:00Z --badge md
`;

function fail(msg) { process.stderr.write("remmynd: " + msg + "\n"); process.exit(1); }

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      at: { type: "string", short: "a" }, tz: { type: "string", short: "z" }, where: { type: "string", short: "w" },
      notes: { type: "string", short: "n" }, host: { type: "string" }, length: { type: "string", short: "l" },
      ics: { type: "string" }, badge: { type: "string" }, dark: { type: "boolean" }, google: { type: "boolean" },
      json: { type: "boolean" }, base: { type: "string" }, private: { type: "boolean", short: "p" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" }
    }
  });
} catch (e) { fail(e.message + "\nRun remmynd --help"); }

const { values: o, positionals: pos } = parsed;
if (o.version) { console.log(VERSION); process.exit(0); }
if (o.help || pos.length === 0) { console.log(HELP); process.exit(pos.length === 0 && !o.help ? 1 : 0); }

if (pos[0] === "read") {
  const r = decode(pos[1] || "");
  if (!r) fail("That is not a remmynd link");
  console.log(JSON.stringify({ ...r, start: r.start.toISOString() }, null, 2));
  process.exit(0);
}

if (!o.at) fail('Add a time with --at "YYYY-MM-DD HH:mm"');
const event = {
  title: pos.join(" "), start: o.at, timeZone: o.tz, location: o.where, notes: o.notes, host: o.host,
  durationMinutes: o.length ? Number(o.length) : undefined
};
const opts = { ...(o.base ? { base: o.base } : {}), private: !!o.private };
const theme = o.dark ? "dark" : "light";

try {
  const link = createLink(event, opts);
  const out = { link };
  if (o.google) out.google = googleCalendarUrl(event, opts);
  if (o.badge) {
    if (!["html", "md"].includes(o.badge)) fail("--badge must be html or md");
    out.badge = o.badge === "md" ? badgeMarkdown(link, { theme }) : badgeHTML(link, { theme });
  }
  if (o.ics !== undefined) {
    const ics = toICS(event, opts);
    if (o.ics === "-" || o.ics === "") out.ics = ics;
    else { writeFileSync(o.ics, ics); out.icsFile = o.ics; }
  }
  if (o.json) { console.log(JSON.stringify(out, null, 2)); }
  else {
    console.log(link);
    if (out.google) console.log("\nGoogle Calendar:\n" + out.google);
    if (out.badge) console.log("\n" + out.badge);
    if (out.ics) process.stdout.write("\n" + out.ics);
    if (out.icsFile) console.log("\nSaved " + out.icsFile);
  }
} catch (e) { fail(e.message); }
