# remmynd 2.0 build spec

Locked on 10 November 2026 by the owner (Smitesh, zoof04). Target go-live: Tuesday 24 November 2026 (an estimate, not a promise).

This file is the single source of truth for the 2.0 build. Read it fully before changing code. Where a mock-up in `reference/` disagrees with this file, this file wins. Where this file is silent, ask the owner.

## 1. What 2.0 is

remmynd 1.x turns an event into a link that people save to their calendar. remmynd 2.0 keeps that and adds three jobs:

1. **Capture** in five seconds: one typed line becomes a reminder.
2. **Remind** in layers: calendar and notification from one tap.
3. **Follow through**: at the moment it carries the action, afterwards it asks once (done or not yet), and it can nudge up to three times.

It also gets a new look (the ticket and the "moment ring"), a dark theme, and a small website behind the tool.

## 2. Decisions (locked)

| # | Decision | Detail |
|---|---|---|
| 1 | Colours | Light theme "Daylight" (paper, ink, amber). Dark theme "Night shift" (near-black, electric lime). Follows the system setting, with a manual switch: Auto, Light, Dark. Values: `tokens.css`. |
| 2 | Headline | "Reminders that make sure it happens." |
| 3 | Link previews | On by default. Shared links use the path form `/r/<payload>` so chat preview cards show the title and time. A "Private link" switch gives the old form `/#<payload>`, which never reaches a server. |
| 4 | Nudges | Off by default. One switch per reminder. At most 3 nudges, 10 minutes apart. |
| 5 | Email reminders | Not in 2.0. The stack shows a muted "Email, coming in December" row. |
| 6 | "Free" wording | Soften the public promise: free for everyone who makes or saves a reminder. Remove "no pro tier" and "none of them is a phase". |
| 7 | Where it is built | In this repo on the owner's Mac, following `docs/RELEASING.md` (branches, pull requests, green CI). |

Decisions 2, 3 and 6 change `docs/PRINCIPLES.md`. The exact edits are in section 6, step 0.3.

## 3. Rules that never bend

- **Credit.** Every commit is authored `zoof04 <smitesh@zoof04.com>`. No other author, co-author, tool name or product name appears in commits, code, comments or docs. The tests "repository credits zoof04 only" and "git history credits zoof04 only" enforce this. Never weaken them.
- **Privacy wording** (approved, use verbatim; on 11 November 2026 the owner added optional sign-in and changed "no sign-up" to "no account needed"): "Free, no sign-up, no tracking." and "Your reminder lives in the link and on your device. For phone alerts we keep only an anonymous ping time, deleted once it's sent." Do not write "nothing stored".
- **No tracking, no third parties.** No analytics, cookies or accounts. The site makes zero requests to other hosts: fonts are self-hosted. Links out (calendar pages, zoof04.com, GitHub) are fine.
- **No logs.** The Worker never logs request addresses. Keep observability off in `wrangler.toml`.
- **Old links never break.** Every 1.x link (`/#<payload>`, named pages) keeps working. New payload keys are optional.
- **Small.** App code (HTML, CSS and JS the app loads on first visit) stays under 60 KB compressed. The whole first visit, fonts included, stays under 150 KB. No framework, no bundler.
- **Fast.** Opens in under 1 second on a mid-range phone on 4G. Every tap responds in under 100 ms.
- **Accessible.** WCAG 2.2 AA contrast, tap targets of 44 px or more, a text label on every icon button, full keyboard use, sensible screen-reader names, and all motion off under `prefers-reduced-motion`.
- **Honest buttons.** Never claim what we cannot know. We cannot tell whether someone finished saving in their calendar app, so say "Sent to Apple Calendar. Confirm there.", not "Added".
- **Process.** `npm run check` passes before every commit. Each step adds tests and a line under Unreleased in `CHANGELOG.md`. Do not push, merge, deploy or publish unless the owner says so.

## 4. What exists today

- `public/index.html` holds the whole app (about 47 KB raw). `public/push.js` and `public/sw.js` add notifications.
- `worker/` serves the site, redirects `www`, builds `.ics` files (`/ics`), and runs push (`/push/key`, `/push/schedule`, `/push/cancel`, a cron every minute, D1 table `pings`). Limits: 8 pings per request, 200 rows per device.
- `lib/remmynd.js` is the npm library (`encode`, `decode`, `createLink`, `toICS`, `googleCalendarUrl`, `outlookUrl`, `badgeSVG`, and others). `bin/remmynd.js` is the CLI.
- Payload: base64url JSON `{t, s, d?, l?, n?, h?}`. `s` is minutes since 1970 UTC in base 36.
- On-device storage: IndexedDB `remmynd`, store `alerts` (key `id`, index `rkey`).
- The Mac's `main` has two commits that are not on GitHub ("Make installing remmynd one tap where possible", "Add private push notifications"). GitHub's `main` has one commit the Mac lacks (docs, release scripts, live check). Step 0.1 fixes this.

## 5. Architecture changes

### 5.1 Files

```text
public/
  index.html        app shell: markup only
  app.css           tokens and components, light and dark
  app.js            app logic (ES module)
  remmynd.js        byte-for-byte copy of lib/remmynd.js (a test enforces it)
  ring.js           the moment ring
  db.js             on-device storage, shared by the page and the service worker
  push.js           notification controls (exists)
  qr.js             QR generator, loaded only when a QR is shown
  sw.js             service worker (exists)
  fonts/            Geist and Geist Mono, woff2, with their licence
  site.css          styles for the website pages
  why/ hosts/ docs/ privacy/ install/ roadmap/ press/   one index.html each
  llms.txt
worker/
  index.js          routes
  preview.js        preview tags for /r/ links
  changelog.js      renders CHANGELOG.md at /changelog
lib/
  remmynd.js        adds parse(), fromQuery(), toPath()
```

### 5.2 Link forms

| Form | Example | Reaches our server? | Used for |
|---|---|---|---|
| Shared (new default) | `remmynd.space/r/<payload>` | Yes, in passing, to build the preview. Never stored or logged. | Links meant to be shared |
| Private | `remmynd.space/#<payload>` | No | The "Private link" switch, and every 1.x link |
| Written by hand | `remmynd.space/new?t=...&at=...&tz=...` | Yes, in passing | Scripts, spreadsheets, AI assistants |

New optional payload key: `z`, the host's IANA time zone (for example `Asia/Kolkata`). It lets the ticket show "Host time" and lets the preview print a readable time. Readers must ignore keys they do not know.

### 5.3 Worker routes (added)

- `GET /r/<payload>`: decode and validate (at most 2,000 characters, valid JSON, required keys). Fetch `index.html` from assets and use `HTMLRewriter` to set `<title>`, `og:title` (the title), `og:description` ("Fri 13 Nov, 5:00 PM IST · Tap to get reminded", in zone `z`, or UTC when `z` is missing) and the Twitter card tags. The image stays the static `og.png`. Send `Cache-Control: no-store`. A bad payload gets the plain shell.
- `GET /new`: parameters `t` (required), `at` (`YYYY-MM-DDTHH:mm`, optionally with `Z` or an offset), `tz`, `d` (minutes), `l`, `n`, `h`. When the time is unambiguous (`tz` given, or `at` carries an offset), redirect 302 to `/r/<payload>`. Otherwise serve the shell and let the page resolve the time in the device's zone, then replace the address with the `/r/` form.
- `GET /changelog`: render `CHANGELOG.md` (bundled as text) inside the site shell.

### 5.4 Service worker

- Bump the cache name. Cache the new files.
- Never cache a `/r/` response. When offline, answer `/r/` navigations with the cached shell.
- New alert kinds: `check` and `nudge` (section 6, step 5).

### 5.5 On-device storage

IndexedDB `remmynd`, version 2, opened only through `db.js`:

- `alerts` (exists).
- `reminders`, key `rkey`: `title`, `start`, `dur`, `place`, `host`, `z`, `share`, `state` (`held`, `kept`, `dropped`), `nudge` (boolean), `heldAt`, `doneAt`, `replanAt`.
- `links`, key `share`: `title`, `start`, `createdAt`, `private` (boolean).

On upgrade from version 1, build `reminders` from the existing `alerts`, grouped by `rkey`.

## 6. Steps, in order

One pull request per step. Steps 0.2 to 9 go into a long-lived `v2` branch, so the live site stays on 1.x until go-live.

### Step 0. Sync and groundwork

- **0.1 Sync.** Put the Mac's two local commits on a branch (`feat/install-and-push`), rebase it onto `origin/main`, resolve conflicts by keeping both sides (expect `README.md`, `CHANGELOG.md`, `package.json`, `test/remmynd.test.js`), update `docs/PRINCIPLES.md`, `docs/ARCHITECTURE.md` and the README so they describe push with the approved privacy wording, run `npm run check`, and open a pull request to `main`. Then point local `main` at `origin/main`. The owner still has to run `npm run push:setup` once.
- **0.2 Branch.** Create `v2` from the updated `main`.
- **0.3 Principles.** Edit `docs/PRINCIPLES.md`:
  - Principle 1: a reminder is still just a link. Shared links carry the details in the address so previews can show them; the Worker reads them only to build the preview and stores and logs nothing. Private links keep everything after the `#`.
  - Principle 2: retitle to "Free, no sign-up, no tracking". Free for everyone who makes or saves a reminder. Replace the "Nothing stored" bullet with the approved privacy sentences. Remove "no pro tier" and "none of them is a phase".
  - Principle 3: notifications now exist, with the person's permission.
  - Principle 4: "under 60 KB of code, no framework" replaces "one page, one file".
  - Principle 5: one line states the aim, "Reminders that make sure it happens." Everything else says plainly what the product does. We never quote attendance numbers we have not measured.
  - "How we decide", question 2: "Does it keep remmynd free for people, sign-up free and tracking free?"
- **0.4 Tokens and fonts.** Move styles to `public/app.css` using `tokens.css` from this folder. Self-host Geist and Geist Mono (SIL Open Font Licence; include the licence file; Latin subset; `font-display: swap`). Remove every Google Fonts tag. Add the theme switch (Auto, Light, Dark; stored in `localStorage` as `rm:theme`) and matching `theme-color` meta tags.
- **0.5 Guard tests.** Add tests for: no address of another host is loaded by anything in `public/` (links out are allowed); the size budgets in section 3; `public/remmynd.js` equals `lib/remmynd.js`; `wrangler.toml` has observability off.

### Step 1. Links

Add the `z` key, `/r/` links with previews, the "Private link" switch, and `/new`. In the library add `toPath()`, `fromQuery()` and a `private` option on `createLink()`; in the CLI add `--private`. Tests: old links still decode; the site and library agree; the preview tags escape hostile titles; `/new` redirects correctly; bad payloads fall back to the shell; `/r/` responses are `no-store`.

### Step 2. One-line capture

`parse(text, {now, timeZone})` in the library returns `{title, start, dur, place, tokens}`. It must read: today, tonight, tomorrow, weekday names, "next Friday", "13 Nov", "Nov 13", "13/11", "1st", ISO dates; "5pm", "5:30 pm", "17:00", noon, midnight; "in 2 hours", "in 30 min"; "for 30 min"; web addresses; and a trailing "at <place>". A date with no time means 9:00 AM. A time with no date means the next time that hour comes. Whatever is left is the title. At least 40 test cases, including pasted invitation text.

Interface: one input, docked at the bottom on phones and in the left pane on desktop. The ticket preview updates on every keystroke. Chips show What, When and Where; tapping a chip edits that part with the native picker. Enter makes the link, copies it and saves it to `links`. See `reference/01-home.html`, `02-one-line-in.html`, `03-link-ready.html`.

### Step 3. The ticket and the moment ring

Build `ring.js` to the geometry in section 8 and the ticket layouts in `reference/04-ticket-open.html` and `reference/desktop-app.html`. Two panes from 960 px wide. Use same-document view transitions for line-to-ticket, with a plain swap where they are not supported. Keep the existing sleep-safe behaviour for overnight events.

### Step 4. The reminder stack

"Remind me" does what 1.x does for the device (Apple Calendar file on Apple devices, Google Calendar elsewhere), turns on notifications where they are allowed, saves the reminder to `reminders`, and shows the stack: Calendar, Notification, the muted Email row, and the nudge switch. "More ways to be reminded" opens the existing options (Google, Outlook, Office 365, Apple, share, copy). The existing install helper appears after the first save. See `reference/05-ticket-held.html`.

### Step 5. Follow through

- Ring states Soon, Now, Kept and Missed (section 8).
- At the start, the ticket shows "Open the link" (or "Directions" for a place), "Not yet" and "Done". See `reference/06-ticket-now.html`.
- "Not yet" opens the re-plan sheet: in 10 minutes, tonight at 8:00 PM (hidden after 7:00 PM), tomorrow at 9:00 AM, Monday at 9:00 AM, pick a time, drop this reminder. See `reference/07-replan.html`.
- New alerts: one `check` alert when the event ends (start plus its length, or 30 minutes if no length) asking "did you make it?", with Done and Not yet where the platform shows buttons. If the nudge switch is on, `nudge` alerts at 10, 20 and 30 minutes after the start, stopping as soon as the person opens the link, taps Done, re-plans or drops it.
- Each alert is one more anonymous ping through the existing `/push/schedule`. Cancel unused pings with `/push/cancel`. Stay inside the existing limits.
- On iPhone, web alerts have no buttons: a tap opens the ticket with the same choices.

### Step 6. Lists

"Coming up" (from `reminders`) and "My links" (from `links`), grouped Today, This week, Later, Kept. Swipe a row left to reveal Re-plan and Done. Desktop keys: J and K move, D marks done, S re-plans, Enter opens. Empty states say what to do next. See `reference/08-coming-up.html`.

### Step 7. Desk to phone, and the host kit

- QR code for any link, drawn on the device by `qr.js`, loaded only when asked for. If a third-party QR routine is used it must be MIT or similar, vendored, credited in its file header, and under 6 KB compressed.
- New badge art with the ring, light and dark, through `badgeSVG()`, keeping the existing file addresses.
- The "How it looks in chats" card and QR download on the link-ready screen.

### Step 8. Website

Static pages sharing `site.css`: `/why`, `/hosts`, `/docs`, `/privacy`, `/install`, `/roadmap`, `/press`, plus `/changelog` from the Worker. Same header and footer on every page; a test fails if they drift apart. Every figure on the site is real and checkable: no invented logos, user counts, testimonials or funding lines. Add `llms.txt`, update `sitemap.xml`. See `reference/web-home.html`, `web-why.html`, `web-roadmap.html`. The research figures and their sources on `/why` are listed in section 10.

### Step 9. Polish and release

Dark theme on every screen. Accessibility pass. Budgets met and measured. Device checks (section 11). Update `README.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md`. `npm run release -- major` for 2.0.0. One pull request from `v2` to `main`.

### Only if everything above is done

Floating countdown on desktop (Document Picture-in-Picture, with the button hidden where unsupported), a Ctrl or Cmd + K command palette, and the "Kept 6 of 7 this month" line.

## 7. Where the product differs from the mock-ups

| The mock-up shows | The product does |
|---|---|
| "Demo day", "Northwind", fixed dates | Real data. The three "Try one" examples are computed from today so they are never in the past. |
| "Added to Apple Calendar" | "Sent to Apple Calendar. Confirm there." (and the matching line for Google or Outlook) |
| A microphone button on the capture bar | Not in 2.0. Leave it out. |
| "Kept 6 of 7 this month" | Hidden until built (see the end of section 6). |
| A QR pattern | A placeholder. Draw a real code. |
| `[STARS]`, `[DOWNLOADS]`, `[TESTS]` | Live numbers from the public GitHub and npm addresses, fetched by the page. If a fetch fails, hide the tile. |
| Light theme only | Both themes, from `tokens.css`. |
| Menu button | A sheet with Why, For hosts, Docs, Roadmap, GitHub and the theme switch. |
| Fixed 390 by 844 frames | Fluid layouts from 320 px up. |

## 8. The moment ring

The logo is the interface. Draw it in a `0 0 120 120` box, centre (60, 60).

- It is a 24-hour dial of the viewer's own day: noon at the top, midnight at the bottom, clockwise.
- Angle for a local time `h:m`: `a = (h + m/60 - 12) * 15` degrees.
- Point at angle `a`, radius `r`: `x = 60 + r * sin(a)`, `y = 60 - r * cos(a)`.
- Night arc: radius 33, from 150 degrees (22:00) clockwise to 270 degrees (06:00), stroke 8, colour `--night-arc`.
- Ring: radius 44, stroke 5, colour `--ink`. Hand: from the centre to the point at radius 30. Pivot: radius 4. Dot: radius 8 at radius 44, colour `--moment`.

| State | When | Drawing |
|---|---|---|
| Open | Not saved | Ring with a gap of 18 degrees each side of the dot |
| Held | Saved | Full ring. Dot gets a 3 px outline in `--card`. |
| Soon | Last 60 minutes | Held, plus a halo (radius 15, 28% `--moment`) that pulses, beside a countdown |
| Now | From the start until it ends | Disc of radius 46 filled with `--moment`; hand, pivot and dot in `--on-moment` |
| Kept | Marked done | Full ring with a check (`M42 62l12 12 24-27`, stroke 6) in place of the hand |
| Missed | Ended, not done, not re-planned | Open ring in `--muted`, hollow dot |

- Open to Held: the gap closes in 320 ms with a soft spring, then a two-note chime (659 Hz then 988 Hz, 90 ms each, quiet, made with Web Audio, no audio file) and a short vibration where the browser allows. The chime plays only after a tap and has an off switch (`rm:sound`).
- Every ring has `role="img"` and a label that says the state and the time in words.

## 9. Words

- Headline: "Reminders that make sure it happens."
- Under it: "Write it in one line and share the link. Anyone who taps it is reminded in layers and followed through until it's done. No account on either side."
- Label above the line: "NEW REMINDER". While typing: "ENTER MAKES THE LINK". Placeholder: "Demo day Fri 5pm zoom.us/j/123".
- After saving: "Held. You're set."
- Nudge switch: "Nudge me until I'm in" with "Up to 3 nudges, 10 minutes apart."
- Re-plan sheet: "Not yet? Pick when." with "We'll bring it back then, one tap from the link."
- Private switch: "Private link" with "Keeps the title and time out of link previews."
- Check alert: "<title>: did you make it?" Nudge alert: "<title> has started" with "Nudge 1 of 3. Tap to open."
- Footer everywhere: "A free tool by Zoof04 Inc. MIT licence." (The owner changed the credit from "zoof04" to "Zoof04 Inc." on 11 November 2026.)
- Style: short sentences, plain words, no hype.

## 10. Research on the /why page

Use these figures only, each with its source linked on the page:

| Claim | Source |
|---|---|
| Forgetting to do something is 50 to 80 percent of everyday memory failures | Zuber and colleagues (2021), Psychological Research, doi:10.1007/s00426-020-01357-6 |
| 8 percent of healthy young adults forgot an intended action, 24 percent with attention divided; intentions become action about half the time | Sheeran and Webb (2016), Social and Personality Psychology Compass 10(9) |
| Text reminders lifted clinic attendance from 54 to 67 percent across 21 studies; several notifications raised attendance 25 percent, one raised it 6 | Robotham and colleagues (2016), BMJ Open 6(10) |
| Three plan questions raised voter turnout 4.1 points among those reached; the plain reminder call did nothing | Nickerson and Rogers (2010), Psychological Science 21(2) |

Always add: these studies come from clinics, elections and laboratories, not from reminder links, and they do not promise a number for remmynd.

## 11. Checks before release

- `npm run check` green on Node 20, 22 and 24.
- By hand: iPhone Safari and the Home Screen app; Android Chrome and the installed app; desktop Chrome, Safari, Firefox and Edge; one in-app browser (Instagram or LinkedIn) for the `/ics` route.
- By hand, for each: make a link from one line; open it; Remind me; an alert an hour before and at the start; Done; Not yet and re-plan; a nudge; a private link; a `/new` link; a 1.x link; both themes; offline.
- Measured and written into the pull request: compressed size of app code and of the first visit, and load time on a throttled mid-range phone profile.

## 12. Not in 2.0

December: smart paste with the browser's on-device AI, the Android share target, email reminders (with a confirm step), the "my plan" line, a connector for AI assistants, an embed button, and the `/open`, `/blog` and `/about` pages. Later: a Wallet pass, native apps, and links a host can update.
