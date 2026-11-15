// remmynd Plus on the launch countdown: no "Make yours with remmynd" line. The iPhone app sends a link's code with the
// Plus subscription Apple signed; this checks it (worker/apple.js) and answers a short signature, good until the
// subscription's end, that the card reads from ?p=. Nothing is stored; without PLUS_SECRET it's off.
//
//   POST /api/plus/card { code, jws }  →  { p }       p = <end, base 36>.<HMAC of code and end>
import { verifyTransaction } from "./apple.js";

const PLUS = new Set(["space.remmynd.plus.monthly", "space.remmynd.plus.yearly"]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = new TextEncoder();
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
  return btoa(String.fromCharCode(...b.slice(0, 12))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function plusMark(secret, code, end) { const e = Math.floor(end / 6e4).toString(36); return e + "." + await hmac(secret, code + "." + e); }

/** Whether ?p= on a card is a Plus mark for this code that hasn't run out. */
export async function plusCard(env, code, p, now = Date.now()) {
  if (!env.PLUS_SECRET || typeof p !== "string") return false;
  const m = /^([0-9a-z]{1,9})\.([A-Za-z0-9_-]{16})$/.exec(p);
  if (!m || parseInt(m[1], 36) * 6e4 < now) return false;
  return (await hmac(env.PLUS_SECRET, code + "." + m[1])) === m[2];
}

export async function plusCardResponse(request, env, deps = {}) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!env.PLUS_SECRET) return json({ error: "Plus cards aren't set up here." }, 503);
  let body = {};
  try { body = await request.json(); } catch {}
  const code = String(body && body.code || "");
  if (!/^[A-Za-z0-9_-]{8,2000}$/.test(code)) return json({ error: "Send the link's code." }, 400);
  const now = deps.now || Date.now();
  let tx;
  try { tx = await verifyTransaction(body.jws, { now, ...(deps.rootSha256 ? { rootSha256: deps.rootSha256 } : {}) }); }
  catch (e) { return json({ error: e.message }, 403); }
  if (tx.bundleId !== "space.remmynd.app" || !PLUS.has(tx.productId) || tx.revocationDate || !["Production", "Sandbox"].includes(tx.environment)) return json({ error: "That isn't remmynd Plus." }, 403);
  if (!(tx.expiresDate > now)) return json({ error: "Your remmynd Plus has ended." }, 402);
  // Good a few days past the end, so a renewal has time to come through before the line comes back.
  return json({ p: await plusMark(env.PLUS_SECRET, code, tx.expiresDate + 3 * 864e5) });
}
