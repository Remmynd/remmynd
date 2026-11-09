# Contributing to remmynd

Thanks for helping. remmynd is small on purpose, so the bar for adding things is "does it keep the tool light, private and one tap?"

## Ground rules

- **No tracking.** No analytics, cookies, fingerprinting or third-party scripts on the site.
- **No storage.** Reminders live in the link. Changes that need a database or accounts belong in a separate project.
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
2. Create a branch from `main`.
3. Keep the website (`public/index.html`), the library (`lib/remmynd.js`) and the Worker (`worker/`) in step. `npm test` checks that the site and library produce identical links and that the published badge files match the library.
4. Add or update tests in `test/`.
5. Add a line to `CHANGELOG.md` under "Unreleased".
6. Open a pull request and fill in the template.

## Testing on real devices

For anything touching the Remind me button, please test on at least:

- iPhone Safari, and a link opened from inside Instagram or LinkedIn
- Android Chrome
- One desktop browser, in light and dark mode

## Commit messages

Short, present tense, describing the change: `Add Outlook web link`, `Fix .ics line folding for emoji`.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
