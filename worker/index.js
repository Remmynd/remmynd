// remmynd Worker. Static files in public/ are served directly by Cloudflare;
// this code only runs for paths that are not files.
import { icsResponse } from "./ics.js";

const PRESETS = new Set(["example"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // www.remmynd.space → remmynd.space
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    // iPhone in-app browser fallback: build the calendar file in memory, store nothing.
    if (url.pathname === "/ics") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      return icsResponse(request);
    }

    // Named pages: /example → /#example
    const name = url.pathname.replace(/^\/+|\/+$/g, "");
    if (PRESETS.has(name)) return Response.redirect(url.origin + "/#" + name, 302);

    return env.ASSETS.fetch(request);
  }
};
