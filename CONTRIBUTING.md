# Contributing to remmynd

Thanks for helping. remmynd is small on purpose, so the bar for adding things is "does it keep the tool light, private and one tap?" The reasoning behind that is in [docs/PRINCIPLES.md](docs/PRINCIPLES.md), and how the pieces fit together is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Ground rules

- **No tracking.** No analytics, cookies, fingerprinting or third-party scripts on the site.
- **No personal data on the server.** Reminders live in the link and on the device. The only server data is anonymous push pings (id, push address, time), deleted once sent. No accounts.
- **No runtime dependencies** in the npm package.
- **Keep the page small.** `public/index.html` should stay a single file well under 50 KB.
- **Links never break.** The link format (`t`, `s`, `d`, `l`, `n`, `h`) is a public contract. New keys must be optional, and old links must keep working.

## Set up

```sh
git clone https://github.com/Remmynd/remmynd.git
cd remmynd
npm test
npm run dev
```

Node 20 or later. No install step is needed; there are no dependencies.

## Making a change

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Create a branch from `main`, named for the change: `fix/ics-folding`, `feat/outlook-web`, `docs/readme`.
3. Keep the website (`public/index.html`), the library (`lib/remmynd.js`) and the Worker (`worker/`) in step. `npm test` checks that the site and library produce identical links and that the published badge files match the library.
4. Add or update tests in `test/`.
5. Add a line to `CHANGELOG.md` under "Unreleased", in the right group (Added, Changed, Fixed, Removed, Security).
6. Run `npm run check`, which is the same as CI.
7. Open a pull request and fill in the template.

Merged changes deploy to remmynd.space automatically. Maintainers cut npm releases as described in [docs/RELEASING.md](docs/RELEASING.md).

## Testing on real devices

For anything touching the Remind me button, please test on at least:

- iPhone Safari, and a link opened from inside Instagram or LinkedIn
- Android Chrome
- One desktop browser, in light and dark mode

## Commit messages

Short, imperative, describing the change: `Add Outlook web link`, `Fix .ics line folding for emoji`. Pull requests are squash-merged, so the PR title becomes the commit message on `main`; keep it to one line under 72 characters, and explain the why in the description.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
