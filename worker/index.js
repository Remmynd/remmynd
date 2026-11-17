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
import { handleFeeds, calendarResponse, receiveEmail } from "./feed.js";
import { handlePro, proBeforeDelete } from "./pro.js";
import { handleCount, cleanCounts } from "./count.js";
import { appSiteResponse } from "./appsite.js";
import { handleHost, hostPageResponse, launchStateResponse } from "./hosts.js";
import { handleFollow, followLive, sendFollowMails, saverAlerts } from "./follows.js";
import { handleChat, cleanChats } from "./chat.js";
import { handleCrew, cleanCrews } from "./crews.js";
import { adminResponse } from "./numbers.js";

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
    // A signed-in account's calendar feed and email-in address (worker/feed.js).
    if (url.pathname.startsWith("/api/feeds")) return handleFeeds(request, env, url);
    // remmynd Pro: one status on the account, paid on the website (Polar) or in the app (Apple) (worker/pro.js).
    if (url.pathname === "/api/pro" || url.pathname.startsWith("/api/pro/")) return handlePro(request, env, url);
    // Deleting an account ends its website purchase first, so nothing is billed for an account that's gone.
    if (url.pathname === "/api/account/delete" && request.method === "POST") await proBeforeDelete(request, env, url).catch(() => {});
    if (url.pathname.startsWith("/cal/")) return calendarResponse(request, env, url);
    // Host pages: the API, and the public pages at /@handle and /@handle/<slug>. The bare template isn't a page.
    if (url.pathname === "/api/host" || url.pathname.startsWith("/api/host/")) return handleHost(request, env, url);
    if (url.pathname === "/api/launch") return launchStateResponse(request, env, url);
    if (url.pathname === "/api/launch/go") return handleHost(request, env, url);
    if (url.pathname.startsWith("/api/chat/")) return handleChat(request, env, url);
    if (url.pathname.startsWith("/api/crew/")) return handleCrew(request, env, url);
    if (url.pathname === "/admin" || url.pathname === "/admin/") return adminResponse(request, env, url);
    if (url.pathname === "/api/follow" || url.pathname.startsWith("/api/follow/") || url.pathname === "/api/unfollow") return handleFollow(request, env, url);
    if (url.pathname.startsWith("/@") || url.pathname.startsWith("/%40")) return hostPageResponse(request, env, url);
    if (url.pathname === "/at" || url.pathname === "/at/") { const nf = await env.ASSETS.fetch(new Request(new URL("/404", url))); return new Response(nf.body, { status: 404, headers: nf.headers }); }
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

    // Apple's app-site file: remmynd for iPhone may use passkeys for this site (webcredentials), and opens
    // shared reminder links itself when it's installed (applinks). Public by design; nothing about anyone in it.
    if (url.pathname === "/.well-known/apple-app-site-association") return appSiteResponse(request);

    // Named pages: /example → /#example
    const name = url.pathname.replace(/^\/+|\/+$/g, "");
    if (PRESETS.has(name)) return Response.redirect(url.origin + "/#" + name, 302);

    return env.ASSETS.fetch(request);
  },

  // Email Routing (a catch-all to this Worker): mail to in-<token>@ becomes a reminder in that account.
  async email(message, env, ctx) {
    await receiveEmail(message, env);
  },

  // Cron trigger (every minute): send the pings that are due, then forget them.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDuePings(env));
    ctx.waitUntil(sendDueMails(env));
    // Follow: launches that just went live are told to their followers; follow emails go out a few at a time.
    ctx.waitUntil(followLive(env).then(() => saverAlerts(env)).then(() => sendFollowMails(env)).catch(() => {}));
    ctx.waitUntil(cleanChats(env).catch(() => {}));
    ctx.waitUntil(cleanCrews(env).catch(() => {}));
    // Once an hour: forget counts 30 days after their reminder ended.
    if (new Date(event.scheduledTime || Date.now()).getUTCMinutes() === 17) ctx.waitUntil(cleanCounts(env));
  }
};
