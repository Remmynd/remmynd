-- remmynd push pings. No titles, no links, no personal data: only when to wake which device.
CREATE TABLE IF NOT EXISTS pings (
  id       TEXT PRIMARY KEY,   -- random id made on the device
  endpoint TEXT NOT NULL,      -- the browser's push address (anonymous)
  at       INTEGER NOT NULL,   -- when to send, ms since 1970 UTC
  created  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pings_at ON pings (at);
CREATE INDEX IF NOT EXISTS pings_endpoint ON pings (endpoint);
