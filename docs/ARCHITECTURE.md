# Architecture

remmynd has three parts that share one link format:

| Part | Where | What it does |
|---|---|---|
| **Website** | `public/` | Makes links, shows reminders, opens the visitor's calendar. `index.html` is the app, `app.css` its styles on the 2.0 design tokens, `fonts/` the self-hosted Geist fonts, `push.js` adds Notify me, `sw.js` works offline and shows alerts, `remmynd.js` is an exact copy of the library for the page to import. No build step. |
| **Worker** | `worker/` | Serves the site on Cloudflare, adds link-preview tags to shared `/r/` links (`preview.js`), turns `/new` addresses into links, redirects `www`, builds `.ics` files for iPhone in-app browsers, and wakes devices for phone alerts. It reads links with the library itself. |
| **Library and CLI** | `lib/`, `bin/` | The `remmynd` npm package and `npx remmynd`. Zero dependencies. |

The tests in `test/` check that the website, the library and the Worker produce identical links, so the three never drift apart.

## The link

Everything about a reminder lives in the link, as base64url-encoded JSON. The same payload comes in two forms:

```text
https://remmynd.space/r/eyJ0IjoiRGVtbyBkYXkiLCJzIjoiaHRxc3UifQ   shared (the default)
https://remmynd.space/#eyJ0IjoiRGVtbyBkYXkiLCJzIjoiaHRxc3UifQ    private, and every 1.x link
└──────── page ──────┘  └──── base64url-encoded JSON ────────┘
                          {"t":"Demo day","s":"htqsu"}
```

| Form | Reaches the server? | Used for |
|---|---|---|
| Shared `/r/<payload>` | Yes, in passing: the Worker reads it to fill the preview tags, then forgets it. Never stored, logged or cached. | Links meant to be shared in chat |
| Private `/#<payload>` | No. Browsers never send what follows `#`. | The **Private link** switch, and every 1.x link |
| Written by hand `/new?t=…&at=…` | Yes, in passing | Scripts, spreadsheets and AI assistants. Redirects to the shared form. |

| Key | Meaning | Notes |
|---|---|---|
| `t` | Title | Required |
| `s` | Start | Minutes since 1970 UTC, base 36 |
| `d` | Length in minutes | Omitted when 60 |
| `l` | Place or link | Optional |
| `n` | Notes | Optional |
| `h` | Host | Optional |
| `z` | The host's IANA time zone | Optional. The ticket shows "Host time"; the preview prints the time in this zone, or UTC without it |

The format is a public contract. New keys must be optional, readers ignore keys they don't know, and old links must keep working.

## What happens when someone taps a link

```mermaid
sequenceDiagram
    autonumber
    actor V as Visitor
    participant B as Browser
    participant E as Cloudflare edge (Worker)
    participant C as Calendar app

    alt Shared link
        V->>B: Taps https://remmynd.space/r/eyJ0Ij…
        B->>E: GET /r/eyJ0Ij…
        E-->>B: index.html with this reminder's preview tags, no-store
    else Private link
        V->>B: Taps https://remmynd.space/#eyJ0Ij…
        B->>E: GET /  (the #fragment is never sent)
        E-->>B: index.html, from static assets
    end
    B->>B: Decodes the link, shows the event in the visitor's time zone
    V->>B: Taps "Remind me"
    alt Apple device in Safari
        B->>C: .ics file made in the page
    else iPhone in-app browser (Instagram, LinkedIn…)
        B->>E: GET /ics?d=… (event data only)
        E-->>B: .ics built in memory, kept nowhere
        B->>C: Opens the calendar file
    else Everything else
        B->>C: Google Calendar "add event" link
    end
    C-->>V: One confirming tap saves the event, with alerts 1 h before and at the start
```

## How phone alerts work

Notify me is optional and needs the person's permission. Your reminder lives in the link and on your device. For phone alerts we keep only an anonymous ping time, deleted once it's sent.

```mermaid
sequenceDiagram
    autonumber
    actor V as Visitor
    participant P as Page (push.js)
    participant D as Device storage (IndexedDB)
    participant E as Worker
    participant DB as D1 table pings
    participant S as Service worker (sw.js)

    V->>P: Taps "Notify me" and allows notifications
    P->>D: Saves title, time and link, one row per alert
    P->>E: POST /push/schedule (push address, random ids, times)
    E->>DB: Stores id, push address and time only
    Note over E,DB: A cron runs every minute
    E->>DB: Finds pings that are due
    E->>S: Sends an empty push (no payload)
    E->>DB: Deletes the row
    S->>D: Looks up what's due on this device
    S-->>V: Shows "Demo day starts in 1 hour", with Snooze and Open where supported
```

| Detail | Value |
|---|---|
| Alerts per reminder | 1 hour before and at the start, or one 9 AM alert when sleep-safe is on |
| Server row | `id`, `endpoint`, `at`, `created` (`worker/schema.sql`); nothing about the event |
| Limits | 8 pings per request, 200 rows per device, at most 400 days ahead |
| Push services accepted | Google (FCM), Mozilla, Apple and Windows push hosts only |
| Cancelling | `POST /push/cancel` with the same push address; a device can only cancel its own pings |
| Gone devices | A 400, 403, 404 or 410 from the push service deletes every row for that address |
| iPhone | Needs remmynd on the Home Screen (iOS 16.4 and later); no Snooze or Open buttons |

## How requests are routed

Every request goes through `worker/index.js` first (`run_worker_first = true` in `wrangler.toml`), then falls through to the static files in `public/`.

```mermaid
flowchart TD
    R([Request]) --> W{Host starts with www.?}
    W -- yes --> RW[301 to remmynd.space, same path]
    W -- no --> I{Path is /ics?}
    I -- "GET / HEAD" --> ICS["Build .ics from ?d=<br/>Cache-Control: no-store"]
    I -- other method --> M405[405]
    I -- no --> PU{Path starts with /push/?}
    PU -- yes --> PR["/push/key, /push/schedule, /push/cancel<br/>JSON, Cache-Control: no-store"]
    PU -- no --> SR{Path starts with /r/?}
    SR -- "valid payload" --> PV["index.html + preview tags (HTMLRewriter)<br/>no-store, noindex"]
    SR -- "bad payload" --> SH["Plain index.html, no-store"]
    SR -- no --> NW{Path is /new?}
    NW -- "exact time (tz, Z or offset)" --> RN["302 to the /r/ link"]
    NW -- "no zone or missing parts" --> SN["Plain index.html, no-store;<br/>the page reads the time in the visitor's zone"]
    NW -- no --> P{Named page, e.g. /example?}
    P -- yes --> RP["302 to /#example"]
    P -- no --> A[(Static assets<br/>public/)]
    A -- found --> OK[200 + headers from public/_headers]
    A -- not found --> NF[404 page]
```

Headers for static files live in `public/_headers`: security headers on every response, `no-cache` on the service worker so updates arrive immediately, a year of caching for icons and a day for badges.

## Hosting

| Piece | Setting |
|---|---|
| Worker | `remmynd` on Cloudflare Workers, static assets from `public/` |
| Domains | `remmynd.space` and `www.remmynd.space`, attached as Worker custom domains in `wrangler.toml` |
| DNS | Cloudflare (`june` and `maxim.ns.cloudflare.com`); records are managed by the Worker's custom domains |
| HTTPS | Cloudflare certificates, HTTP redirects to HTTPS |
| Preview URLs | Off |
| Push storage | D1 database `remmynd`, table `pings`, bound as `DB` |
| Push timing | Cron trigger every minute (`scheduled` in `worker/index.js`) |
| Push keys | VAPID public key in `wrangler.toml`, private key as the Worker secret `VAPID_PRIVATE_JWK` |
| Logs | Workers observability is off in `wrangler.toml` (`[observability] enabled = false`, kept off by a test), and the Worker never logs request addresses |

## Delivery pipeline

```mermaid
flowchart LR
    PR[Pull request] --> CI["CI<br/>tests on Node 20, 22, 24<br/>Worker build check"]
    CI --> RV[Review and merge]
    RV --> MAIN[(main)]
    MAIN --> DEP["Cloudflare Workers Builds<br/>wrangler deploy"]
    DEP --> LIVE([remmynd.space])
    LIVE -.-> CHK["Live check<br/>every 6 hours"]
    MAIN -- "package.json version changed" --> REL["Release workflow<br/>tag → GitHub release → npm publish"]
    REL --> NPM([npm: remmynd])
```

Details, setup and rollback: [RELEASING.md](RELEASING.md).

## Repository layout

```text
public/          the website: index.html, app.css, fonts/, push.js, sw.js, remmynd.js, icons, badges, manifest, _headers
worker/          Cloudflare Worker: routing, /r/ previews and /new (preview.js), the /ics route and push (push.js, schema.sql)
lib/             the npm library (remmynd.js) and its TypeScript types
bin/             the npx remmynd command
test/            node:test suite for the library, CLI, site and Worker, plus guards for third parties, size and logs
scripts/         release helpers and push:setup
brand/           logo, mark, avatars, social images and the brand guide
docs/            principles, architecture and the release runbook
.github/         CI, release and live-check workflows, issue and PR templates
wrangler.toml    Worker configuration
```
