<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../brand/logo/remmynd-mark-white.svg">
    <img src="../brand/logo/remmynd-mark.svg" height="48" alt="">
  </picture>
</p>

# Principles

remmynd exists because saving an event to your calendar should take one tap, and sharing one should take one link. It is the smallest thing that works. These principles decide what goes in and what stays out.

## 1. The link is the product

A reminder is just a link. Everything about it (what, when, where, who) lives in the URL after the `#`. Browsers never send that part to a server, so there is no database to run, breach or shut down. A link made today will open in ten years on any copy of remmynd.

**In practice:** the link format is a public contract. New fields are optional, old links keep working in every release, and the site, the npm package and the Worker are tested to produce identical links.

## 2. Free, no sign-up, nothing stored

These three facts lead everything we write about remmynd, and none of them is a phase.

- **Free** for everyone. No "pro" tier, no upgrade buttons, no limits.
- **No sign-up**, for the person making the link or the people tapping it.
- **Nothing stored.** No accounts, cookies, analytics or tracking. The one server route, `/ics`, builds a calendar file in memory and forgets it.

## 3. Honest buttons

Every button says exactly what it does, and none promises what the phone won't allow. A website can't add an event silently or schedule a phone notification on its own, so remmynd uses the calendar's own confirm tap and alerts, and says so.

## 4. Small on purpose

- One page, one file, well under 50 KB.
- Zero runtime dependencies in the npm package.
- One tiny Worker route, used only where browsers fall short (iPhone in-app browsers).

If a feature needs an account, a database or a third-party script, it belongs in a different product.

## 5. Calm, plain language

Short sentences. Say what happens: "Remind me", "Copy link", "Saved". No hype ("revolutionary", "game-changing", "AI-powered") and no promises about attendance. Date-and-time reminders help people show up; they don't guarantee it.

## 6. Open by default

MIT licensed, built in public, easy to self-host. Anyone can read how a link works, run their own copy, or put a Remind me badge on their site without asking.

## What remmynd deliberately doesn't do

| Not doing | Why |
|---|---|
| Accounts, dashboards, saved lists on a server | Breaks "nothing stored" |
| Analytics or click tracking | Breaks "nothing stored" |
| RSVPs, guest lists, recurring events | Needs accounts or invites abuse; scheduling tools already do this well |
| Emailing anyone a reminder from an open form | Spam magnet |
| Updating an event after it's saved | Calendars don't allow it from a link; make a new link instead |

## How we decide

When a change is proposed, we ask, in order:

1. Does it keep every existing link working?
2. Does it keep remmynd free, sign-up free and storage free?
3. Is it the smallest change that solves the problem?
4. Would a first-time visitor understand it without help?

A "no" to any of these ends the discussion.

---

remmynd is built and maintained by [zoof04](https://zoof04.com).
