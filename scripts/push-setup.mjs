#!/usr/bin/env node
// One-time setup for push notifications on Cloudflare. Run from the repo root:
//   npm run push:setup
// It creates (or reuses) the D1 database, creates its table, makes a VAPID key pair,
// stores the private key as a Worker secret (it never touches disk), and writes the
// database id and public key into wrangler.toml. Then commit and push.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";

const W = ["--yes", "wrangler@4"];
const run = (args, opts = {}) => spawnSync("npx", [...W, ...args], { encoding: "utf8", ...opts });
const say = s => console.log("\n› " + s);
const fail = s => { console.error("\n✗ " + s); process.exit(1); };

const toml = readFileSync("wrangler.toml", "utf8");
const START = "# --- Push notifications", END = "# --- end push ---";
if (!toml.includes(START) || !toml.includes(END)) fail("wrangler.toml has no push block. Is this the remmynd repo?");

say("Checking you're logged in to Cloudflare");
const who = run(["whoami"]);
if (who.status !== 0 || /not authenticated/i.test(who.stdout + who.stderr)) fail("Run `npx wrangler login` first, then run this again.");

say("Finding or creating the D1 database \"remmynd\"");
const list = () => { const r = run(["d1", "list", "--json"]); try { return JSON.parse(r.stdout); } catch { return []; } };
let db = list().find(d => d.name === "remmynd");
if (!db) {
  const c = run(["d1", "create", "remmynd"], { stdio: ["inherit", "pipe", "inherit"] });
  if (c.status !== 0) fail("Couldn't create the database.");
  db = list().find(d => d.name === "remmynd");
}
const dbId = db && (db.uuid || db.database_id || db.id);
if (!dbId) fail("Couldn't read the database id. Run `npx wrangler d1 list` to check.");
console.log("  database id: " + dbId);

say("Creating the pings table (answer yes if asked)");
const ex = run(["d1", "execute", "remmynd", "--remote", "--file=worker/schema.sql"], { stdio: "inherit" });
if (ex.status !== 0) fail("Couldn't create the table.");

const existingKey = (toml.match(/^\s*VAPID_PUBLIC_KEY\s*=\s*"([^"]+)"/m) || [])[1];
let publicKey = existingKey;
if (existingKey && !process.argv.includes("--rotate")) {
  say("Keeping the existing VAPID key (use --rotate to replace it; that turns off every existing subscription)");
} else {
  say("Making a VAPID key pair and saving the private half as a Worker secret");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const b = s => Buffer.from(s, "base64url");
  publicKey = Buffer.concat([Buffer.from([4]), b(jwk.x), b(jwk.y)]).toString("base64url");
  const sec = run(["secret", "put", "VAPID_PRIVATE_JWK"], { input: JSON.stringify(jwk), stdio: ["pipe", "inherit", "inherit"] });
  if (sec.status !== 0) fail("Couldn't save the secret. Deploy the Worker once (npm run ship), then run this again.");
}

say("Writing the database id and public key into wrangler.toml");
const block = `${START}: filled in by \`npm run push:setup\` ---
[[d1_databases]]
binding = "DB"
database_name = "remmynd"
database_id = "${dbId}"

[triggers]
crons = ["* * * * *"]

[vars]
VAPID_PUBLIC_KEY = "${publicKey}"
VAPID_SUBJECT = "mailto:connect@zoof04.com"
${END}`;
const i = toml.indexOf(START), j = toml.indexOf(END) + END.length;
writeFileSync("wrangler.toml", toml.slice(0, i) + block + toml.slice(j));

console.log(`
✓ Push notifications are set up.

Next:
  git commit -am "Turn on push notifications"
  git push            (or: npm run ship)

Then open remmynd.space on your phone, add it to the Home Screen, open a reminder
and switch on "Notify me".`);
