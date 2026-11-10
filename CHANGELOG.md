# Changelog

All notable changes to remmynd are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). The reminder link format is a public contract: old links keep working in every release.

How releases are made: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

- Automatic deploys: every push to `main` deploys remmynd.space through Cloudflare Workers Builds. A scheduled live check confirms the site's routes every six hours.
- Release pipeline: merging a version bump tags the release, publishes GitHub release notes from this changelog and publishes the npm package with provenance. `npm run release -- <patch|minor|major>` prepares the bump.
- Documentation: [principles](docs/PRINCIPLES.md), [architecture](docs/ARCHITECTURE.md) with diagrams, and a [release and operations runbook](docs/RELEASING.md).
- Push notifications: Notify me on any reminder sends an alert 1 hour before and when it starts. Snooze and Open buttons on Android and desktop, app badge on the Home Screen icon, and a Coming up list in the app. Event details stay on the device; the server keeps only anonymous ping times and deletes them once sent.
- `npm run push:setup`: creates the D1 database, VAPID keys and Worker secret in one command.
- Install helper: one-tap Install on Android and desktop Chrome or Edge; step-by-step guide with a pointer for iPhone (iOS 26 and earlier layouts); open-in-browser help inside Instagram, LinkedIn and similar apps. Offered once, right after someone saves a reminder or copies a link.
- App screenshots and description in the manifest for Android's richer install dialog.

### Changed

- Principles for 2.0: shared and private links, free for everyone who makes or saves a reminder, notifications with permission, a 60 KB code budget, and the aim "Reminders that make sure it happens." The 2.0 build spec and design reference are in [docs/v2](docs/v2/SPEC.md).
- Phone alerts are switched on at remmynd.space: the D1 database, the every-minute cron and the public push key are set in `wrangler.toml`.
- Privacy wording across the site and docs: "Free, no sign-up, no tracking." Principles, architecture and the release runbook now describe how phone alerts work and what the server keeps.
- Runs on Cloudflare Workers with static assets instead of Pages, served at remmynd.space.
- `www.remmynd.space` redirects to the bare domain on every path, including the home page.
- Each static file sends exactly one `Cache-Control` header: the service worker always revalidates, icons cache for a year, badges for a day.
- Per-version preview URLs are turned off.
- CI and release workflows use `actions/checkout` and `actions/setup-node` v7. CI also builds the Worker on every pull request.

### Fixed

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

[Unreleased]: https://github.com/Remmynd/remmynd/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Remmynd/remmynd/releases/tag/v1.0.0
