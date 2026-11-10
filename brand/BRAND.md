# remmynd brand

remmynd is a free, open-source tool by [Zoof04 Inc.](https://zoof04.com) The design follows remmynd 2.0: "Daylight" (paper, ink, amber) and "Night shift" (near-black, electric lime). The design tokens live in [docs/v2/tokens.css](../docs/v2/tokens.css); the site uses them unchanged.

## Name and logo

The remmynd name, the logo and the moment ring belong to Zoof04 Inc. They are not covered by the MIT licence that covers the code. You may use these files to write about or link to remmynd. A fork or a copy you host must use its own name and logo, and must not suggest that Zoof04 Inc. makes, runs or endorses it. Credit is "remmynd by Zoof04 Inc."

## The mark

A clock face with one hand pointing at a dot: the moment you'll be reminded. In the app the mark becomes the moment ring, a 24-hour dial of the viewer's own day with noon at the top, the night shaded, and the reminder's time as the dot. The ring closes when a reminder is held.

- Use the mark on its own only where the name already appears nearby, or where space is tight (favicons, avatars).
- Keep clear space around the mark of at least the dot's diameter.
- Don't rotate the mark, move the dot, recolour the ring, or add effects.
- The dot is amber on light backgrounds. In the logo files for dark backgrounds it is warm amber (`#FFB52E`); inside the app's Night shift theme it is electric lime.

## Logo

The mark plus the lowercase wordmark `remmynd`, set in Geist SemiBold with tight tracking and converted to outlines. Always write the name in lowercase, including at the start of a sentence.

| File | Use |
|---|---|
| `logo/remmynd-logo.svg` | Light backgrounds |
| `logo/remmynd-logo-white.svg` | Dark backgrounds |
| `logo/remmynd-logo-2048.png`, `-white-2048.png` | Where SVG isn't accepted |
| `logo/remmynd-mark.svg`, `-mark-white.svg` | Mark only |
| `logo/remmynd-wordmark.svg`, `-wordmark-white.svg` | Name only |
| `logo/remmynd-app-icon.svg`, `-app-icon-1024.png` | App icon (ink tile) |

## Colour

From the design tokens. Amber and lime are "the moment": the dot, the Now ring and the Remind me button. Never use them for body text.

| Token | Daylight | Night shift | Use |
|---|---|---|---|
| Paper | `#F5F6F7` | `#0B0C0E` | Page background |
| Card | `#FFFFFF` | `#17191D` | Tickets, rows, sheets |
| Ink | `#0E0F11` | `#F4F5F6` | Text, the ring, solid buttons |
| Muted | `#666C75` | `#A3A8B0` | Labels and secondary text |
| Hairline | `#E3E5E8` | `#2A2D33` | Borders, the perforation |
| Moment | `#F2A000` amber | `#C8F53B` lime | The dot, the Now ring, Remind me |
| On moment | `#0E0F11` | `#0B0C0E` | Text on the moment colour |

Every text and background pair meets WCAG AA in both themes; the tests check it.

## Type

- **Geist** for text and headings. Headings are SemiBold with tight tracking (around −0.04em).
- **Geist Mono** for times, dates and labels. Labels are uppercase with a little letter spacing.

Both are served from remmynd.space itself (`public/fonts/`, SIL Open Font Licence), never from another host.

## Voice

Plain, short, calm. Say what happens: "Remind me", "Held. You're set.", "Not yet? Pick when." The headline is "Reminders that make sure it happens." Lead with the facts: free, no sign-up, no tracking.

## Accounts and sizes

| File | Size | Where |
|---|---|---|
| `avatar/remmynd-avatar-1024.png` | 1024 × 1024 | GitHub organisation, X, LinkedIn, Product Hunt, Gravatar (npm) |
| `avatar/remmynd-avatar-paper-1024.png` | 1024 × 1024 | Light alternative |
| `social/github-social-preview-1280x640.png` | 1280 × 640 | GitHub repo → Settings → Social preview |
| `social/x-header-1500x500.png` | 1500 × 500 | X profile header |
| `social/linkedin-cover-1128x191.png` | 1128 × 191 | LinkedIn page cover |
| `social/producthunt-thumbnail-240.png` | 240 × 240 | Product Hunt thumbnail |
| `social/producthunt-gallery-1270x760.png` | 1270 × 760 | Product Hunt gallery |
| `../public/og.png` | 1200 × 630 | Link previews (set in the site's meta tags) |

Avatars are full-bleed squares with the mark centred inside the circle-safe area, so they work when a platform crops to a circle.

## Website icons

In `public/`: `favicon.ico` (16, 32, 48), `icon.svg`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (Android adaptive icon, mark inside the safe zone).
