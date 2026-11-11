#!/usr/bin/env node
// Prints the release notes for one version, taken from CHANGELOG.md.
// Usage: node scripts/release-notes.mjs 1.1.0
import { readFileSync } from "node:fs";

const version = (process.argv[2] || "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

const log = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const lines = log.split("\n");
const start = lines.findIndex(l => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section.`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && (l.startsWith("## [") || /^\[[^\]]+\]: /.test(l)));
if (end === -1) end = lines.length;

// Relative links (docs/…, CHANGELOG.md) become full GitHub links pinned to the release tag.
const body = lines.slice(start + 1, end).join("\n").trim()
  .replace(/\]\((?!https?:|#|mailto:)([^)]+)\)/g, `](https://github.com/Remmynd/remmynd/blob/v${version}/$1)`);
if (!body) {
  console.error(`The ${version} section in CHANGELOG.md is empty.`);
  process.exit(1);
}

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compare = log.match(new RegExp(`^\\[${escaped}\\]: (.+)$`, "m"));
console.log(body);
console.log("\n---\n");
console.log(`**npm:** \`npm install remmynd@${version}\` · https://www.npmjs.com/package/remmynd/v/${version}`);
if (compare) console.log(`**Full changelog:** ${compare[1]}`);
