// What Apple signs, checked with nothing but WebCrypto: a StoreKit purchase (a signed transaction) or an App Store
// server notification, each a JWS. The check covers the signature and the certificate chain up to Apple Root CA G3,
// pinned here by its SHA-256 fingerprint (read from macOS's system roots), Apple's marks on the intermediate and leaf
// certificates, and every certificate's dates at the time of signing. Used for remmynd Pro (worker/pro.js). Nothing is stored here.
export const APPLE_ROOT_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";

const OID = {
  ecdsaSha256: "2a8648ce3d040302", ecdsaSha384: "2a8648ce3d040303",
  p256: "2a8648ce3d030107", p384: "2b81040022",
  storeLeaf: "2a864886f76364060b01", storeIntermediate: "2a864886f76364060201"
};
const enc = new TextEncoder();
const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
const fail = msg => { const e = new Error(msg); e.status = 403; throw e; };
export const b64 = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "")), c => c.charCodeAt(0));
export const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sha256 = async b => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof b === "string" ? enc.encode(b) : b));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ---------- DER and X.509, as much as these checks need ---------- */
function tlv(b, i) {
  if (i + 2 > b.length) fail("A certificate is cut short.");
  const tag = b[i]; let len = b[i + 1], off = i + 2;
  if (len & 0x80) { const n = len & 0x7f; if (n > 4) fail("A certificate is malformed."); len = 0; for (let k = 0; k < n; k++) len = len * 256 + b[off + k]; off += n; }
  if (off + len > b.length) fail("A certificate is cut short.");
  return { tag, start: i, hdr: off, end: off + len };
}
const kids = (b, n) => { const out = []; for (let i = n.hdr; i < n.end;) { const c = tlv(b, i); out.push(c); i = c.end; } return out; };
const val = (b, n) => b.slice(n.hdr, n.end);
function time(b, n) {
  const s = new TextDecoder().decode(val(b, n));
  const m = n.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s) : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(s);
  if (!m) fail("A certificate has a time that can't be read.");
  const y = n.tag === 0x17 ? (+m[1] < 50 ? 2000 : 1900) + +m[1] : +m[1];
  return Date.UTC(y, +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** A certificate's parts: the signed bytes, the signature, its key, its validity and its extensions. */
export function parseCert(der) {
  const top = tlv(der, 0), [tbs, alg, sig] = kids(der, top);
  const f = kids(der, tbs), at = f[0].tag === 0xa0 ? 1 : 0;
  const validity = kids(der, f[at + 3]), spki = f[at + 5], spkiAlg = kids(der, kids(der, spki)[0]);
  const ext = {};
  const extBlock = f.find(x => x.tag === 0xa3);
  if (extBlock) for (const e of kids(der, kids(der, extBlock)[0])) { const p = kids(der, e); ext[hex(val(der, p[0]))] = val(der, p[p.length - 1]); }
  const bits = val(der, sig);
  return {
    der, tbs: der.slice(tbs.start, tbs.end), sigAlg: hex(val(der, kids(der, alg)[0])), sig: bits.slice(1),
    spki: der.slice(spki.start, spki.end), curve: hex(val(der, spkiAlg[1])), point: val(der, kids(der, spki)[1]).slice(1),
    notBefore: time(der, kids(der, f[at + 3])[0]), notAfter: time(der, validity[1]), ext
  };
}
export const pemDER = pem => b64(pem.replace(/-----[^-]+-----/g, ""));

const CURVE = { [OID.p256]: ["P-256", 32], [OID.p384]: ["P-384", 48] };
const HASH = { [OID.ecdsaSha256]: "SHA-256", [OID.ecdsaSha384]: "SHA-384" };
async function keyOf(cert) {
  const c = CURVE[cert.curve];
  if (!c) fail("A certificate uses a key that isn't expected.");
  return { key: await crypto.subtle.importKey("spki", cert.spki, { name: "ECDSA", namedCurve: c[0] }, false, ["verify"]), size: c[1] };
}
/** A DER ECDSA signature (SEQUENCE of r and s) as the raw r‖s WebCrypto checks. */
function rawSig(der, size) {
  const [r, s] = kids(der, tlv(der, 0)).map(n => { let v = val(der, n); while (v.length > size && v[0] === 0) v = v.slice(1); if (v.length > size) fail("A signature is malformed."); return cat(new Uint8Array(size - v.length), v); });
  return cat(r, s);
}
async function signedBy(child, parent) {
  const hash = HASH[child.sigAlg];
  if (!hash) fail("A certificate is signed in a way that isn't expected.");
  const { key, size } = await keyOf(parent);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash }, key, rawSig(child.sig, size), child.tbs)) fail("A certificate's signature doesn't check out.");
}
const current = (certs, now) => { for (const c of certs) if (now < c.notBefore || now > c.notAfter) fail("A certificate has expired or isn't valid yet."); };

/* ---------- StoreKit: a signed transaction ---------- */
/**
 * What a StoreKit signed transaction (Transaction.jwsRepresentation) says, once its signature and certificate chain
 * check out up to Apple Root CA G3. `rootSha256` pins the root (tests pass their own); `local` accepts Xcode's own
 * StoreKit testing signatures, for a local dev server only.
 */
export async function verifyTransaction(jws, { now = Date.now(), rootSha256 = APPLE_ROOT_G3_SHA256, local = false } = {}) {
  const parts = String(jws || "").split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) fail("That purchase can't be read.");
  let head, body;
  try { head = JSON.parse(new TextDecoder().decode(b64(parts[0]))); body = JSON.parse(new TextDecoder().decode(b64(parts[1]))); } catch { fail("That purchase can't be read."); }
  if (head.alg !== "ES256" || !Array.isArray(head.x5c) || !head.x5c.length) fail("That purchase isn't signed the way the App Store signs.");
  const certs = head.x5c.map(c => parseCert(b64(c)));
  if (!local) {
    if (certs.length !== 3) fail("That purchase isn't signed by the App Store.");
    if (hex(await sha256(certs[2].der)) !== rootSha256) fail("That purchase isn't signed by the App Store.");
    if (!certs[0].ext[OID.storeLeaf] || !certs[1].ext[OID.storeIntermediate]) fail("That purchase isn't signed by the App Store.");
    // The certificates must have been good when Apple signed (the payload's own signedDate), as Apple's server library
    // checks them: a purchase read back from a phone months later is still what Apple signed. A date ahead of now isn't taken.
    const signed = Number(body.signedDate);
    current(certs, signed > 0 && signed <= now + 300000 ? signed : now);
    await signedBy(certs[1], certs[2]);
    await signedBy(certs[0], certs[1]);
  }
  const { key, size } = await keyOf(certs[0]);
  const sig = b64(parts[2]);
  if (sig.length !== size * 2 || !await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, enc.encode(parts[0] + "." + parts[1]))) fail("That purchase's signature doesn't check out.");
  return body;
}

/** The same check, for anything else the App Store signs this way (server notifications and what they carry). */
export const verifySigned = verifyTransaction;
