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
