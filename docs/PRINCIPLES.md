<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../brand/logo/remmynd-mark-white.svg">
    <img src="../brand/logo/remmynd-mark.svg" height="48" alt="">
  </picture>
</p>

# Principles

remmynd exists because saving an event to your calendar should take one tap, and sharing one should take one link. It is the smallest thing that works. These principles decide what goes in and what stays out.

## 1. The link is the product

A reminder is just a link. Everything about it (what, when, where, who) lives in the URL after the `#`. Browsers never send that part to a server, so no reminder sits in a database to breach or lose. A link made today will open in ten years on any copy of remmynd.

**In practice:** the link format is a public contract. New fields are optional, old links keep working in every release, and the site, the npm package and the Worker are tested to produce identical links.

## 2. Free, no sign-up, no tracking

These three facts lead everything we write about remmynd, and none of them is a phase.

- **Free** for everyone. No "pro" tier, no upgrade buttons, no limits.
- **No sign-up**, for the person making the link or the people tapping it.
- **No tracking.** No accounts, cookies or analytics. Your reminder lives in the link and on your device. For phone alerts we keep only an anonymous ping time, deleted once it's sent. The `/ics` route builds a calendar file in memory and forgets it.

## 3. Honest buttons

Every button says exactly what it does, and none promises what the phone won't allow. A website can't add an event silently, so remmynd uses the calendar's own confirm tap and says so. Phone alerts are sent only after the person turns on Notify me and the browser asks for permission; on iPhone they need remmynd on the Home Screen, and the page says that too.

## 4. Small on purpose

- One page, one file, well under 50 KB.
- Zero runtime dependencies in the npm package.
- A small Worker, used only where browsers fall short: calendar files for iPhone in-app browsers, and the timing for phone alerts.

If a feature needs an account, personal data on a server or a third-party script, it belongs in a different product.

## 5. Calm, plain language

Short sentences. Say what happens: "Remind me", "Copy link", "Saved". No hype ("revolutionary", "game-changing", "AI-powered") and no promises about attendance. Date-and-time reminders help people show up; they don't guarantee it.

## 6. Open by default

MIT licensed, built in public, easy to self-host. Anyone can read how a link works, run their own copy, or put a Remind me badge on their site without asking.

## What remmynd deliberately doesn't do

| Not doing | Why |
|---|---|
| Accounts, dashboards, saved lists on a server | Breaks "no sign-up" and puts personal data on a server |
| Analytics or click tracking | Breaks "no tracking" |
| RSVPs, guest lists, recurring events | Needs accounts or invites abuse; scheduling tools already do this well |
| Emailing anyone a reminder from an open form | Spam magnet |
| Updating an event after it's saved | Calendars don't allow it from a link; make a new link instead |

## How we decide

When a change is proposed, we ask, in order:

1. Does it keep every existing link working?
2. Does it keep remmynd free, sign-up free and tracking free?
3. Is it the smallest change that solves the problem?
4. Would a first-time visitor understand it without help?

A "no" to any of these ends the discussion.

---

remmynd is built and maintained by [zoof04](https://zoof04.com).
