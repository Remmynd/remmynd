// Connector for AI assistants: a remote MCP server at /mcp (Streamable HTTP transport).
//
// Three tools, each one only turns words into a remmynd link or a link back into words, with the
// same library the website and the npm package use, so the links are identical:
//   make_reminder_link       title, start, time zone (and optional length, place, notes, host)
//   make_reminder_from_text  one line, the way a person writes it: "Dentist Tue 4pm smile.example"
//   read_reminder_link       what a remmynd link holds
// Nothing is stored or logged, there is no sign-in, and no other host is asked for anything.
//
// One endpoint speaks both eras of the protocol:
//   modern (2026-07-28)  every request carries its version in params._meta and in the
//                        MCP-Protocol-Version header, which is checked against the body along with
//                        Mcp-Method and Mcp-Name; server/discover, tools/list, tools/call.
//   legacy (2025-11-25 back to 2025-03-26)  an initialize handshake first. No session id is minted,
//                        so every request stands on its own there too.
import { createLink, decode, parse, describeWhen, VERSION } from "../lib/remmynd.js";

export const MODERN = ["2026-07-28"];
export const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SUPPORTED = [...MODERN, ...LEGACY];
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const MAX_BODY = 32 * 1024;
const HAS_OFFSET = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

const INSTRUCTIONS = "remmynd turns an event into a reminder link. Whoever opens the link can add it to their calendar and turn on phone alerts in one tap, with no account. " +
  "Use make_reminder_link when you know the title, the date and time, and the time zone. Use make_reminder_from_text for one line the way a person writes it, such as \"Dentist Tue 4pm\". " +
  "Always pass the person's IANA time zone, and give them the link exactly as returned. read_reminder_link reads a remmynd link back.";

/* ---------- tools ---------- */

const EVENT_OUT = {
  type: "object",
  properties: {
    link: { type: "string", description: "The reminder link. Give it to the person as it is." },
    title: { type: "string" },
    starts_at: { type: "string", description: "The start as an exact UTC time (ISO 8601)." },
    time_zone: { type: "string", description: "The IANA zone the time was written in, or an empty string." },
    when: { type: "string", description: "The start in words, in that zone (UTC when there is none)." },
    duration_minutes: { type: "integer" },
    location: { type: "string" },
    notes: { type: "string" },
    host: { type: "string" },
    private: { type: "boolean", description: "true when the link keeps everything after #, so it never reaches a server and chat apps show no preview." },
    in_the_past: { type: "boolean" }
  },
  required: ["link", "title", "starts_at", "time_zone", "when", "duration_minutes", "location", "notes", "host", "private", "in_the_past"],
  additionalProperties: false
};
const ZONE = { type: "string", description: "The IANA time zone, e.g. \"Asia/Kolkata\" or \"America/New_York\".", maxLength: 64 };
const PRIVATE = { type: "boolean", description: "true for a private link: the details stay after #, never reach a server, and chat apps show no preview. Default false." };
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "make_reminder_link",
    title: "Make a reminder link",
    description: "Make a remmynd reminder link from a title and a start time. Whoever opens the link can add it to their calendar and get phone alerts in one tap, with no account.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What it is, e.g. \"Demo day\".", minLength: 1, maxLength: 200 },
        start: { type: "string", description: "When it starts: \"YYYY-MM-DDTHH:mm\" in time_zone, or an exact time ending in Z or an offset such as +05:30.", maxLength: 40 },
        time_zone: { ...ZONE, description: ZONE.description + " Required unless start ends in Z or an offset." },
        duration_minutes: { type: "integer", minimum: 1, maximum: 1440, description: "How long it lasts. Default 60." },
        location: { type: "string", description: "A meeting link or a place.", maxLength: 500 },
        notes: { type: "string", maxLength: 1000 },
        host: { type: "string", description: "Who it's from, shown as \"from …\".", maxLength: 100 },
        private: PRIVATE
      },
      required: ["title", "start"],
      additionalProperties: false
    },
    outputSchema: EVENT_OUT,
    annotations: READ_ONLY
  },
  {
    name: "make_reminder_from_text",
    title: "Make a reminder link from one line",
    description: "Read one line the way a person writes it (\"Demo day Fri 5pm zoom.us/j/123\", \"Call Mum tomorrow 7:30pm\", \"Standup in 2 hours for 15 min\") and make a remmynd reminder link from it.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The line: a title, a day and time, and optionally a length and a link or \"at <place>\".", minLength: 1, maxLength: 600 },
        time_zone: { ...ZONE, description: ZONE.description + " Days and times in the text are read in it." },
        now: { type: "string", description: "The current time as an exact ISO 8601 time, if \"today\" and weekdays should be read from another moment. Default: now.", maxLength: 40 },
        private: PRIVATE
      },
      required: ["text", "time_zone"],
      additionalProperties: false
    },
    outputSchema: EVENT_OUT,
    annotations: READ_ONLY
  },
  {
    name: "read_reminder_link",
    title: "Read a reminder link",
    description: "Read what a remmynd reminder link holds: title, start, length, place, notes and host.",
    inputSchema: {
      type: "object",
      properties: { link: { type: "string", description: "A remmynd link: remmynd.space/r/… or remmynd.space/#…", minLength: 1, maxLength: 4000 } },
      required: ["link"],
      additionalProperties: false
    },
    outputSchema: EVENT_OUT,
    annotations: READ_ONLY
  }
];

class ToolError extends Error {}
const validZone = z => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };
const str = (v, max) => (v == null ? "" : String(v).trim().slice(0, max));
const lengthText = m => (m < 60 ? m + " min" : m % 60 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : m / 60 + (m === 60 ? " hour" : " hours"));

function describe(link, e, isPrivate, now) {
  const out = {
    link, title: e.title, starts_at: e.start.toISOString(), time_zone: e.timeZone || "", when: describeWhen(e.start, e.timeZone),
    duration_minutes: e.durationMinutes, location: e.location || "", notes: e.notes || "", host: e.host || "", private: !!isPrivate,
    in_the_past: e.start.getTime() + e.durationMinutes * 60000 < now
  };
  const line = [out.title, out.when, lengthText(out.duration_minutes), out.location].filter(Boolean).join(" · ");
  const extra = (out.in_the_past ? "\nNote: this time has already passed." : "") + (out.private ? "\nPrivate link: the details stay after #, so chat apps show no preview." : "");
  return { out, text: line + "\n" + link + extra };
}

function makeLink(event, isPrivate, base, now) {
  let link;
  try { link = createLink(event, { base, private: !!isPrivate }); } catch (err) { throw new ToolError(err.message); }
  return describe(link, decode(link), isPrivate, now);
}

function runTool(name, a, base, now) {
  if (name === "make_reminder_link") {
    const title = str(a.title, 200), start = str(a.start, 40), zone = str(a.time_zone, 64);
    if (!title) throw new ToolError("Give the reminder a title.");
    if (!start) throw new ToolError("Say when it starts, as \"YYYY-MM-DDTHH:mm\" with time_zone, or an exact time ending in Z or an offset.");
    if (zone && !validZone(zone)) throw new ToolError("\"" + zone + "\" isn't a time zone. Use an IANA name such as \"Europe/London\".");
    if (!zone && !HAS_OFFSET.test(start)) throw new ToolError("Which time zone is " + start + " in? Pass time_zone (for example \"America/New_York\"), or give start with Z or an offset.");
    if (a.duration_minutes != null && !(Number.isInteger(a.duration_minutes) && a.duration_minutes >= 1 && a.duration_minutes <= 1440)) throw new ToolError("duration_minutes must be a whole number from 1 to 1440.");
    return makeLink({ title, start, timeZone: zone || undefined, durationMinutes: a.duration_minutes ?? 60, location: str(a.location, 500), notes: str(a.notes, 1000), host: str(a.host, 100) }, a.private, base, now);
  }
  if (name === "make_reminder_from_text") {
    const text = str(a.text, 600), zone = str(a.time_zone, 64);
    if (!text) throw new ToolError("Give the line to read, such as \"Demo day Fri 5pm\".");
    if (!zone || !validZone(zone)) throw new ToolError("Pass the person's IANA time zone in time_zone, such as \"Asia/Kolkata\".");
    let at = new Date(now);
    if (a.now != null) {
      at = new Date(str(a.now, 40));
      if (!HAS_OFFSET.test(str(a.now, 40)) || isNaN(at)) throw new ToolError("now must be an exact ISO 8601 time ending in Z or an offset.");
    }
    const p = parse(text, { now: at, timeZone: zone });
    if (!p.start) throw new ToolError("No day or time found in \"" + text + "\". Add one, for example \"Fri 5pm\" or \"tomorrow 9:30am\".");
    if (!p.title) throw new ToolError("No title found in \"" + text + "\". Say what it is, for example \"Dentist Tue 4pm\".");
    return makeLink({ title: p.title, start: p.start, timeZone: zone, durationMinutes: p.dur || 60, location: p.place || "" }, a.private, base, now);
  }
  if (name === "read_reminder_link") {
    const link = str(a.link, 4000), e = link ? decode(link) : null;
    if (!e) throw new ToolError("That isn't a remmynd reminder link. They look like https://remmynd.space/r/… or https://remmynd.space/#…");
    return describe(link, e, link.includes("#"), now);
  }
  return null;
}

/* ---------- JSON-RPC over HTTP ---------- */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Max-Age": "86400"
};
const reply = (status, body, extra = {}) => new Response(body == null ? null : JSON.stringify(body), {
  status, headers: { ...CORS, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(body == null ? {} : { "Content-Type": "application/json" }), ...extra }
});
const error = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } });
const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });

/** A header value, with the =?base64?…?= form decoded (used for Mcp-Name). */
function headerText(v) {
  if (v == null) return null;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(m[1]), c => c.charCodeAt(0))); } catch { return null; }
}

function callTool(msg, base, modern) {
  const p = msg.params;
  const tool = TOOLS.find(t => t.name === p.name);
  if (!tool) return error(msg.id, -32602, "Unknown tool: " + String(p.name).slice(0, 80));
  const args = p.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) return error(msg.id, -32602, "arguments must be an object");
  const head = modern ? { resultType: "complete" } : {};
  try {
    const { out, text } = runTool(tool.name, args, base, Date.now());
    return result(msg.id, { ...head, content: [{ type: "text", text }, { type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false });
  } catch (err) {
    if (!(err instanceof ToolError)) throw err;
    return result(msg.id, { ...head, content: [{ type: "text", text: err.message }], isError: true });
  }
}

export async function handleMcp(request, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // DNS-rebinding guard from the spec: an Origin, when sent, has to be a real web origin.
  const origin = request.headers.get("origin");
  if (origin !== null && !/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(origin)) return reply(403, error(null, -32600, "Origin not allowed"));
  if (request.method === "GET" || request.method === "HEAD") {
    // A person who opens the address in a browser gets the explanation; MCP clients get 405 (no GET stream).
    const accept = request.headers.get("accept") || "";
    if (/text\/html/.test(accept) && !/text\/event-stream/.test(accept)) return new Response(null, { status: 302, headers: { Location: url.origin + "/docs#connector", "Cache-Control": "no-store" } });
    return reply(405, null, { Allow: "POST, OPTIONS" });
  }
  if (request.method !== "POST") return reply(405, null, { Allow: "POST, OPTIONS" });
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) return reply(415, error(null, -32600, "Send JSON (Content-Type: application/json)"));
  const raw = await request.text();
  if (raw.length > MAX_BODY) return reply(413, error(null, -32600, "Request too large"));
  let msg;
  try { msg = JSON.parse(raw); } catch { return reply(400, error(null, -32700, "Parse error")); }
  if (Array.isArray(msg)) return reply(400, error(null, -32600, "Batches aren't supported; send one message per request"));
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return reply(400, error(msg && msg.id, -32600, "Invalid request"));
  const isNotification = !("id" in msg);
  if (msg.params !== undefined && (typeof msg.params !== "object" || msg.params === null || Array.isArray(msg.params))) return reply(400, error(msg.id, -32602, "params must be an object"));
  const params = msg.params || {};
  if (isNotification) return reply(202, null); // notifications/initialized and the like: nothing to do
  const base = url.origin + "/";
  const hv = request.headers.get("mcp-protocol-version");
  const meta = params._meta && typeof params._meta === "object" ? params._meta : null;
  const mv = meta ? meta[META_VERSION] : undefined;

  // Legacy handshake. No session id is minted: every later request stands on its own.
  if (msg.method === "initialize") {
    const asked = params.protocolVersion;
    return reply(200, result(msg.id, {
      protocolVersion: LEGACY.includes(asked) ? asked : LEGACY[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "remmynd", title: "remmynd", version: VERSION, websiteUrl: url.origin },
      instructions: INSTRUCTIONS
    }));
  }

  const modern = mv !== undefined || (hv !== null && !LEGACY.includes(hv));
  if (modern) {
    // Per-request version, and the mirrored headers have to match the body.
    if (hv === null) return reply(400, error(msg.id, -32020, "Header mismatch: MCP-Protocol-Version header is missing"));
    if (mv !== hv) return reply(400, error(msg.id, -32020, "Header mismatch: MCP-Protocol-Version header value '" + String(hv).slice(0, 40) + "' does not match body value '" + String(mv).slice(0, 40) + "'"));
    if (!SUPPORTED.includes(hv)) return reply(400, error(msg.id, -32022, "Unsupported protocol version", { supported: SUPPORTED, requested: String(hv).slice(0, 40) }));
    if (request.headers.get("mcp-method") !== msg.method) return reply(400, error(msg.id, -32020, "Header mismatch: Mcp-Method header does not match the method"));
    if (msg.method === "tools/call" && headerText(request.headers.get("mcp-name")) !== params.name) return reply(400, error(msg.id, -32020, "Header mismatch: Mcp-Name header does not match the tool name"));
  } else if (hv !== null && !LEGACY.includes(hv)) {
    return reply(400, error(msg.id, -32022, "Unsupported protocol version", { supported: SUPPORTED, requested: String(hv).slice(0, 40) }));
  }

  const done = modern ? { resultType: "complete" } : {};
  const cache = modern ? { ttlMs: 3600000, cacheScope: "public" } : {};
  switch (msg.method) {
    case "server/discover":
      return reply(200, result(msg.id, {
        ...done, supportedVersions: SUPPORTED, capabilities: { tools: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "remmynd", title: "remmynd", version: VERSION, websiteUrl: url.origin } },
        instructions: INSTRUCTIONS, ...cache
      }));
    case "ping":
      return reply(200, result(msg.id, { ...done }));
    case "tools/list":
      return reply(200, result(msg.id, { ...done, tools: TOOLS, ...cache }));
    case "tools/call":
      if (typeof params.name !== "string") return reply(200, error(msg.id, -32602, "params.name must be the tool's name"));
      return reply(200, callTool(msg, base, modern));
    default:
      return reply(modern ? 404 : 200, error(msg.id, -32601, "Method not found: " + msg.method.slice(0, 80)));
  }
}
