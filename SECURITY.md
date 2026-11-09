# Security policy

## Supported versions

The live site at remmynd.space and the latest release of the `remmynd` npm package.

## Reporting a vulnerability

Please do not open a public issue.

- Preferred: GitHub → this repository → **Security** → **Report a vulnerability** (private).
- Or email **connect@zoof04.com** with "remmynd security" in the subject.

Include steps to reproduce and, if you can, a sample link. We aim to reply within 3 working days and to fix confirmed issues within 14 days.

## What we especially care about

Reminder links are written by anyone, so the page treats everything in them as untrusted:

- Script injection through a crafted link (title, notes, place, host)
- Links that make the page open a different site without the visitor choosing it
- Malformed `.ics` output from the `/ics` Worker or the library
- Anything that would let remmynd.space learn what is inside a link

## Out of scope

- The contents of a link someone else made. remmynd shows exactly what the link says; check the destination before you click it.
- Denial of service against Cloudflare itself.
