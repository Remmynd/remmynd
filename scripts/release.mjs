#!/usr/bin/env node
// Prepares a release: bumps the version everywhere and moves "Unreleased" notes
// in CHANGELOG.md under the new version. It does not commit, tag or push.
// Usage: npm run release -- patch | minor | major | 1.2.3
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = f => readFileSync(new URL(f, root), "utf8");
const write = (f, s) => writeFileSync(new URL(f, root), s);
const REPO = "https://github.com/Remmynd/remmynd";

const arg = process.argv[2];
const pkg = read("package.json");
const current = JSON.parse(pkg).version;
const [maj, min, pat] = current.split(/[.-]/).map(Number);
const next =
  arg === "major" ? `${maj + 1}.0.0` :
  arg === "minor" ? `${maj}.${min + 1}.0` :
  arg === "patch" ? `${maj}.${min}.${pat + 1}` :
  /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg || "") ? arg : null;

if (!next) {
  console.error("Usage: npm run release -- patch | minor | major | <version>");
  process.exit(1);
}
if (next === current) {
  console.error(`Already at ${current}.`);
  process.exit(1);
}

// CHANGELOG.md: "## [Unreleased]" must have notes, which move under the new version.
let log = read("CHANGELOG.md");
const m = log.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|\n\[Unreleased\]: )/);
if (!m || !m[1].trim()) {
  console.error('CHANGELOG.md has nothing under "## [Unreleased]". Add the changes first.');
  process.exit(1);
}
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local date
log = log.replace(m[0], `## [Unreleased]\n\n## [${next}] - ${today}\n${m[1].replace(/\s+$/, "")}\n`);
log = log.replace(/^\[Unreleased\]: .+$/m,
  `[Unreleased]: ${REPO}/compare/v${next}...HEAD\n[${next}]: ${REPO}/compare/v${current}...v${next}`);
write("CHANGELOG.md", log);

// package.json and the library's VERSION constant stay in step (a test checks this).
write("package.json", pkg.replace(`"version": "${current}"`, `"version": "${next}"`));
const lib = read("lib/remmynd.js").replace(`export const VERSION = "${current}";`, `export const VERSION = "${next}";`);
write("lib/remmynd.js", lib);
write("public/remmynd.js", lib); // the site serves the library itself; a test keeps the two identical

console.log(`remmynd ${current} → ${next}

Updated package.json, lib/remmynd.js, public/remmynd.js and CHANGELOG.md. Next:

  npm test
  git switch -c release/v${next}
  git commit -am "Release ${next}"
  git push -u origin release/v${next}
  gh pr create --fill

When the pull request is merged, GitHub Actions tags v${next}, creates the
GitHub release from CHANGELOG.md and publishes the npm package.`);
