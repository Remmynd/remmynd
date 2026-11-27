// Module hooks for scripts/text-loader.mjs: a .md file becomes a module whose default export is its text.
import { readFile } from "node:fs/promises";

export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".md")) {
    const text = await readFile(new URL(url), "utf8");
    return { format: "module", source: "export default " + JSON.stringify(text) + ";", shortCircuit: true };
  }
  return next(url, context);
}

// The Workers runtime's own module, for the classes the Worker extends. Under Node it's a stand-in that keeps env and ctx.
export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return next(specifier, context);
}
