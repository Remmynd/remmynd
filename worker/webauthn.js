// Passkeys (WebAuthn), checked with the platform's own WebCrypto: no libraries.
//
// Registration uses "none" attestation: the browser hands over the new credential's public key
// (AuthenticatorAttestationResponse.getPublicKey(), SPKI), and the server binds it to the account
// that is already signed in. Sign-in checks everything: the challenge we issued, the origin, the
// relying party (rpIdHash), user presence, and the signature over authenticatorData and the
// client data hash.

export const ALGS = { ES256: -7, EdDSA: -8, RS256: -257 };
const enc = new TextEncoder();

export const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function fromB64url(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > 16384) throw new Error("bad base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const randomId = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async data => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Reads clientDataJSON and checks its type, challenge and origin. */
function clientData(clientDataJSON, type, challenge, origin) {
  const raw = fromB64url(clientDataJSON);
  let c;
  try { c = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Error("client data isn't JSON"); }
  if (c.type !== type) throw new Error("wrong ceremony type");
  if (c.challenge !== challenge) throw new Error("challenge doesn't match");
  if (c.origin !== origin) throw new Error("origin doesn't match");
  if (c.crossOrigin === true) throw new Error("cross-origin ceremony");
  return raw;
}

/** A new passkey for a signed-in account: returns what to store. */
export async function verifyRegistration(cred, { challenge, origin }) {
  clientData(cred.clientDataJSON, "webauthn.create", challenge, origin);
  const alg = Number(cred.alg);
  if (!Object.values(ALGS).includes(alg)) throw new Error("unsupported key type");
  const spki = fromB64url(cred.publicKey);
  await importKey(b64url(spki), alg); // throws if the key isn't usable
  if (typeof cred.id !== "string" || !/^[A-Za-z0-9_-]{16,1024}$/.test(cred.id)) throw new Error("bad credential id");
  return { id: cred.id, publicKey: b64url(spki), alg };
}

function importKey(spkiB64, alg) {
  const spki = fromB64url(spkiB64);
  if (alg === ALGS.ES256) return crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  if (alg === ALGS.RS256) return crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (alg === ALGS.EdDSA) return crypto.subtle.importKey("spki", spki, { name: "Ed25519" }, false, ["verify"]);
  throw new Error("unsupported key type");
}

/** ECDSA signatures come DER-encoded from authenticators; WebCrypto wants r and s, 32 bytes each. */
export function derToRaw(der) {
  const d = new Uint8Array(der);
  if (d[0] !== 0x30) throw new Error("bad signature");
  let i = 2;
  if (d[1] & 0x80) i = 2 + (d[1] & 0x7f);
  const part = () => {
    if (d[i] !== 0x02) throw new Error("bad signature");
    const len = d[i + 1];
    let v = d.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("bad signature");
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = part(), s = part();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

/** Sign-in with a passkey. Returns the new signature counter. */
export async function verifyAssertion(cred, { challenge, origin, rpId, publicKey, alg, signCount = 0 }) {
  const cdj = clientData(cred.clientDataJSON, "webauthn.get", challenge, origin);
  const auth = fromB64url(cred.authenticatorData);
  if (auth.length < 37) throw new Error("authenticator data is too short");
  if (!same(auth.slice(0, 32), await sha256(enc.encode(rpId)))) throw new Error("wrong relying party");
  if (!(auth[32] & 0x01)) throw new Error("user wasn't present");
  const counter = ((auth[33] << 24) >>> 0) + (auth[34] << 16) + (auth[35] << 8) + auth[36];
  if (counter && signCount && counter <= signCount) throw new Error("passkey counter went backwards");
  const signed = new Uint8Array(auth.length + 32);
  signed.set(auth, 0); signed.set(await sha256(cdj), auth.length);
  const key = await importKey(publicKey, alg);
  let sig = fromB64url(cred.signature);
  const algo = alg === ALGS.ES256 ? { name: "ECDSA", hash: "SHA-256" } : alg === ALGS.RS256 ? { name: "RSASSA-PKCS1-v1_5" } : { name: "Ed25519" };
  if (alg === ALGS.ES256) sig = derToRaw(sig);
  if (!(await crypto.subtle.verify(algo, key, sig, signed))) throw new Error("signature doesn't verify");
  return counter;
}
