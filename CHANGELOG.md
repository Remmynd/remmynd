# Changelog

All notable changes to remmynd are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). The reminder link format is a public contract: old links keep working in every release.

How releases are made: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Changed

- Inside the iPhone app, the page no longer repeats the website's free and no-account lines: the preview of a private link says only "Reminders that make sure it happens.", and the re-plan sheet's "No account" line is left out. The website keeps its wording.
- The app code budget is now 75 KB compressed, up from 70 KB, to make room for repeating reminders in the library, which the capture bar uses on every visit. The app-only code and the repeat logic load from their own files, only when needed.

### Fixed

- Chat about this was only on a reminder's page before you tapped Remind me, so it never showed for saved reminders (every reminder in the app's Today), and the app's Chat item couldn't open it. It's now a button under the reminder stack, and the service worker's cache is renewed so devices get it.

### Added

- Your page inside the iPhone app: Get Pro opens the app's own Apple purchase sheet instead of the account sheet, and the website-only "50% off your first month" isn't shown there.
- Pro for hosts, launch day. A line in the host's own words on a launch, shown to everyone who saved it the day before, 15 minutes before and when it goes live; the day-before and last-call alerts go out from the server once per start time, so a moved launch is announced again for its new time. Two nudges per launch, an hour apart and only before it ends, each reaching every phone still holding an alert for it; Your page says how many. 50% off the first month on the website for a host whose launch reached 25 saves or whose Pro lapsed, applied at checkout through a Polar discount (`POLAR_DISCOUNT_FIRST`), and never offered without it.
- Pro for hosts, enforced on the server from the account's own Pro status. Once Pro is on offer (and not before), a free host has one live launch at a time, can't move or rename a launch after someone saved it (fixes before that, and cancelling, are always fine), reaches their first 100 followers, sees the saved count, and their pages carry a "Made with remmynd" line. Pro lifts all of that: unlimited live launches changed any time, up to 5,000 followers, saves and who showed up by day on Your page, and an accent colour of their own with no remmynd line. Hitting a limit says why and offers Pro.
- Numbers for the people who run remmynd. The server keeps daily totals of what it already handles (new accounts, sign-ins, alerts set and sent, emails, host pages, launches, follows, chats, messages, photos and voice notes, Pro checkouts), each only a name, a day and a number. A private page at `/admin` shows this week against last week, thirty days by day, and live totals: accounts, hosts, upcoming launches, follows, open chats, and Pro by trial, paid and where it was bought, with an estimated monthly revenue. It answers only to signed-in accounts whose email is in the `ADMIN_EMAILS` secret; everyone else gets the ordinary Not found page.
- Photos and voice notes in a reminder's chat. Scrambled on the device with the chat's own key, so they're stored as bytes nobody at remmynd can open, in a private bucket with no public address, and deleted with the chat. A photo is redrawn on the device first (at most 1600 px), which removes its location and camera details; a voice note is up to a minute. Sending one needs a signed-in account, 30 a day per account and 30 per chat; reading stays open to everyone with the link.
- Vanishing chat. "Chat about this" on any reminder opens a small chat for the people who hold it. Messages are scrambled on the device with a key that stays in the link after the #, so the server stores text it can't read and never learns who is talking or which reminder it's about. The chat and every message are deleted 24 hours after the reminder ends, or at once when anyone ends it for everyone. A message with a time in it gets a Remind me button. Alerts say only "New message in the chat". Up to 20 people and 500 messages; private links have a chat built in, and a shared link gets one when someone starts it.
- Follow a host. A Follow button on every host page. Followers hear the moment a launch is announced and again the moment it goes live, on any device with notifications on, and by email if they're signed in and ask for it (one email per launch, with a one-click stop link). The iPhone app shows "From people you follow" in Today and sets a local alert for each start, so going live is never missed. Hosts see how many follow them, never who; Your page shows the count and says how many were told when you publish.
- Savers follow a change. When a host moves, renames or cancels a launch, everyone who saved it follows: their reminder moves, their alerts move with it, and they're told once ("Moved: Orbit launch. Now Fri, Dec 11, 9:00 AM"). Web devices are woken at once; the iPhone app checks when it comes forward. Old shared links open at the new time and say it moved, a cancelled launch's page says so, synced accounts' copies and email reminders move on the server, and a launch's count carries over to its new time.
- Host pages. Sign in and claim a handle, and your launches get a page at `remmynd.space/@you/<launch>`: a big countdown that ticks to the second, Remind me, Add to Calendar, how many will be reminded, and a button to wherever it goes live (Product Hunt, the App Store, YouTube…) that turns into "It's live: go now" at the start. Your own page at `remmynd.space/@you` shows your next launch and the rest. Times show in each visitor's own zone, and the pages carry proper previews for chats. Make and manage them on Your page (`/host`), or from the launch kit.
- A reminder from a photo. On the website, a camera button in the bar reads a poster, invite or screenshot with the browser's own on-device AI, and the result lands in the bar to check before it's made. The button shows only where the browser can read images on the device; nothing is uploaded. Dropping a photo on the page works too.
- remmynd Pro, the plumbing: one status on the account, however it was paid. On the website the server makes a Polar checkout with the account's id on it, and Polar's signed notices (or Restore, which asks Polar directly) set the status; in the iPhone app the purchase Apple signed is checked up to Apple Root CA G3 and linked to the account, and Apple's server notifications follow renewals, cancellations and refunds. A purchase belongs to one account, nobody is sold Pro twice, the free trial is for an account's first purchase, and deleting the account ends a website purchase. Nothing is on offer until `PRO_ON` is set; before that only `PRO_TESTERS` see it.
- Your calendar: signed-in accounts get a private calendar address (`/cal/<token>.ics`) to subscribe to in Apple, Google or Outlook Calendar. It holds the reminders you hold, with shared links only, repeats as repeating events in local time, and refreshes every few hours. New address replaces it; Turn off removes it.
- Email in: forward a booking or an invite to your private `in-<token>@remmynd.space` address and it becomes a reminder in your account, read from the subject or the first lines. A reply says what was added, or why nothing was. The email is not stored.
- My links shows how many will be reminded, for the links whose host turned the count on.
- Inside the iPhone app only: the page can preview a reminder link, hold it with its alerts and its count (as Remind me does), and list the links made on this device with their counts, for the app's Save sheet and Your launches.
- The launch countdown: a card for a landing page (`/embed/<link>?size=launch`) with days, hours, minutes and seconds that tick, how many will be reminded when the host turned the count on, Remind me, and Google, Apple and Outlook calendars. It fits a phone at 400 pixels high.
- The launch kit (`/launch`): one line in, a launch countdown out, previewed from the real link, with the countdown, the small card, the live badge, Markdown, the Discord line and a QR code ready to copy. The link is made on the device and kept in My links. For hosts leads to it.
- Repeating reminders. "Gym every weekday 7am", "Pay rent monthly on the 1st 9am", "Mum's birthday every year Mar 3", "every Tue and Thu", "every 2 weeks", "daily" and "every evening" all read as repeats. The link carries the rule in a new optional key, `r` (`d`, `3d`, `w`, `2w`, `w:1,2,3,4,5`, `m`, `y`); older readers see a one-off, as the format promises. Done keeps that time and moves the reminder on to the next; alerts cover the next 7 times, up to 14 days ahead, and are topped up whenever remmynd opens. Calendar files and Google Calendar links repeat too, in local time, so they never drift with daylight saving. The library adds `describeRepeat`, `repeatRRule` and `nextOccurrence`; `parse` returns `repeat`.
- The connector for AI assistants reads and makes repeating reminders, and every answer says how it repeats. The docs say how to add it to an assistant.
- Inside the iPhone app only, the calls the native Today screen uses moved to `native.js`, which the website never downloads.
- remmynd for iPhone feels like an app: inside it (html.native) the page hides the website's hero, Try one, facts, footer, menu and links to website pages, and uses the system font. The website is unchanged.
- Passkeys in the iPhone app: remmynd.space serves Apple's app-site file (`/.well-known/apple-app-site-association`) naming the app for webcredentials, and for applinks, so shared reminder links and `/new` links open in the app when it's installed.
- Talk in the iPhone app uses the phone's own speech recognizer through the bridge; what it hears lands in the bar, and a line with a time becomes the link.
- "Video call for this" on a held reminder in the iPhone app opens the app's own Calls screen, filled in.

### Fixed

- A slash date that could go either way follows the device: "12/5" is December 5 in the US and Canada, and 12 May where dates are written day first. Before, it was always read day first.

### Added

- Groundwork for remmynd for iPhone: inside the app (it sets `window.__rmNative` and listens on `webkit.messageHandlers.remmynd`), alerts are the phone's own notifications. push.js hands each alert, with the same words sw.js uses, to the app instead of the push server; Done and Not yet on an alert open the reminder with `?act=`; the app icon's badge and the Home Screen widget's "next reminder" come from the same place. The page counts as installed there, so no Home Screen prompts. On the web nothing changes.

### Added

- Make it a video call, on the Short call row when the line has a time and no place yet: it opens remmynd Calls with the title, time and length filled in. Calls makes a room on Daily that opens five minutes early and closes at the end, then hands the call link back here as the reminder's place, so "Open the link" on the ticket joins the call. A plain link: this page still asks no other host for anything.

## [2.3.0] - 2026-11-14

### Added

- Short call: write the length the way you'd say it, "Call with Sam Tue 4pm 5 min", and the reminder is 5 minutes long, so the "did you make it?" check comes at 4:05. When the line has a meeting link (Meet, Zoom, Teams, Whereby, Jitsi, Webex, Discord and the like) or reads like a call, a Short call row under the chips offers 2, 5, 8 and 10 minutes; tap one to set it, tap it again to clear it. The length shows on the ticket as it always has.
- Import a calendar file: drop an .ics file on the page, pick one from the menu, or ask for it in Search and commands, and a sheet lists the file's upcoming events, read on your device. Hold one, or Hold all, and each becomes a private reminder in Coming up and My links, with the same alerts as Remind me. Whole-day events are set for 9:00, a repeating event is held once at its next time, cancelled and finished events are left out, and a meeting link in the event becomes the place. Nothing is uploaded; the module never makes a request. Export the file from Google Calendar, Apple Calendar or Outlook first; a live feed isn't read.

### Changed

- The bar reads a bare length too: "5 min", "10 mins", "2 hours" and "1.5 hours" set how long, with or without "for". "5 min late" stays in the title, and so does "8m".

## [2.2.0] - 2026-11-14

### Added

- The live badge: a picture of your reminder that counts down, for READMEs, forums and any page that takes an image. It's `/b/` and your shared link's code, then `.svg`. It ticks with CSS alone and no script, glows in the last hour, says Live now at the start and Ended after the end, even if the page stays open. It follows the reader's light or dark setting (`?theme=` pins one), and `?size=mini` gives a one-line version. Like a shared link, it's drawn from the address and nothing is stored or logged. Private links have no live badge.
- A line for Discord, `<title> starts <t:UNIX:R> <link>`, which Discord shows as a countdown in each reader's own zone.
- In the app, The live badge under Share it shows your badge with Copy HTML, Copy Markdown and Copy for Discord. For hosts shows it live with the snippets.
- Library: `liveBadgeURL`, `liveBadgeHTML`, `liveBadgeMarkdown` and `discordLine`. Command line: `--live-badge html|md`, `--mini` and `--discord`.
- The reminder card counts down. Its first line says "in 12 days", then "1d 04:12:09" inside 48 hours, ticking every second, then "Live now" and "Ended". The Worker writes the first value, so the card is right before its script runs. The badge and the card share one clock.
- `?screen=1` on the reminder card: a layout for big screens, streams and the last slide of a talk, with the countdown in large type and a QR code of the link, "Scan to get reminded", in place of the button.
- Talk: tap the mic in the bar, say the reminder, and pause. What you say goes into the bar as you speak, so the live preview follows along. If you said a time, like "Friday 5 pm" or "in 20 minutes", the link is made, and the ready screen shows what it heard with a Fix button. A day alone, like "Dentist tomorrow", stays in the bar until you say a time or press Enter. Tap the mic again to finish early; Esc or Cancel stops without making anything. Where the browser can recognise speech on the device, it does. The mic shows only where the browser can listen: not in Firefox, and not in the iPhone Home Screen app, where the keyboard's own mic works instead.
- `/new?q=<line>` opens the app with one line in the bar, and makes the link when the line has a time in it.
- A Talk shortcut on the installed app's icon (`/?talk=1`): it opens the bar with the mic marked.
- The Story card: Story under Share it copies your link and draws a 9:16 picture of the reminder on your device, ready for Instagram, WhatsApp Status and other Stories. It shows the ring, the title, the date and time with the time zone, and "Tap the link to get reminded", and leaves the lower third free. The sheet says how to add Instagram's Link sticker (paste the copied link) and, if you like, its Countdown sticker. Share the card opens the share sheet where the browser can share pictures; elsewhere Save picture saves it. Snapchat gets a plain link to its own share page. Nothing is uploaded.
- The count, the host's choice: "Show how many are in" under Private link adds a public count to a shared link (`c: 1`). From 10, the reminder, the card and the live badge show "128 in" ("1.2k in" from 1,000, never rounded up), and the ring wears an outer ring from 10, a second from 100 and a third from 1,000. Each person who taps Remind me adds one, once per device, and sees their place, "#129", with "First ten" for the first ten; it's on their own Story card too. The server keeps one number per reminder and deletes it 30 days after the event. Taps count only from remmynd.space, never after the end, at most 600 a minute per reminder and 20 a minute from one network. Library: `count` in `createLink()` and `decode()`, `countLabel`, `countRings` and `placeLabel`. Command line: `--count`. `/new`: `count=1`.
- Last call, for links you made: from 24 hours before the start, the reminder and its row in My links offer "Starts tomorrow. Post a card?", then "Starts today." on the day and "Starts in an hour." in the last hour. It opens the Story sheet with a card that says "Last call" above the title, with the date and time, never "tomorrow", because a Story stays up for a day. No new notifications.
- Share your year: tap the kept line on Coming up for a card that says, for example, "Kept 41 of 47 in 2026", counted from this device's own reminders. No streaks.
- Two buttons on a reminder you hold, under the reminder stack: Add to story makes your own card, "I'm in." with the ring held, and Pass it on opens the share sheet with the title and the link (or copies the link where there's no share sheet). A private link stays private: it's the one passed on.

### Changed

- The site now lets itself use the microphone (`Permissions-Policy: microphone=(self)`), for Talk. The reminder card and the live badge still don't.
- "Copied" beside a new link shows only once the link really is copied. When a link is made without a tap on Copy (Talk, `/new?q=`) and the browser won't copy without one, the app says nothing and leaves Copy link to you.
- The bar reads lines the way people say them. "remind me to", "set a reminder for" and similar lead-ins are dropped at the start of a line. It also reads "5 o'clock", "half past six", "quarter past 4", "quarter to 5" and "five pm", and a part of the day sets am or pm, so "5 o'clock in the evening" is 17:00. "movie night … 8 p.m." keeps "night" in the title. All 26 spoken lines in the Talk plan now come out right, up from 18. This is groundwork for Talk, and it helps typing too.
- The app code budget is now 70 KB compressed, up from 60 KB, to make room for Talk, the live badge and the count. Each of those loads from its own file on first use; the budget covers only what a first visit downloads. The whole first visit, fonts included, stays under 150 KB. The size test, the principles, the spec, CONTRIBUTING and the For hosts and Open numbers pages all say 70 KB.

### Fixed

- Removing a reminder and tapping Remind me again within 5 seconds, instead of Undo, no longer deletes it anyway. The removal is called off, so the reminder, its alerts and its stack stay.

## [2.1.0] - 2026-11-11

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
- About (/about), open numbers (/open) and a blog (/blog), with a first post on what's new since 2.0. Open numbers shows live stars and downloads, the test count, the size budgets, dependencies and trackers, each with how a test or check keeps it true, and what the server keeps. The footer's About now leads to remmynd's own page, next to Blog and Open numbers.
- Smart paste: paste a long email or invitation, or an image of a poster, into the bar, and where your browser has its own on-device AI (desktop Chrome 148 and later, on capable hardware) remmynd offers to read it. It runs on your device and nothing is sent anywhere; what it finds becomes one line in the bar, with the live preview, and nothing is made until you press Enter. A time written in another zone is moved into yours.
- A reminder card for your own page: an iframe of remmynd.space/embed/<link> shows the moment ring, the title, the time in each visitor's zone and a Remind me button. `embedHTML(link)` and `embedURL(link)` in the library and `--embed` on the command line write the snippet; For hosts and the docs show it. Private links can't be embedded.
- "My plan" on a held reminder: say when and where you'll do it ("At my desk, 5 minutes early"). Phone alerts repeat it, the reminder shows it when it's time, and so do the reminder emails if you're signed in. It stays with the reminder on your device (and in your account when signed in), never in the link.
- A connector for AI assistants at remmynd.space/mcp: assistants that take MCP connectors can make a reminder link from a title and time or from one line ("Dentist Tue 4pm"), and read a link back. It speaks MCP 2026-07-28 and earlier versions back to 2025-03-26, needs no account or key, and stores and logs nothing.
- Share into remmynd from any Android app once it's installed: the shared title, text and link land in the bar as one line, with the live preview, ready for Enter.
- "Kept 6 of 7 this month" beside the Coming up tabs: of the reminders that came due this month, how many you marked done. It only shows once you've kept one.

### Changed

- The roadmap's Now lane lists everything live, including what shipped after 2.0; email reminders moved there from Next.
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

[Unreleased]: https://github.com/Remmynd/remmynd/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/Remmynd/remmynd/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/Remmynd/remmynd/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/Remmynd/remmynd/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/Remmynd/remmynd/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/Remmynd/remmynd/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Remmynd/remmynd/releases/tag/v1.0.0
