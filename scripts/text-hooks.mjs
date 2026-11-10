// Module hooks for scripts/text-loader.mjs: a .md file becomes a module whose default export is its text.
import { readFile } from "node:fs/promises";

export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".md")) {
    const text = await readFile(new URL(url), "utf8");
    return { format: "module", source: "export default " + JSON.stringify(text) + ";", shortCircuit: true };
  }
  return next(url, context);
}
