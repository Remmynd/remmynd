# Releasing and operations

How remmynd gets from a pull request to remmynd.space and npm, and what to do when something goes wrong.

## At a glance

| What | How | Where it goes |
|---|---|---|
| Website and Worker | Merge to `main` | Deployed automatically to remmynd.space |
| npm package | Merge a version bump to `main` | Tagged, released on GitHub, published to npm |
| Hotfix by hand | `npm run ship` from your machine | remmynd.space |

`main` is always deployable. Nothing reaches it without a pull request and green CI.

## Day to day

1. Branch from `main`: `git switch -c fix/short-name`.
2. Make the change, add a test, and add a line under **Unreleased** in `CHANGELOG.md`.
3. `npm run check` runs the tests and a Worker build check, the same as CI.
4. Open a pull request. CI runs the tests on Node 20, 22 and 24 and builds the Worker.
5. Merge. The **Deploy** workflow tests again, deploys to Cloudflare and smoke-tests the live site. Watch it under **Actions → Deploy**; the run links to remmynd.space.

Docs-only changes (`*.md`, `docs/`, `brand/`) don't trigger a deploy.

## Cutting a release

Releases version the npm package and record what changed. Website-only changes don't need one, but they're still listed in the changelog.

```sh
git switch main && git pull
npm run release -- minor        # or patch, major, or an exact version
npm test
git switch -c release/v1.1.0
git commit -am "Release 1.1.0"
git push -u origin release/v1.1.0
gh pr create --fill
```

`npm run release` moves everything under **Unreleased** in `CHANGELOG.md` into a dated section for the new version, updates the compare links, and bumps the version in `package.json` and `lib/remmynd.js`. It doesn't commit or push.

When the pull request is merged, the **Release** workflow (`.github/workflows/publish.yml`):

1. runs the tests,
2. tags the merge commit `vX.Y.Z`,
3. creates the GitHub release, with notes taken from that version's changelog section (`npm run release:notes -- X.Y.Z` previews them),
4. publishes `remmynd@X.Y.Z` to npm with provenance, through npm trusted publishing (no npm token is stored anywhere).

Each step is skipped if it's already done, so the workflow is safe to re-run from **Actions → Release → Run workflow**.

### Versioning

| Bump | When |
|---|---|
| **patch** (1.0.x) | Fixes, docs, website-only changes worth a release |
| **minor** (1.x.0) | New features, new optional link keys, new library functions |
| **major** (x.0.0) | Removing or changing library functions. Never for the link format: old links must keep working |

## Rolling back

**Website:** every deploy is a Worker version, so rolling back is instant and needs no rebuild.

```sh
npx wrangler@4 deployments list      # find the last good version
npx wrangler@4 rollback <version-id>
```

Then revert the bad commit on `main` with a pull request, so the next deploy doesn't bring it back.

**npm:** published versions can't be overwritten. Release a fixed patch version. Within 72 hours a broken version can be removed with `npm unpublish remmynd@X.Y.Z`, but a new patch is almost always better. Mark a bad version with `npm deprecate remmynd@X.Y.Z "Use X.Y.Z+1"`.

## Manual deploy

For emergencies, or before automatic deploys are set up:

```sh
npx wrangler@4 login   # once per machine
npm run ship           # tests, then deploy
```

## One-time setup

### Automatic deploys

The **Deploy** workflow needs two repository settings (GitHub → Settings → Secrets and variables → Actions):

| Type | Name | Value |
|---|---|---|
| Variable | `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns the `remmynd` Worker |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template, limited to this account and the remmynd.space zone |

Optionally add required reviewers to the `production` environment (Settings → Environments) to approve each deploy.

### npm trusted publishing

On npmjs.com → remmynd → Settings → Trusted Publisher → GitHub Actions: organization `Remmynd`, repository `remmynd`, workflow `publish.yml`. Set publishing access to require two-factor authentication and disallow tokens. Renaming `publish.yml` breaks publishing until this is updated.

### Branch protection for `main`

Require a pull request, require the CI checks to pass, require linear history, and block force pushes and deletions.

## Operations reference

| Thing | Where |
|---|---|
| Live site | https://remmynd.space |
| Worker | Cloudflare → Workers & Pages → `remmynd` |
| DNS | Cloudflare → `remmynd.space` → DNS (records for the site are created by the Worker's custom domains) |
| npm package | https://www.npmjs.com/package/remmynd |
| Deploy and release runs | GitHub → Actions |
| Search | Google Search Console → `remmynd.space` (sitemap: `/sitemap.xml`) |
| Security reports | GitHub → Security → Report a vulnerability, or connect@zoof04.com |

### After a deploy, check

- `https://remmynd.space/` returns 200 and makes a link as you type.
- `https://www.remmynd.space/` redirects to `https://remmynd.space/`.
- `/example` opens the sample reminder; `/nope` shows the 404 page.
- **Remind me** works on iPhone Safari, inside an iPhone in-app browser, and on Android Chrome.

The Deploy workflow's smoke test covers the first three automatically.
