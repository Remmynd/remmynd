-- remmynd push pings. No titles, no links, no personal data: only when to wake which device.
CREATE TABLE IF NOT EXISTS pings (
  id       TEXT PRIMARY KEY,   -- random id made on the device
  endpoint TEXT NOT NULL,      -- the browser's push address (anonymous)
  at       INTEGER NOT NULL,   -- when to send, ms since 1970 UTC
  created  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pings_at ON pings (at);
CREATE INDEX IF NOT EXISTS pings_endpoint ON pings (endpoint);

-- Optional sign-in (worker/account.js creates these on first use too).
-- Kept only for people who sign in: their email address, passkeys, sessions, reminders and links
-- (never private links), and the reminder emails waiting to be sent. Deleted with the account.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, email_alerts INTEGER NOT NULL DEFAULT 1, stop_token TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, name TEXT, created INTEGER NOT NULL, last_used INTEGER);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys (user_id);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL, sends INTEGER NOT NULL DEFAULT 1, window_start INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id TEXT, kind TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items (user_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, kind, key));
CREATE INDEX IF NOT EXISTS items_updated ON items (user_id, updated);
CREATE TABLE IF NOT EXISTS mails (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS mails_at ON mails (at);
CREATE INDEX IF NOT EXISTS mails_user_key ON mails (user_id, key);
CREATE TABLE IF NOT EXISTS sends (hour INTEGER PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS feeds (user_id TEXT NOT NULL, kind TEXT NOT NULL, token_hash TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (user_id, kind));
CREATE UNIQUE INDEX IF NOT EXISTS feeds_token ON feeds (token_hash);
-- remmynd Pro: one row per purchase, from Polar (the website) or Apple (the app). No card, no address.
CREATE TABLE IF NOT EXISTS pro (source TEXT NOT NULL, ref TEXT NOT NULL, user_id TEXT NOT NULL, product TEXT NOT NULL, until INTEGER NOT NULL, trial INTEGER NOT NULL DEFAULT 0, renews INTEGER NOT NULL DEFAULT 1, env TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL, moved INTEGER NOT NULL DEFAULT 0, voided INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source, ref));
CREATE INDEX IF NOT EXISTS pro_user ON pro (user_id);

-- Public counts, only for reminders whose host switched them on. One number per reminder.
-- worker/count.js creates this on first use too. No names, no addresses, no device ids.
CREATE TABLE IF NOT EXISTS counts (
  key   TEXT PRIMARY KEY,   -- SHA-256 of the link's payload, in hex
  n     INTEGER NOT NULL,   -- how many people tapped Remind me
  ends  INTEGER NOT NULL,   -- when the reminder ends, ms since 1970 UTC
  win   INTEGER NOT NULL,   -- the minute of the latest join
  win_n INTEGER NOT NULL    -- joins in that minute
);
CREATE INDEX IF NOT EXISTS counts_ends ON counts (ends);

-- Host pages (worker/hosts.js; account.js creates these on first use too). Public by the host's choice: a handle,
-- a name, a line and a link, and the launches they publish. Deleted with the account.
CREATE TABLE IF NOT EXISTS hosts (user_id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS launches (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, start INTEGER NOT NULL, dur INTEGER NOT NULL DEFAULT 60, tz TEXT NOT NULL, dest TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, UNIQUE (user_id, slug));
CREATE INDEX IF NOT EXISTS launches_user ON launches (user_id, start);

-- Crews (worker/crews.js): who's doing a shared reminder together. First names and statuses only; gone a day after it ends.
CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, ends INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS crew_members (crew TEXT NOT NULL, user_id TEXT NOT NULL, mid TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, kudos INTEGER NOT NULL DEFAULT 0, joined INTEGER NOT NULL, PRIMARY KEY (crew, user_id));
CREATE INDEX IF NOT EXISTS crew_members_user ON crew_members (user_id);
CREATE TABLE IF NOT EXISTS crew_kudos (crew TEXT NOT NULL, from_mid TEXT NOT NULL, to_mid TEXT NOT NULL, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS crew_kudos_to ON crew_kudos (to_mid, seen);
