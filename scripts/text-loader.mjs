// Lets Node import .md files as text, the way wrangler bundles them for the Worker
// ([[rules]] type = "Text" in wrangler.toml). Used by npm test: node --import ./scripts/text-loader.mjs --test
import { register } from "node:module";

register("./text-hooks.mjs", import.meta.url);
