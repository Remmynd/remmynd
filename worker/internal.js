// The internal entrypoint: what a remmynd Worker bound to this one by a service binding may ask.
// It isn't reachable from the internet (only a Worker on this account with a binding to the
// "Internal" entrypoint can call it), and it answers three things only, so sign-in, Pro and the
// Apple push key stay here, in one place:
//   whoIs(cookie)               the signed-in account's id for a session cookie, or null
//   plan(userId)                { pro, offer }: whether the account has Pro, and whether Pro is on offer to it
//   tell(userIds, alert, data)  an Apple push to those accounts' iPhones; returns how many were sent
// Pages and calls served by a bound Worker reach it through the forward in worker/index.js.
import { WorkerEntrypoint } from "cloudflare:workers";
import { signedIn, d1Store } from "./account.js";
import { planOf } from "./pro.js";
import { tellAccounts } from "./apns.js";

const ID = /^[A-Za-z0-9_-]{4,80}$/;

export async function whoIs(env, cookie, deps = {}) {
  if (typeof cookie !== "string" || !cookie || (!env.DB && !deps.store)) return null;
  const store = deps.store || d1Store(env.DB);
  await store.ready();
  const who = await signedIn(new Request("https://remmynd.space/", { headers: { cookie } }), store, deps.now || Date.now());
  return who ? who.user.id : null;
}

export async function plan(env, userId, deps = {}) {
  if (!ID.test(String(userId)) || (!env.DB && !deps.store)) return { pro: false, offer: false };
  const store = deps.store || d1Store(env.DB);
  await store.ready();
  const p = await planOf(env, store, userId, deps.now || Date.now());
  return { pro: p.pro, offer: p.pro || p.limited };
}

export async function tell(env, userIds, alert, data = {}, deps = {}) {
  const users = (Array.isArray(userIds) ? userIds : []).filter(u => ID.test(String(u))).slice(0, 100);
  if (!users.length || !alert || typeof alert.title !== "string") return 0;
  const clean = { title: alert.title.slice(0, 120), body: String(alert.body || "").slice(0, 300) };
  const extra = {};
  for (const [k, v] of Object.entries(data || {})) if (/^[a-z]{1,12}$/.test(k) && ["string", "number"].includes(typeof v)) extra[k] = typeof v === "string" ? v.slice(0, 200) : v;
  return (deps.tell || tellAccounts)(env, users, clean, extra, deps);
}

export class Internal extends WorkerEntrypoint {
  whoIs(cookie) { return whoIs(this.env, cookie); }
  plan(userId) { return plan(this.env, userId); }
  tell(userIds, alert, data) { return tell(this.env, userIds, alert, data); }
}
