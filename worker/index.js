// remmynd Worker. Every request comes here first (run_worker_first in wrangler.toml);
// anything that isn't one of the routes below is handed to the static files in public/.
import { icsResponse } from "./ics.js";
import { handlePush, sendDuePings } from "./push.js";

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

    // Push notifications: public key, schedule and cancel anonymous pings.
    if (url.pathname.startsWith("/push/")) return handlePush(request, env, url);

    // Named pages: /example → /#example
    const name = url.pathname.replace(/^\/+|\/+$/g, "");
    if (PRESETS.has(name)) return Response.redirect(url.origin + "/#" + name, 302);

    return env.ASSETS.fetch(request);
  },

  // Cron trigger (every minute): send the pings that are due, then forget them.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDuePings(env));
  }
};
