// remmynd Worker. Every request comes here first (run_worker_first in wrangler.toml);
// anything that isn't one of the routes below is handed to the static files in public/.
import { icsResponse } from "./ics.js";
import { handlePush, sendDuePings } from "./push.js";
import { sharedResponse, newResponse, shareResponse } from "./preview.js";
import { changelogResponse } from "./changelog.js";
import { statsResponse } from "./stats.js";
import { handleMcp } from "./mcp.js";
import { embedResponse } from "./embed.js";
import { badgeResponse } from "./badge.js";
import { handleAccount, sendDueMails } from "./account.js";
import { handleCount, cleanCounts } from "./count.js";

const PRESETS = new Set(["example"]);

export default {
  async fetch(request, env, ctx) {
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

    // Optional sign-in, sync and email reminders.
    if (url.pathname.startsWith("/api/")) return handleAccount(request, env, url, ctx);

    // Connector for AI assistants (MCP): makes and reads reminder links, stores nothing.
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return handleMcp(request, url);

    // Public counts, only for reminders whose host switched one on: one number per reminder.
    if (url.pathname.startsWith("/count/")) return handleCount(request, env, url);

    // Push notifications: public key, schedule and cancel anonymous pings.
    if (url.pathname.startsWith("/push/")) return handlePush(request, env, url);

    // Shared links: the shell with preview tags for that reminder. Never stored, logged or cached.
    if (url.pathname.startsWith("/r/")) return sharedResponse(request, env, url);

    // The reminder card other sites show in an iframe. Never stored, logged or cached.
    if (url.pathname.startsWith("/embed/")) return embedResponse(request, env, url);

    // The live badge: a picture that counts down, for READMEs, forums and pages. Never stored or logged.
    if (url.pathname.startsWith("/b/")) return badgeResponse(request, env, url);

    // Hand-written links: /new?t=…&at=…&tz=… → the /r/ link.
    if (url.pathname === "/new" || url.pathname === "/new/") return newResponse(request, env, url);

    // Shared to remmynd from another app (Android share sheet): the app, which reads the text itself.
    if (url.pathname === "/share" || url.pathname === "/share/") return shareResponse(request, env, url);

    // The changelog page, rendered from CHANGELOG.md inside the website's own page.
    if (url.pathname === "/changelog") return changelogResponse(request, env, url);

    // Public numbers for the For hosts page (GitHub stars, npm downloads), fetched here and cached.
    if (url.pathname === "/stats") return statsResponse(request, env, ctx);

    // Named pages: /example → /#example
    const name = url.pathname.replace(/^\/+|\/+$/g, "");
    if (PRESETS.has(name)) return Response.redirect(url.origin + "/#" + name, 302);

    return env.ASSETS.fetch(request);
  },

  // Cron trigger (every minute): send the pings that are due, then forget them.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDuePings(env));
    ctx.waitUntil(sendDueMails(env));
    // Once an hour: forget counts 30 days after their reminder ended.
    if (new Date(event.scheduledTime || Date.now()).getUTCMinutes() === 17) ctx.waitUntil(cleanCounts(env));
  }
};
