// Numbers: daily totals the server already sees, and a private page that reads them.
//
// tally(env, name) adds to today's total for one thing ("account.new", "chat.message"...). A total is a name,
// a day and a number: no account, email, device, address or link is ever stored with it. Links themselves
// can't be counted at all; they're made on the device and never reach the server.
//
// GET /admin is for the people whose account email is in the ADMIN_EMAILS secret (comma-separated). Anyone
// else, signed in or not, gets the site's ordinary Not found page, so the page doesn't say it exists. It's built
// here with no scripts, never cached, never indexed and never framed, and it only reads.

import { signedIn, d1Store } from "./account.js";
import { PLANS } from "./pro.js";

const DAY = 864e5;
const dayOf = t => new Date(t).toISOString().slice(0, 10);
export const NAMES = {
  "account.new": "New accounts", "account.signin": "Sign-ins",
  "alerts.set": "Phone alerts set", "alerts.sent": "Phone alerts sent", "email.sent": "Reminder emails sent", "remind.tap": "Remind me on counted links",
  "host.claimed": "Host pages claimed", "launch.published": "Launches published", "follow.new": "Follows", "follow.end": "Unfollows", "follow.mail": "Follow emails sent",
  "chat.started": "Chats started", "chat.message": "Chat messages", "chat.file": "Photos and voice notes",
  "launch.nudge": "Nudges sent by hosts", "pro.checkout": "Pro checkouts opened"
};
const NAME = /^[a-z]+\.[a-z]+$/;

let ready = null;
const schema = db => (ready ||= db.prepare("CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, name))").run().catch(e => { ready = null; throw e; }));

/** Add n to today's total for name. Never throws: a number is never worth a failed request. */
export async function tally(env, name, n = 1, now = Date.now()) {
  if (!NAME.test(name) || !(n > 0)) return;
  if (env && typeof env.TALLY === "function") return env.TALLY(name, n); // the tests
  if (!env || !env.DB) return;
  try {
    await schema(env.DB);
    await env.DB.prepare("INSERT INTO daily (day, name, n) VALUES (?, ?, ?) ON CONFLICT (day, name) DO UPDATE SET n = n + excluded.n").bind(dayOf(now), name, Math.floor(n)).run();
  } catch {}
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("en-US");
const money = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The days and totals the page shows, read from D1. Kept apart so the tests can hand in their own. */
export async function readNumbers(db, now = Date.now()) {
  const one = async (sql, ...a) => (await db.prepare(sql).bind(...a).first()) || {};
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  await schema(db);
  const since = dayOf(now - 59 * DAY);
  const daily = await all("SELECT day, name, n FROM daily WHERE day >= ?", since);
  const signups = await all("SELECT created FROM users WHERE created >= ?", now - 60 * DAY).catch(() => []);
  const n = async sql => (await one(sql).catch(() => ({}))).n || 0;
  const pro = await all("SELECT source, product, trial FROM pro WHERE until > ? AND moved = 0 AND voided = 0", now).catch(() => []);
  return {
    daily, signups: signups.map(r => r.created),
    totals: {
      accounts: await n("SELECT COUNT(*) AS n FROM users"),
      hosts: await n("SELECT COUNT(*) AS n FROM hosts"),
      upcoming: (await one("SELECT COUNT(*) AS n FROM launches WHERE start > ?", now).catch(() => ({}))).n || 0,
      follows: await n("SELECT COUNT(*) AS n FROM follows"),
      chats: await n("SELECT COUNT(*) AS n FROM chat_rooms"),
      synced: await n("SELECT COUNT(DISTINCT user_id) AS n FROM items")
    },
    pro
  };
}

/** Sixty days of one total, as numbers oldest first. */
function series(data, name, now) {
  const by = new Map();
  if (name === "account.new") for (const t of data.signups) by.set(dayOf(t), (by.get(dayOf(t)) || 0) + 1); // from the accounts themselves, so it goes back before tallies began
  else for (const r of data.daily) if (r.name === name) by.set(r.day, (by.get(r.day) || 0) + r.n);
  return Array.from({ length: 60 }, (_, i) => by.get(dayOf(now - (59 - i) * DAY)) || 0);
}
const sum = a => a.reduce((x, y) => x + y, 0);

function spark(values) {
  const w = 160, h = 36, max = Math.max(1, ...values), step = w / (values.length - 1);
  const pts = values.map((v, i) => (i * step).toFixed(1) + "," + (h - 2 - (v / max) * (h - 4)).toFixed(1)).join(" ");
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" points="' + pts + '"/></svg>';
}

/** The page, from the numbers. */
export function adminHTML(data, now = Date.now()) {
  const rows = Object.entries(NAMES).map(([name, label]) => {
    const s = series(data, name, now).slice(-30), week = sum(s.slice(-7)), prev = sum(s.slice(-14, -7)), month = sum(s);
    const change = prev ? Math.round((week - prev) / prev * 100) : null;
    const tag = change === null ? (week ? "new" : "–") : (change > 0 ? "+" : "") + change + "%";
    const cls = change === null ? "" : change > 0 ? "up" : change < 0 ? "down" : "";
    return '<tr><th scope="row">' + esc(label) + '</th><td>' + fmt(week) + '</td><td>' + fmt(prev) + '</td><td class="' + cls + '">' + esc(tag) + '</td><td>' + fmt(month) + '</td><td class="sp">' + spark(s) + '</td></tr>';
  }).join("");
  const t = data.totals, pro = data.pro || [];
  const paid = pro.filter(p => !p.trial), trial = pro.length - paid.length;
  const mrr = paid.reduce((m, p) => m + (p.product === "yearly" ? parseFloat(PLANS.yearly.price.slice(1)) / 12 : parseFloat(PLANS.monthly.price.slice(1))), 0);
  const tile = (n, label) => '<div class="tile"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
  const tiles = [
    tile(fmt(t.accounts), "accounts"), tile(fmt(t.synced), "accounts with synced reminders"), tile(fmt(t.hosts), "host pages"), tile(fmt(t.upcoming), "upcoming launches"),
    tile(fmt(t.follows), "follows"), tile(fmt(t.chats), "open chats"),
    tile(fmt(paid.length), "paying for Pro"), tile(fmt(trial), "on a Pro trial"), tile(money(mrr), "monthly revenue, estimated"),
    tile(fmt(pro.filter(p => p.source === "polar").length) + " / " + fmt(pro.filter(p => p.source === "apple").length), "Pro on the website / Apple")
  ].join("");
  const when = new Date(now).toUTCString().replace(" GMT", " UTC");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Numbers · remmynd</title><style>' +
    ':root{color-scheme:light dark;--paper:#F5F6F7;--card:#fff;--ink:#0E0F11;--muted:#666C75;--line:#E3E5E8;--up:#067647;--down:#B42318;--accent:#F2A000}' +
    '@media (prefers-color-scheme:dark){:root{--paper:#0B0C0E;--card:#16181B;--ink:#F5F6F7;--muted:#A3A8B0;--line:#2A2D31;--up:#47CD89;--down:#FF8A80}}' +
    'body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:1040px;margin:0 auto;padding:28px 16px 48px}' +
    'h1{font-size:28px;letter-spacing:-.02em;margin:0}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:32px 0 12px}.sub{color:var(--muted);margin:4px 0 0}' +
    '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.tile b{display:block;font-size:24px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.tile span{color:var(--muted);font-size:13px}' +
    '.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}table{border-collapse:collapse;width:100%;min-width:640px}th,td{padding:10px 14px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    'thead th{font-size:12px;color:var(--muted);font-weight:600}tbody th{text-align:left;font-weight:500}tr:last-child th,tr:last-child td{border-bottom:0}.up{color:var(--up)}.down{color:var(--down)}.sp{color:var(--accent);padding:4px 14px}.sp svg{display:block;margin-left:auto}' +
    '.note{color:var(--muted);font-size:13px;margin-top:16px;max-width:70ch}</style></head><body><main>' +
    '<h1>Numbers</h1><p class="sub">As of ' + esc(when) + '. Only you can see this page.</p>' +
    '<h2>Right now</h2><div class="tiles">' + tiles + '</div>' +
    '<h2>Last 7 days</h2><div class="wrap"><table><thead><tr><th scope="col" style="text-align:left">What</th><th scope="col">7 days</th><th scope="col">The 7 before</th><th scope="col">Change</th><th scope="col">30 days</th><th scope="col">30 days, by day</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="note">Daily totals only: a name, a day and a number, with nothing about who. New accounts come from the accounts themselves, so they go back further than the other totals, which start the day this page shipped. Links are made on people\'s devices and never reach the server, so they aren\'t counted. Revenue is estimated from the plan prices for paying subscribers; trials count as nothing.</p>' +
    '</main></body></html>';
}

const notFound = async (env, url) => {
  if (env.ASSETS) { try { const r = await env.ASSETS.fetch(new Request(new URL("/this-page-does-not-exist", url.origin))); return new Response(r.body, { status: 404, headers: r.headers }); } catch {} }
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
};

export async function adminResponse(request, env, url, deps = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return notFound(env, url);
  const admins = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  if (!admins.length || (!env.DB && !deps.accounts)) return notFound(env, url);
  const now = deps.now || Date.now();
  const s = await signedIn(request, deps.accounts || d1Store(env.DB), now).catch(() => null);
  if (!s || !admins.includes(String(s.user.email).toLowerCase())) return notFound(env, url);
  const data = deps.data || await readNumbers(env.DB, now);
  return new Response(request.method === "HEAD" ? null : adminHTML(data, now), { headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  } });
}
