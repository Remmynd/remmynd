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
  assert.match(html, /<link rel="stylesheet" href="app\.css">/);
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
  assert.match(html, /<head>[\s\S]*localStorage\.getItem\("rm:theme"\)[\s\S]*<link rel="stylesheet" href="app\.css">/, "saved theme is applied before styles load");

  // Run the page's theme code against a tiny fake document.
  const src = html.slice(html.indexOf("const PAPER="), html.indexOf("/* ---------- install (PWA)"));
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
// visit downloads (imports, the service worker, src); the rest are on-demand requests.
function jsLoads(js) {
  const kinds = [
    [/\b(fetch|sendBeacon|EventSource|WebSocket)\s*\(\s*(["'`])([^"'`]*)\2/g, false],
    [/\b(importScripts|Worker|SharedWorker|import|register)\s*\(\s*(["'`])([^"'`]*)\2/g, true],
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

test("sleep-safe: the 9 AM alert reads as already started", async () => {
  const src = readFileSync(join(root, "public/sw.js"), "utf8");
  const viewSrc = src.slice(src.indexOf("const short ="), src.indexOf("const PLATFORM_HAS_ACTIONS"));
  const view = new Function(viewSrc + "; return view;")();
  const start = Date.parse("2026-12-10T22:22:00Z");
  const v = view({ kind: "after", title: "Launch", start, at: start + 5 * 3600e3, place: "https://lu.ma/x" });
  assert.match(v.title, /^Launch started at /);
  assert.equal(v.body, "Tap to open lu.ma/x");
});
