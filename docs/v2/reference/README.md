# Design reference for remmynd 2.0

Static mock-ups of every designed screen. Open any file in a browser. Copy structure, sizes, spacing, icon paths and wording from them. Do not ship these files.

| File | Screen |
|---|---|
| `01-home.html` | Phone: home on a first visit |
| `02-one-line-in.html` | Phone: typing one line, with the live preview |
| `03-link-ready.html` | Phone: the link is ready to share |
| `04-ticket-open.html` | Phone: a reminder before it is saved |
| `05-ticket-held.html` | Phone: saved, with the reminder stack |
| `06-ticket-now.html` | Phone: at the start time |
| `07-replan.html` | Phone: the "Not yet" sheet |
| `08-coming-up.html` | Phone: Coming up and My links |
| `desktop-app.html` | Desktop: two panes |
| `web-home.html` | Website: home |
| `web-why.html` | Website: why, with the research |
| `web-roadmap.html` | Website: roadmap and changelog |
| `system.html` | The six ring states, colours, type and controls |
| `colours.html` | The colour directions that were considered. Number 1 is the light theme and number 2 is the dark theme. |

Notes:

- The mock-ups use the light theme with raw colour values. The product uses the names in `../tokens.css`, which also holds the dark theme.
- The fonts are Geist and Geist Mono. Until they are self-hosted in `public/fonts/`, these pages fall back to system fonts.
- The phone screens are fixed at 390 by 844 for drawing. The product is fluid.
- Sample content ("Demo day", "Northwind", the dates) is made up.
- Where a mock-up and `../SPEC.md` disagree, the spec wins. Section 7 of the spec lists the known differences.
