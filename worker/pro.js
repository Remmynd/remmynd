// remmynd Pro: one status on the account, however it was paid.
//
// Pro belongs to the signed-in account, not to a device or a store. Two ways to pay feed the same record:
//   the website, through Polar (the merchant of record): this server makes the checkout with the account's id on it,
//     and Polar says when anything changes (customer.state_changed) or is asked directly (Restore);
//   the iPhone app, through Apple: the app sends the purchase Apple signed, checked here up to Apple's own root
//     (worker/apple.js), and Apple says when it renews, is cancelled or is refunded (server notifications).
// So a purchase made either way is Pro everywhere the account is signed in, and Restore works from both sides.
//
// Routes (JSON, never cached):
//   GET  /api/pro                          the account's Pro status, the plans, and whether Pro is on offer here
//   POST /api/pro/checkout { plan }        → { url }  Polar's checkout page for this account ("monthly" | "yearly")
//   POST /api/pro/portal                   → { url }  Polar's page to manage or cancel a website purchase
//   POST /api/pro/restore { jws?, renewal?, move? }  → status   asks Polar now, and links an Apple purchase if one is sent
//   POST /api/pro/apple { jws, renewal?, move? }     → status   links an Apple purchase to this account
//     (jws is the transaction Apple signed; renewal is its signed renewal info, so "renews" is right from the start)
//   POST /api/pro/polar                    Polar's webhook (Standard Webhooks signature)
//   POST /api/pro/apple/notify             Apple's server notifications (signed by Apple)
//
// What is kept (table pro): which purchase (Polar's subscription id or Apple's original transaction id), whose it is,
// which plan, until when, and whether it renews. No card and no address: Polar and Apple hold those.
//
// Settings:
//   PRO_ON = "1"            Pro is on offer to everyone. Until then only PRO_TESTERS (emails, comma-separated) see it.
//   POLAR_ACCESS_TOKEN      secret. An organization token: checkouts:write, customers:read, customer_sessions:write,
//                           subscriptions:write.
//   POLAR_WEBHOOK_SECRET    secret. The webhook's signing secret, as Polar shows it.
//   POLAR_PRODUCT_MONTHLY, POLAR_PRODUCT_YEARLY   the two products' ids.
//   POLAR_SANDBOX = "1"     talk to Polar's sandbox.
//   POLAR_DISCOUNT_FIRST    a Polar discount id (50% off once, monthly plan) for the first-month offer; no offer without it
// Local dev servers only: POLAR_API (a stand-in for Polar) and STOREKIT_TEST = "1" (Xcode's test purchases).
import { signedIn, d1Store } from "./account.js";
import { verifySigned } from "./apple.js";
import { tally } from "./numbers.js";

const DAY = 864e5;
/** A purchase set to renew stays Pro this long past its date, so a late renewal never locks anyone out. */
export const GRACE = 3 * DAY;
/** An Apple purchase can be moved to another account this often. */
export const MOVE_EVERY = 7 * DAY;
export const BUNDLE = "space.remmynd.app";
export const TRIAL_DAYS = 7;
/** The plans. The website's prices are set on the Polar products and the app's in App Store Connect; these are the words shown. */
export const PLANS = {
  monthly: { price: "$9.99", per: "month", apple: "space.remmynd.pro.monthly" },
  yearly: { price: "$79.99", per: "year", apple: "space.remmynd.pro.yearly" }
};
const APPLE_PLAN = Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [v.apple, k]));
const enc = new TextEncoder();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
class Refused extends Error { constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; } }
const isLocal = url => url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");

/* ---------- the status ---------- */

/** Pro or not, from an account's purchases: the one that lasts longest. A renewing one gets GRACE past its date. */
export function proStatus(rows, now) {
  const live = rows.filter(r => r.until + (r.renews ? GRACE : 0) > now).sort((a, b) => b.until - a.until);
  const r = live[0];
  return r ? { pro: true, until: r.until, source: r.source, plan: r.product, renews: !!r.renews, trial: !!r.trial && r.until > now } : { pro: false };
}

/** What a host on the free plan gets, once Pro can be bought. */
export const FREE = { live: 1, reach: 100 };
/**
 * A host's plan: Pro, or free; and whether free limits apply. They apply only once Pro is on offer to that person
 * (PRO_ON, or PRO_TESTERS before that), so nobody is held back by a limit they can't yet pay to lift.
 */
export async function planOf(env, store, user, now = Date.now()) {
  if (typeof user === "string") user = await store.userById(user);
  if (!user) return { pro: false, limited: false, trial: false };
  const s = proStatus(await store.proOf(user.id), now);
  return { pro: !!s.pro, limited: !s.pro && onOffer(env, user), trial: !!s.trial };
}

/** Whether Pro is on offer to this person: to everyone once PRO_ON is "1", and to PRO_TESTERS before that. */
export function onOffer(env, user) {
  if (env.PRO_ON === "1") return true;
  const testers = String(env.PRO_TESTERS || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  return !!user && testers.includes(String(user.email).toLowerCase());
}

/** The account's token for Apple purchases (StoreKit's appAccountToken): a UUID made from the account's id, so a
 * purchase carries which account made it. It names the account to Apple without saying anything about it. */
export async function appToken(userId) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("remmynd-app-account:" + userId))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h, b => b.toString(16).padStart(2, "0")).join("");
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join("-");
}

const polarOn = env => !!(env.POLAR_ACCESS_TOKEN && env.POLAR_PRODUCT_MONTHLY && env.POLAR_PRODUCT_YEARLY);

/**
 * 50% off the first month on the website (POLAR_DISCOUNT_FIRST, a Polar discount: 50% off once, monthly plan), for a
 * host whose launch reached 25 saves, or whose Pro lapsed. Decided here, from the account's own records; never
 * offered without the discount set. The app keeps Apple's normal price until Apple's promotional offers are set up.
 */
export const SAVES_FOR_OFFER = 25;
export async function firstMonthOffer(env, store, user, now = Date.now()) {
  if (!env.POLAR_DISCOUNT_FIRST || !polarOn(env) || !user || !onOffer(env, user)) return null;
  const rows = await store.proOf(user.id);
  if (proStatus(rows, now).pro) return null;
  let why = rows.some(r => !r.voided) ? "lapsed" : null;
  if (!why && store.launchesOf) {
    const { savedBy } = await import("./hosts.js");
    for (const l of await store.launchesOf(user.id)) if (await savedBy(env, store, l.id) >= SAVES_FOR_OFFER) { why = "saves"; break; }
  }
  return why ? { percent: 50, plan: "monthly", why } : null;
}

async function summary(store, env, user, now) {
  const rows = user ? await store.proOf(user.id) : [];
  return {
    signedIn: !!user, ...proStatus(rows, now), offer: onOffer(env, user), web: polarOn(env), discount: await firstMonthOffer(env, store, user, now),
    // The free trial is for an account's first purchase.
    trialOpen: rows.length === 0, trialDays: TRIAL_DAYS,
    plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, { ...v }])),
    ...(user ? { appToken: await appToken(user.id) } : {})
  };
}

/* ---------- the website: Polar ---------- */

const polarBase = (env, local) => (local && env.POLAR_API) || (env.POLAR_SANDBOX === "1" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh");
async function polar(env, path, { method = "GET", body, local = false, fetchFn = fetch } = {}) {
  let res;
  try {
    res = await fetchFn(polarBase(env, local) + path, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { authorization: "Bearer " + env.POLAR_ACCESS_TOKEN, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) } });
  } catch { throw new Refused("Couldn't reach the payment service. Try again.", 502); }
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

/**
 * What Polar says about a customer, applied to the account it names (external_id is the account's id, set at
 * checkout). Each active subscription to one of our two products is a purchase; one Polar no longer lists has ended.
 */
export async function applyPolarState(store, env, state, now) {
  const userId = state && typeof state.external_id === "string" ? state.external_id : "";
  if (!userId || !await store.userById(userId)) return null;
  const plans = new Map([[env.POLAR_PRODUCT_MONTHLY, "monthly"], [env.POLAR_PRODUCT_YEARLY, "yearly"]]);
  const active = new Set();
  for (const s of Array.isArray(state.active_subscriptions) ? state.active_subscriptions : []) {
    const plan = plans.get(s.product_id), until = Date.parse(s.current_period_end);
    if (!plan || !s.id || !(until > 0)) continue;
    active.add(String(s.id));
    await store.putPro({ source: "polar", ref: String(s.id), userId, product: plan, until, trial: s.status === "trialing", renews: !s.cancel_at_period_end,
      env: env.POLAR_SANDBOX === "1" ? "sandbox" : "live", updated: now });
  }
  for (const r of await store.proOf(userId)) {
    if (r.source !== "polar" || active.has(r.ref) || !(r.until + (r.renews ? GRACE : 0) > now)) continue;
    // Gone in the middle of its period: refunded or revoked, so it ends now. Gone at its date while set to renew: a
    // payment is late, and GRACE covers it until Polar says more.
    if (now < r.until - DAY) await store.putPro({ ...fromRow(r), until: now - 1, renews: false, updated: now });
  }
  return userId;
}
const fromRow = r => ({ source: r.source, ref: r.ref, userId: r.user_id, product: r.product, until: r.until, trial: !!r.trial, renews: !!r.renews, env: r.env, updated: r.updated, moved: r.moved, voided: r.voided });

/** Ask Polar now, for Restore and for coming back from checkout: a missed webhook never leaves anyone locked out. */
export async function pullPolar(store, env, user, opts) {
  if (!polarOn(env)) return false;
  const r = await polar(env, "/v1/customers/external/" + encodeURIComponent(user.id) + "/state", opts);
  if (r.status === 404) return false; // never bought on the website
  if (!r.ok || !r.data) throw new Refused("Couldn't reach the payment service. Try again.", 502);
  if (r.data.external_id !== user.id) return false;
  await applyPolarState(store, env, r.data, opts.now);
  return true;
}

const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const toB64 = b => btoa(String.fromCharCode(...b));
const sameText = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/**
 * Polar's webhooks are signed the Standard Webhooks way: HMAC-SHA256 over "<id>.<timestamp>.<body>". The key is the
 * base64 after "whsec_"; Polar's older secrets use the secret's own bytes, so both are tried. Five minutes old at most.
 */
export async function verifyPolarWebhook(env, headers, body, now) {
  const secret = env.POLAR_WEBHOOK_SECRET, id = headers.get("webhook-id"), ts = headers.get("webhook-timestamp"), given = headers.get("webhook-signature") || "";
  if (!secret || !id || !ts || !(Math.abs(now / 1000 - Number(ts)) <= 300)) return false;
  const keys = [enc.encode(secret)];
  try { keys.unshift(fromB64(secret.replace(/^whsec_/, ""))); } catch {}
  const msg = enc.encode(id + "." + ts + "." + body);
  for (const k of keys) {
    const key = await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = toB64(new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)));
    if (given.split(/\s+/).some(s => sameText(s.replace(/^v1,/, ""), mac))) return true;
  }
  return false;
}

async function checkout(store, env, user, body, url, opts) {
  if (!onOffer(env, user)) throw new Refused("Pro isn't open yet.", 403);
  if (!polarOn(env)) throw new Refused("Paying on the website isn't set up here.", 503);
  const rows = await store.proOf(user.id), s = proStatus(rows, opts.now);
  // Never twice: Pro from either side is Pro.
  if (s.pro) throw new Refused(s.source === "apple" ? "You already have Pro through Apple. Manage it in your iPhone's Settings." : "You already have Pro.", 409, { source: s.source });
  const plan = body.plan === "yearly" ? "yearly" : "monthly";
  const ask = { products: [plan === "yearly" ? env.POLAR_PRODUCT_YEARLY : env.POLAR_PRODUCT_MONTHLY], external_customer_id: user.id, customer_email: user.email,
    allow_trial: rows.length === 0, success_url: url.origin + "/?pro=done", metadata: { account: user.id } };
  if (plan === "monthly" && await firstMonthOffer(env, store, user, opts.now)) ask.discount_id = env.POLAR_DISCOUNT_FIRST;
  let r = await polar(env, "/v1/checkouts/", { ...opts, method: "POST", body: ask });
  // An email Polar already knows under another customer: the account's id alone still ties the purchase to it.
  if (r.status === 422) { delete ask.customer_email; r = await polar(env, "/v1/checkouts/", { ...opts, method: "POST", body: ask }); }
  if (!r.ok || !r.data || typeof r.data.url !== "string") throw new Refused("The checkout couldn't be opened. Try again.", 502);
  await tally(env, "pro.checkout");
  return { url: r.data.url };
}

async function portal(env, user, url, opts) {
  if (!polarOn(env)) throw new Refused("Paying on the website isn't set up here.", 503);
  const r = await polar(env, "/v1/customer-sessions/", { ...opts, method: "POST", body: { external_customer_id: user.id, return_url: url.origin + "/" } });
  if (!r.ok || !r.data || typeof r.data.customer_portal_url !== "string") throw new Refused("No website purchase was found for this account.", 404);
  return { url: r.data.customer_portal_url };
}

/** Deleting the account ends its website purchase at once, so Polar never bills for an account that's gone. */
export async function proBeforeDelete(request, env, url, deps = {}) {
  if ((!env.DB && !deps.store) || request.headers.get("origin") !== url.origin) return;
  const store = deps.store || d1Store(env.DB), now = deps.now || Date.now();
  await store.ready();
  const s = await signedIn(request, store, now);
  if (!s || !polarOn(env)) return;
  for (const r of await store.proOf(s.user.id)) {
    if (r.source === "polar" && r.until > now) await polar(env, "/v1/subscriptions/" + encodeURIComponent(r.ref), { method: "DELETE", local: isLocal(url), fetchFn: deps.fetchFn || fetch }).catch(() => {});
  }
}

/* ---------- the app: Apple ---------- */

const mask = email => String(email).replace(/^(.).*(@.*)$/, "$1•••$2");
const appleEnvs = local => (local ? ["Production", "Sandbox", "Xcode", "LocalTesting"] : ["Production", "Sandbox"]);

const isTrial = tx => tx.offerType === 1 && tx.offerDiscountType === "FREE_TRIAL";

/**
 * Link a purchase Apple signed to this account. One purchase belongs to one account: it follows the account it was
 * bought under (its appAccountToken), and otherwise moves only when asked, at most once every MOVE_EVERY.
 * `renewal` is the purchase's signed renewal info, if the app has it: whether it renews, and Apple's grace period.
 */
export async function linkApple(store, env, user, jws, { now, local = false, move = false, renewal, rootSha256 } = {}) {
  const check = { now, local: local && env.STOREKIT_TEST === "1", ...(rootSha256 ? { rootSha256 } : {}) };
  const tx = await verifySigned(jws, check);
  const plan = APPLE_PLAN[tx.productId];
  if (tx.bundleId !== BUNDLE) throw new Refused("That purchase is for another app.", 403);
  if (!plan) throw new Refused("That purchase isn't remmynd Pro.", 403);
  if (!appleEnvs(local).includes(tx.environment)) throw new Refused("That purchase is from a test environment.", 403);
  const ref = String(tx.originalTransactionId || tx.transactionId || "");
  if (!ref) throw new Refused("That purchase can't be read.", 403);
  // The renewal info only adds to a purchase that already checks out, so one that can't be read is left out.
  let ri = null;
  if (typeof renewal === "string" && renewal) try { ri = await verifySigned(renewal, check); } catch {}
  if (ri && String(ri.originalTransactionId || "") !== ref) ri = null;
  const row = await store.proByRef("apple", ref);
  let moved = row ? row.moved : 0;
  if (row && row.user_id !== user.id) {
    const mine = String(tx.appAccountToken || "").toLowerCase() === await appToken(user.id);
    if (!mine) {
      const canMove = now - (row.moved || 0) > MOVE_EVERY, other = await store.userById(row.user_id);
      if (!move || !canMove) throw new Refused("This Apple purchase is on another remmynd account" + (other ? ", " + mask(other.email) : "") + (canMove ? "." : ". It was moved in the last week, so it can't be moved again yet."), 409, { canMove, other: other ? mask(other.email) : "" });
    }
    moved = now;
  }
  const expires = Number(tx.expiresDate) || 0, voided = row ? row.voided || 0 : 0;
  // A refunded period never counts again, even if the purchase as it was before the refund is sent once more.
  const dead = !!tx.revocationDate || expires <= voided;
  const sameOwner = !!row && row.user_id === user.id;
  // An older period sent again changes nothing: the plan, the trial and the date stay the newest ones known.
  const newest = !sameOwner || expires >= row.until;
  const grace = ri ? Number(ri.gracePeriodExpiresDate) || 0 : 0;
  await store.putPro({ source: "apple", ref, userId: user.id, product: newest ? plan : row.product, env: tx.environment, updated: now, moved,
    until: dead ? Math.min(now - 1, sameOwner ? row.until : now - 1) : Math.max(expires, grace, sameOwner ? row.until : 0),
    renews: dead ? false : ri && ri.autoRenewStatus != null ? ri.autoRenewStatus === 1 : sameOwner ? !!row.renews : expires > now,
    trial: newest ? isTrial(tx) : !!row.trial,
    voided: tx.revocationDate ? Math.max(voided, expires) : voided });
  return ref;
}

/** Apple's server notification: a renewal, a cancellation, an expiry or a refund, for a purchase already linked. */
export async function appleNotice(store, env, signedPayload, { now, local = false, rootSha256 } = {}) {
  const opts = { now, local: local && env.STOREKIT_TEST === "1", ...(rootSha256 ? { rootSha256 } : {}) };
  const n = await verifySigned(signedPayload, opts), d = n.data || {};
  if (d.bundleId !== BUNDLE || !d.signedTransactionInfo) return { ignored: "not ours" };
  const tx = await verifySigned(d.signedTransactionInfo, opts);
  const ri = d.signedRenewalInfo ? await verifySigned(d.signedRenewalInfo, opts) : null;
  const row = await store.proByRef("apple", String(tx.originalTransactionId || tx.transactionId || ""));
  // The first link is always made by the app, signed in; a notice only updates what's linked.
  if (!row) return { ignored: "not linked" };
  const type = n.notificationType, expires = Number(tx.expiresDate) || 0, next = fromRow(row);
  if (type === "REFUND" || type === "REVOKE") { next.voided = Math.max(row.voided || 0, row.until, expires); next.until = now - 1; next.renews = false; }
  else if (type === "EXPIRED" || type === "GRACE_PERIOD_EXPIRED") { next.until = Math.min(row.until, expires || row.until); next.renews = false; }
  else {
    // Apple took a refund back: that period counts again.
    if (type === "REFUND_REVERSED" && expires) next.voided = Math.min(row.voided || 0, expires - 1);
    if (expires > (next.voided || 0) && expires >= row.until) { next.until = expires; next.product = APPLE_PLAN[tx.productId] || row.product; next.trial = isTrial(tx); }
    if (ri && ri.autoRenewStatus != null) next.renews = ri.autoRenewStatus === 1;
    if (ri && Number(ri.gracePeriodExpiresDate) > next.until) next.until = Number(ri.gracePeriodExpiresDate);
  }
  next.updated = now;
  await store.putPro(next);
  return { ok: true, type };
}

/* ---------- routes ---------- */

export async function handlePro(request, env, url, deps = {}) {
  if (!env.DB && !deps.store) return json({ error: "Accounts aren't set up on this server." }, 503);
  const store = deps.store || d1Store(env.DB), now = deps.now || Date.now(), local = isLocal(url);
  const opts = { now, local, fetchFn: deps.fetchFn || fetch, rootSha256: deps.rootSha256 };
  const path = url.pathname.replace(/\/+$/, "");
  await store.ready();
  try {
    // Polar and Apple call these two; each proves itself with its signature.
    if (path === "/api/pro/polar") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      const text = await request.text();
      if (text.length > 262144) return json({ error: "Too large." }, 413);
      if (!await verifyPolarWebhook(env, request.headers, text, now)) return json({ error: "That signature doesn't check out." }, 403);
      let ev = null;
      try { ev = JSON.parse(text); } catch {}
      if (ev && ev.type === "customer.state_changed" && ev.data) await applyPolarState(store, env, ev.data, now);
      return json({ ok: true }, 202);
    }
    if (path === "/api/pro/apple/notify") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      let body = null;
      try { body = JSON.parse((await request.text()).slice(0, 262144)); } catch {}
      if (!body || typeof body.signedPayload !== "string") return json({ error: "Send signedPayload." }, 400);
      return json(await appleNotice(store, env, body.signedPayload, opts));
    }

    const s = await signedIn(request, store, now), user = s ? s.user : null;
    if (path === "/api/pro") {
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Use GET." }, 405);
      return json(await summary(store, env, user, now));
    }
    // Everything else changes something: POST, from this site, signed in.
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    if (request.headers.get("origin") !== url.origin) return json({ error: "Cross-site requests aren't allowed." }, 403);
    if (!user) return json({ error: "Sign in first." }, 401);
    let body = {};
    try { const b = JSON.parse((await request.text()).slice(0, 32768)); if (b && typeof b === "object") body = b; } catch {}

    if (path === "/api/pro/checkout") return json(await checkout(store, env, user, body, url, opts));
    if (path === "/api/pro/portal") return json(await portal(env, user, url, opts));
    if (path === "/api/pro/apple") {
      if (typeof body.jws !== "string") return json({ error: "Send the purchase." }, 400);
      await linkApple(store, env, user, body.jws, { ...opts, move: body.move === true, renewal: body.renewal });
      return json(await summary(store, env, user, now));
    }
    if (path === "/api/pro/restore") {
      // Both sides, so Restore finds a purchase however it was paid. One side failing never hides the other.
      let problem = null;
      if (typeof body.jws === "string") try { await linkApple(store, env, user, body.jws, { ...opts, move: body.move === true, renewal: body.renewal }); } catch (e) { problem = e; }
      try { await pullPolar(store, env, user, opts); } catch (e) { problem = problem || e; }
      const out = await summary(store, env, user, now);
      if (problem && !out.pro) throw problem;
      return json(problem && problem.extra && problem.status === 409 ? { ...out, notice: problem.message, ...problem.extra } : out);
    }
    return json({ error: "Not found." }, 404);
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message, ...e.extra }, e.status);
    if (e && e.status === 403) return json({ error: e.message }, 403); // a purchase Apple didn't sign (worker/apple.js)
    throw e;
  }
}
