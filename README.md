<p align="center">
  <a href="https://remmynd.space"><img src="public/icon.svg" width="72" height="72" alt="remmynd"></a>
</p>

<h1 align="center">remmynd</h1>

<p align="center"><strong>Reminders, as a link.</strong><br>
Type what and when. Share the link. Anyone who taps it saves it to their calendar in one tap.</p>

<p align="center">
  <a href="https://remmynd.space">remmynd.space</a> ·
  <a href="https://www.npmjs.com/package/remmynd"><img src="https://img.shields.io/npm/v/remmynd?color=0e0f11&label=npm" alt="npm version"></a>
  <a href="https://github.com/Remmynd/remmynd/actions/workflows/ci.yml"><img src="https://github.com/Remmynd/remmynd/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-0e0f11" alt="MIT licence"></a>
</p>

---

## Why

Most "add to calendar" tools want an account, a dashboard and your visitors' data. remmynd wants none of that.

- **No sign-up**, for you or for the people you share with.
- **Nothing stored.** The whole reminder lives in the link, after the `#`. Browsers never send that part to a server, so remmynd.space cannot see what anyone is reminded about.
- **One tap to save.** "Remind me" picks the right calendar for the device: Apple Calendar on iPhone, iPad and Mac Safari, Google Calendar everywhere else. Outlook, Microsoft 365, the phone's share sheet (Reminders, Notes) and plain text are one tap away.
- **Sleep-safe.** If an event falls between 11 PM and 7 AM for a visitor, they can be reminded at 9 AM their time instead.
- **Free and open source** under the MIT licence. Host your own copy if you like.

## Use it

### On the web

Go to [remmynd.space](https://remmynd.space), fill in **what**, **when** and optionally **where**, then copy or share the link.

### Put a Remind me button on your site

[![Remind me](https://remmynd.space/badge.svg)](https://remmynd.space/example)

```html
<a href="YOUR-REMMYND-LINK" target="_blank" rel="noopener">
  <img src="https://remmynd.space/badge.svg" alt="Remind me" width="172" height="44">
</a>
```

Markdown:

```md
[![Remind me](https://remmynd.space/badge.svg)](YOUR-REMMYND-LINK)
```

A dark version is at `https://remmynd.space/badge-dark.svg`.

### From the command line

```sh
npx remmynd "Demo day" --at "2026-12-05 18:00" --tz Asia/Kolkata --where https://lu.ma/demo
```

```text
Options
  --at, -a       When, e.g. "2026-12-05 18:00" (local to --tz) or an ISO time with Z
  --tz, -z       IANA time zone for --at (default: your system zone)
  --where, -w    A place or a link
  --notes, -n    One line of notes
  --host         Who is hosting
  --length, -l   Minutes (default 60)
  --ics [file]   Also write an .ics file ("-" prints it)
  --badge <fmt>  Print a Remind me badge snippet: html or md
  --dark         Use the dark badge
  --google       Also print a Google Calendar link
  --json         Print everything as JSON
  --base <url>   Use your own remmynd host

remmynd read <link>   Show what is inside a remmynd link
```

### In your code

```sh
npm install remmynd
```

```js
import { createLink, toICS, googleCalendarUrl, decode } from "remmynd";

const event = {
  title: "Demo day",
  start: "2026-12-05 18:00",
  timeZone: "Asia/Kolkata",
  location: "https://lu.ma/demo",
  durationMinutes: 90
};

createLink(event);         // https://remmynd.space/#eyJ0Ijoi...
toICS(event);              // .ics text with alerts 1 hour before and at the start
googleCalendarUrl(event);  // Google Calendar "add event" link
decode(link);              // { title, start: Date, durationMinutes, location, notes, host }
```

Zero dependencies. Works in Node 20+, Deno, Bun, Cloudflare Workers and browsers. Types included.

## How a link works

```text
https://remmynd.space/#eyJ0IjoiRGVtbyBkYXkiLCJzIjoiaHRxc3UifQ
                       └──────── base64url JSON ─────────┘
```

| Key | Meaning |
|---|---|
| `t` | Title |
| `s` | Start, in minutes since 1970 (UTC), base 36 |
| `d` | Length in minutes (omitted when 60) |
| `l` | Place or link |
| `n` | Notes |
| `h` | Host |

Times are stored in UTC and shown in each visitor's own time zone.

Saved events include the reminder link and a short "Made with remmynd.space" line in their notes. Nothing about the person saving the event is collected or added.

## Privacy

- No database, no accounts, no cookies, no analytics.
- The site is static. One small server function, `functions/ics.js`, exists only for iPhone in-app browsers (Instagram, LinkedIn, Chrome on iOS), which ignore calendar files made inside the page. It builds the file from the link in memory and stores nothing.

## Self-host

The site is the `public/` folder plus `functions/ics.js`. On Cloudflare Pages:

1. Fork this repo.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Build command: none. Build output directory: `public`.

Or deploy from your machine with `npm run deploy` (uses Wrangler).

Any static host works for the site itself. Without `functions/ics.js`, everything works except the iPhone in-app browser fallback.

## Develop

```sh
git clone https://github.com/Remmynd/remmynd.git
cd remmynd
npm test        # library, CLI and site checks
npm run dev     # serves public/ locally
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Limits

- Calendar apps always ask for one confirming tap. No website can add an event silently.
- A saved event does not update if the original link changes. Make a new link for a new time.
- A web page cannot schedule a phone notification on its own, so remmynd uses your calendar's alerts.

## Licence

[MIT](LICENSE) © zoof04

---

<p align="center">Built and maintained by <a href="https://zoof04.com">zoof04</a>.</p>
