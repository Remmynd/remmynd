# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-09

### Added

- remmynd.space: make a reminder link in one screen, with a live preview.
- One-tap **Remind me**: Apple Calendar on iPhone, iPad and Mac Safari; Google Calendar elsewhere. Outlook, Microsoft 365, share sheet and copy as alternatives.
- Times shown in each visitor's own time zone, with a live countdown.
- Sleep-safe option: remind at 9 AM local time when an event falls overnight.
- Remind me badges (`/badge.svg`, `/badge-dark.svg`) with HTML and Markdown snippets.
- Installable as an app (PWA), works offline once opened.
- `functions/ics.js` fallback for iPhone in-app browsers.
- `remmynd` npm package: `createLink`, `decode`, `toICS`, `googleCalendarUrl`, `outlookUrl`, badge helpers, TypeScript types.
- `npx remmynd` command-line tool.

[Unreleased]: https://github.com/Remmynd/remmynd/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Remmynd/remmynd/releases/tag/v1.0.0
