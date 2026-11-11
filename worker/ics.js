// GET /ics?d=<base64url JSON> — builds an .ics file from a reminder link.
// Used only for iPhone in-app browsers (Instagram, LinkedIn, Chrome on iOS), where a client-made .ics file does nothing.
// Builds the file in memory from the link itself. Nothing is stored or logged by this code.
const te = new TextEncoder();
const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const isHttp = s => /^https?:\/\//i.test(s || "");
function fold(l) { const out = []; let cur = "", n = 0; for (const ch of l) { const b = te.encode(ch).length; if (n + b > 73) { out.push(cur); cur = " "; n = 1; } cur += ch; n += b; } out.push(cur); return out.join("\r\n"); }
function hash(s) { let h = 5381; for (const c of s) h = (h * 33) ^ c.charCodeAt(0); return (h >>> 0).toString(36); }
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

export function icsResponse(request) {
  const d = new URL(request.url).searchParams.get("d") || "";
  if (d.length > 4000) return new Response("Link too long", { status: 414 });
  let r;
  try {
    const bin = atob(d.replace(/-/g, "+").replace(/_/g, "/"));
    r = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch { return new Response("This reminder link is broken", { status: 400 }); }
  const start = new Date(parseInt(r.s, 36) * 60000);
  if (!r.t || isNaN(start)) return new Response("This reminder link is broken", { status: 400 });
  const mins = Math.min(Math.max(+r.d || 60, 5), 1440);
  const end = new Date(start.getTime() + mins * 60000);
  const title = clip(r.t, 160), loc = clip(r.l, 200), notes = clip(r.n, 300);
  const share = isHttp(r.u) && /^https:\/\/([a-z0-9-]+\.)*(remmynd\.space|workers\.dev|pages\.dev)\//.test(r.u) ? clip(r.u, 3000) : "https://remmynd.space/";
  const head = [notes, isHttp(loc) ? "Join: " + loc : ""].filter(Boolean);
  const desc = (head.length ? head.join("\n") + "\n\n" : "") + "Reminder link: " + share + "\nMade with remmynd.space · free reminder links, no account needed";
  const uid = "rm-" + clip(r.k, 12) + "-" + hash(clip(r.o, 160) || title) + "@remmynd.space";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//zoof04//remmynd//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    "UID:" + uid, "DTSTAMP:" + stamp(new Date()), "DTSTART:" + stamp(start), "DTEND:" + stamp(end), "SUMMARY:" + esc(title), "DESCRIPTION:" + esc(desc)];
  if (loc) L.push("LOCATION:" + esc(loc));
  L.push("URL:" + (isHttp(loc) ? loc : share));
  L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(title), "TRIGGER:-PT1H", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(title), "TRIGGER:PT0M", "END:VALARM", "END:VEVENT", "END:VCALENDAR");
  const name = (title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "reminder") + ".ics";
  return new Response(L.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" }
  });
}
