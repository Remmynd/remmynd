# Changelog

All notable changes to remmynd are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). The reminder link format is a public contract: old links keep working in every release.

How releases are made: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

- Optional sign-in, to keep reminders on every device and get them by email: a passkey (Face ID, Touch ID or the screen lock), or a 6-digit code by email. No password. Open it from the menu, or from the Email row of a held reminder.
- Sync: reminders and links made or held on one device appear on the others. Private links never leave the device.
- Email reminders through Resend, 1 hour before and when it starts, with a one-click stop link in every email. Turn them off in your account.
- Your account: email reminders on or off, passkeys, sign out, and delete the account and everything in it.
- Remind me right after making a reminder: the ready screen leads with it, so one tap sends your own reminder to your calendar, turns on alerts and holds it. Sharing tools follow under "Share it".
- Delete, with Undo: every row in Coming up and My links has a ⋯ button (and swipe) for its actions, now including Delete; a held reminder has "Remove this reminder". The delete waits 5 seconds behind Undo, and a removed reminder's alerts are cancelled.
- Edit a reminder you made (from the ready screen or My links): its parts go back into the line, and making it again replaces the old link.
- A Test button in the Notification row shows a test alert, so you can see and hear how reminders arrive.
- The remmynd chime and a buzz when a held reminder starts while the page is open.
- Back on a reminder opened from inside the app. The Delete key removes the row in focus.
- Search and commands: press Ctrl K (⌘K on a Mac), or open it from the menu, to find any reminder or link, go to Coming up or My links, switch theme or sound, sign in, install, or open a page. Type something that matches nothing and Enter makes it a new reminder.
- A floating countdown on a computer: on a held reminder, "Float it above my windows" opens a small window that stays on top of your other windows and counts down to the start (Chrome and Edge; the row isn't shown where the browser can't do it). It closes itself when you mark the reminder done, drop it or remove it, and follows a re-planned time.
- "Kept 6 of 7 this month" beside the Coming up tabs: of the reminders that came due this month, how many you marked done. It only shows once you've kept one.

### Changed

- "Free, no sign-up, no tracking." is now "Free, no account needed, no tracking.", and the privacy page explains exactly what signing in keeps and who delivers the emails.
- "Remind me at 9 AM instead" is now an offer, off by default, and only for a night-time reminder at least 12 hours away. A reminder set at midnight for two minutes later goes off at the time you set.
- Row actions appear as a row of buttons under the reminder instead of sliding it aside, so titles stay readable on small screens.
- The badge maker moved from the app's home to For hosts.

### Fixed

- Account sheet: the Remove buttons for passkeys no longer stretch across the row and cover the passkey's name, long names end with an ellipsis, and the parts of the sheet are evenly spaced.
- Toasts use one line where it fits, instead of wrapping into a narrow pill.
- The Soon label no longer stretches across a row and hides its title.

## [2.0.1] - 2026-11-11

remmynd 2.0.1: security and polish. The library reads links, `/new` addresses and pasted invitations without slowing down on crafted input, credit is Zoof04 Inc. everywhere, and the site sends a strict security policy. Links and the library's functions are unchanged.

### Changed

- Credit is Zoof04 Inc. everywhere: the footer of every page ("A free tool by Zoof04 Inc. MIT licence." and "© 2026 Zoof04 Inc."), LICENSE, package.json, README, the brand guide and the press page. The remmynd name, logo and moment ring belong to Zoof04 Inc. and are not covered by the MIT licence.
- New 2.0 brand images: the link preview, the GitHub social preview, the X, LinkedIn and Product Hunt banners, and the install screenshots. The tagline everywhere is "Reminders that make sure it happens."
- The brand guide describes the 2.0 design: both themes' colours, the moment ring and self-hosted fonts.

### Security

- Code scanning (CodeQL) runs on every change. Its first scan led to these fixes: reading links, `/new` addresses and pasted invitations no longer slows down on crafted input (regular expressions that could backtrack are replaced with plain string work); the page looks up named examples among its own keys only, so `#constructor` is just an unknown link; and the no-third-parties guard now also catches `</script >`, upper-case tags and comments hidden inside comments.
- Pipelines: GitHub Actions are pinned to exact commits (Dependabot keeps them current), checkout no longer leaves the token in the workspace, and CI also runs for the merge queue. The live check now fails if a page loads anything from another host or loses its security headers, which catches settings changed in the Cloudflare dashboard.
- A strict Content-Security-Policy: scripts, styles, fonts and requests from remmynd.space only, with the one inline theme line allowed by its hash. Browsers now refuse anything injected from another host.
- Strict-Transport-Security, `/.well-known/security.txt`, and Dependabot for the GitHub Actions.

## [2.0.0] - 2026-11-11

remmynd 2.0: reminders that make sure it happens. Write a reminder in one line, share the link, and anyone who taps it is reminded in layers (calendar, then phone alerts) and followed through until it's done. Every 1.x link keeps working.

### Added

- Accessibility checks in the tests: every text and background colour pair in both themes meets WCAG AA, controls are at least 44 px, sheets are named modal dialogs, headings never skip a level, and motion stops when reduced motion is asked for.
- The website: [Why](https://remmynd.space/why) (the research on forgetting and follow-through, each figure with its source), [For hosts](https://remmynd.space/hosts) (badges, a QR code, the chat preview and `/new`), [Docs](https://remmynd.space/docs), [Install](https://remmynd.space/install), [Roadmap](https://remmynd.space/roadmap), [Privacy](https://remmynd.space/privacy), [Press](https://remmynd.space/press) and [Changelog](https://remmynd.space/changelog). Every page shares one header, footer and menu, and a test fails if they drift apart or if a page shows a figure that can't be checked.
- `/changelog`: this file, rendered by the Worker inside the website's own page.
- `/stats`: GitHub stars and npm downloads for the For hosts page, fetched by the Worker and cached for an hour, so the page only ever talks to remmynd.space. A number that can't be fetched is left out.
- Menu: Why, For hosts, Docs, Roadmap, GitHub, the theme switch and, in the app, Sound and Install app.
- `llms.txt`: how an assistant can make a reminder from a web address.
- QR code for any link: "Scan to send it to your phone", on the link-ready screen and under More ways on every ticket, with a PNG download. Drawn on the device by `qr.js` (written for remmynd, about 3.5 KB compressed), loaded only when asked for.
- How it looks in chats: the link-ready screen shows the preview card a chat app will show, and the Private link switch shows what it hides.
- `describeWhen()` in the library: a reminder's time as link previews print it ("Fri 13 Nov, 5:00 PM IST"), shared by the Worker and the page.
- Lists: Coming up (reminders held on this device) and My links (links made on it), at `/#coming-up` and `/#links`, grouped Today, This week, Later and Kept. Swipe a row left for Re-plan and Done; on a computer J and K move, D marks done, S re-plans and Enter opens, with the ticket shown beside the list. Empty lists say what to do next.
- Follow through: from the start, a held reminder shows Open the link (or Directions for a place), Not yet and Done. "We ask once whether you made it. Then we stop."
- Not yet opens "Not yet? Pick when.": in 10 minutes, tonight at 8:00 PM (until 7:00 PM), tomorrow at 9:00 AM, Monday at 9:00 AM, pick a time, or drop it. It comes back once at that time, one tap from the link.
- New alerts: one "did you make it?" check when the event ends (start plus its length, or 30 minutes), with Done and Not yet where the phone shows buttons, and, with the nudge switch on, nudges 10, 20 and 30 minutes after the start ("Nudge 1 of 3. Tap to open.") that stop once you open the link, tap Done, re-plan or drop it. Each is one more anonymous ping; unused ones are cancelled.
- Kept and Missed: Done turns the ring into a check; a reminder that ended without Done shows Missed.
- The reminder stack: one tap on Remind me sends the event to your calendar as before, turns on notifications where this device allows them, and holds the reminder. The ticket then shows "Held. You're set." and the stack: Calendar ("Sent to Apple Calendar. Confirm there."), Notification, a muted Email row (coming in December) and "Nudge me until I'm in", off by default. Google, Apple, Outlook, Office 365, Reminders & Notes and Copy are under "More ways to be reminded".
- The moment ring (`ring.js`): a 24-hour dial of your own day, noon at the top, with the night shaded and the reminder's time as the dot. It shows whether a reminder is open, held, starting within the hour (with a countdown), happening now or missed, and says so to screen readers.
- New ticket: the ring beside the time, the host, title, notes and place, then the host's time and the length below the perforation. Remind me (or any calendar option) holds the reminder on this device: the ring closes, a quiet two-note chime plays and the phone buzzes. Sound can be switched off in the footer.
- Two panes from 960 px: the maker on the left, the ticket on the right. The line becomes the ticket with a view transition where the browser supports it.
- One-line capture: write a reminder in one line ("Demo day Fri 5pm zoom.us/j/123") or paste an invitation. The ticket preview updates as you type, What, When and Where chips edit each part (When opens the device's own picker), and Enter makes the link, copies it and keeps it in this device's list of links.
- New home: "Reminders that make sure it happens.", three "Try one" examples worked out from today, and the New reminder bar docked at the bottom.
- `parse(text, { now, timeZone })` in the library: today, tonight, tomorrow, weekdays, "next Friday", "13 Nov", "13/11", "1st", ISO dates, "5pm", "17:00", noon, midnight, "in 2 hours", "for 30 min", time ranges, web addresses and a trailing "at <place>".
- `db.js`: on-device storage version 2 with `alerts`, `reminders` and `links`, shared by the page and the service worker. Existing alerts become reminders on upgrade.
- Shared links: `remmynd.space/r/…` lets chat apps show the title and time in a preview card. The Worker reads the link only to fill those tags. Nothing is stored or logged, and the page is never cached.
- Private link switch: "Keeps the title and time out of link previews." It makes the `/#…` form, which never reaches a server. Every 1.x link keeps working.
- `remmynd.space/new?t=…&at=…&tz=…`: write a reminder into the address from a script, a spreadsheet or an AI assistant. An exact time redirects to the shared link; a time without a zone is read in the visitor's own zone.
- Host time: links carry the host's time zone (`z`), and the ticket shows the host's own clock when it differs from yours.
- Library: `toPath()`, `fromQuery()`, a `private` option on `createLink()` and the calendar helpers, and `timeZone` on decoded reminders. CLI: `--private`.
- Guard tests: nothing in `public/` loads from another host, app code stays under 60 KB compressed and the first visit under 150 KB, `public/remmynd.js` stays an exact copy of the library, and Workers observability stays off.
- `public/remmynd.js`: the library, served for the 2.0 app to import.
- Theme switch in the footer: Auto follows the system, or pick Light or Dark. The choice stays on the device (`rm:theme`) and the browser bar colour follows it.
- Automatic deploys: every push to `main` deploys remmynd.space through Cloudflare Workers Builds. A scheduled live check confirms the site's routes every six hours.
- Release pipeline: merging a version bump tags the release, publishes GitHub release notes from this changelog and publishes the npm package with provenance. `npm run release -- <patch|minor|major>` prepares the bump.
- Documentation: [principles](docs/PRINCIPLES.md), [architecture](docs/ARCHITECTURE.md) with diagrams, and a [release and operations runbook](docs/RELEASING.md).
- Push notifications: Notify me on any reminder sends an alert 1 hour before and when it starts. Snooze and Open buttons on Android and desktop, app badge on the Home Screen icon, and a Coming up list in the app. Event details stay on the device; the server keeps only anonymous ping times and deletes them once sent.
- `npm run push:setup`: creates the D1 database, VAPID keys and Worker secret in one command.
- Install helper: one-tap Install on Android and desktop Chrome or Edge; step-by-step guide with a pointer for iPhone (iOS 26 and earlier layouts); open-in-browser help inside Instagram, LinkedIn and similar apps. Offered once, right after someone saves a reminder or copies a link.
- App screenshots and description in the manifest for Android's richer install dialog.

### Changed

- One footer on the app and every page: Product, Developers and Company links, "A free tool by zoof04. MIT licence." and the theme switch. The Sound switch and Install app moved into the menu.
- The 404 page uses the website's header and footer.
- Website pages are served without a trailing slash (`/why`; `/why/` redirects). The sitemap lists every page.
- The live check also covers `/why`, `/changelog`, `/stats`, a shared `/r/` link and a `/new` redirect.
- `npm run release` copies the library to `public/remmynd.js` too, so the site and the package stay identical.
- `npm test` loads `scripts/text-loader.mjs`, so the tests read `CHANGELOG.md` the way the Worker bundles it.
- The Remind me badge carries the moment ring, in the 2.0 colours (amber on light, lime on dark). Same addresses: `badge.svg` and `badge-dark.svg`.
- The Coming up card on the home page is replaced by the Coming up list, which reads the reminders this device holds.
- Notify me is no longer a separate switch: Remind me turns notifications on, and the stack's Notification row shows whether they are on, blocked, or need remmynd on the Home Screen (iPhone), with Turn on and off.
- The days, hours, minutes and seconds countdown on the ticket is replaced by the ring; a countdown appears beside it in the last hour.
- The app's code moved from `index.html` into `app.js`, an ES module that imports the library. The old form (what, when, where, notes, host, length, time zone) is replaced by the one-line capture; links carry the device's time zone.
- The service worker no longer stores the large install icons up front; phones fetch them when the app is installed. The first visit drops from about 145 KB to 114 KB.
- `createLink()` and `npx remmynd` make shared `/r/` links by default; `decode()` reads both forms.
- The page loads its files from root paths so it works at `/r/…`, and the service worker caches only the plain page, never a `/r/` page.
- `wrangler.toml` turns Workers observability off explicitly, so Cloudflare keeps no request logs.
- New look on the 2.0 design tokens: "Daylight" (paper, ink, amber) and "Night shift" (near-black, electric lime). Styles moved from `index.html` to `public/app.css`, and Remind me uses the moment colour.
- Geist and Geist Mono are served from remmynd.space (`public/fonts/`, SIL Open Font Licence). The page no longer loads Google Fonts, so it makes no requests to other hosts for type.
- Principles for 2.0: shared and private links, free for everyone who makes or saves a reminder, notifications with permission, a 60 KB code budget, and the aim "Reminders that make sure it happens." The 2.0 build spec and design reference are in [docs/v2](docs/v2/SPEC.md).
- Phone alerts are switched on at remmynd.space: the D1 database, the every-minute cron and the public push key are set in `wrangler.toml`.
- Privacy wording across the site and docs: "Free, no sign-up, no tracking." Principles, architecture and the release runbook now describe how phone alerts work and what the server keeps.
- Runs on Cloudflare Workers with static assets instead of Pages, served at remmynd.space.
- `www.remmynd.space` redirects to the bare domain on every path, including the home page.
- Each static file sends exactly one `Cache-Control` header: the service worker always revalidates, icons cache for a year, badges for a day.
- Per-version preview URLs are turned off.
- CI and release workflows use `actions/checkout` and `actions/setup-node` v7. CI also builds the Worker on every pull request.

### Fixed

- A place written as a web address without `https://` in a `/new` link (`l=zoom.us/j/123`) is now a link, so the ticket shows Open the link rather than Directions. Older links written that way open as links too.
- The theme switch's unselected buttons were below WCAG AA contrast in the light theme.
- Tab stays inside an open sheet, and focus goes back to where it was when the sheet closes.
- Segmented buttons, list tabs, the ticket's place link, Copy buttons and short menu and footer links are at least 44 px to tap.
- Card headings on For hosts and Install no longer skip a level.
- Code blocks keep their edge in the dark theme.
- Old zone names some browsers still report show today's city: Kolkata, not Calcutta.
- Branded 404 page for unknown paths.

## [1.0.0] - 2026-11-09

### Added

- remmynd.space: make a reminder link in one screen, with a live preview.
- One-tap **Remind me**: Apple Calendar on iPhone, iPad and Mac Safari; Google Calendar elsewhere. Outlook, Microsoft 365, share sheet and copy as alternatives.
- Times shown in each visitor's own time zone, with a live countdown.
- Sleep-safe option: remind at 9 AM local time when an event falls overnight.
- Remind me badges (`/badge.svg`, `/badge-dark.svg`) with HTML and Markdown snippets.
- Installable as an app (PWA), works offline once opened.
- `/ics` Worker fallback for iPhone in-app browsers.
- `remmynd` npm package: `createLink`, `decode`, `toICS`, `googleCalendarUrl`, `outlookUrl`, badge helpers, TypeScript types.
- `npx remmynd` command-line tool.
- Brand kit in `brand/`: logo, mark, wordmark, avatars, social banners and a brand guide.
- Favicon set, maskable app icon and link-preview image.

[Unreleased]: https://github.com/Remmynd/remmynd/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/Remmynd/remmynd/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Remmynd/remmynd/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Remmynd/remmynd/releases/tag/v1.0.0
