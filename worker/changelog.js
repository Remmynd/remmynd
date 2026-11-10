// GET /changelog: CHANGELOG.md, bundled into the Worker as text, rendered inside the website's own
// page (public/changelog/index.html), so it shares the header and footer of every other page.
//
// The renderer knows only what the changelog uses: headings, bullet lists, paragraphs, `code`,
// **bold**, [links](url) and [reference] links. Every piece of text is escaped first, and a link
// may only go to https, http or mailto; a path in the repository becomes a link to it on GitHub.
import CHANGELOG from "../CHANGELOG.md";
import { escapeHTML } from "./preview.js";

const REPO = "https://github.com/Remmynd/remmynd/blob/main/";

/** A safe address for a link, or null. */
function href(url) {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return null; // javascript:, data: and friends
  if (u.startsWith("#")) return u;
  return REPO + u.replace(/^\.?\//, "");
}

const link = (text, url) => { const h = url && href(url); return h ? `<a href="${escapeHTML(h)}">${text}</a>` : text; };

/** One line of Markdown to HTML. Code spans are cut out first so nothing inside them is read as Markdown. */
function inline(src, refs) {
  return src.split(/(`[^`]+`)/).map((part, i) => {
    if (i % 2) return "<code>" + escapeHTML(part.slice(1, -1)) + "</code>";
    let s = escapeHTML(part);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => link(t, u.replace(/&amp;/g, "&")));
    s = s.replace(/\[([^\]]+)\](?!\()/g, (m, t) => refs.has(t.toLowerCase()) ? link(t, refs.get(t.toLowerCase())) : m);
    return s;
  }).join("");
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** CHANGELOG.md to HTML. The top heading is left out: the page has its own. */
export function renderChangelog(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const refs = new Map();
  for (const l of lines) { const m = /^\[([^\]]+)\]:\s*(\S+)\s*$/.exec(l); if (m) refs.set(m[1].toLowerCase(), m[2]); }
  const out = [];
  let list = null, para = null;
  const flush = () => {
    if (para) { out.push("<p>" + inline(para.join(" "), refs) + "</p>"); para = null; }
    if (list) { out.push("<ul>" + list.map(li => "<li>" + inline(li, refs) + "</li>").join("") + "</ul>"); list = null; }
  };
  for (const l of lines) {
    if (/^\[([^\]]+)\]:\s*\S+\s*$/.test(l)) continue;
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) {
      flush();
      const level = m[1].length, text = m[2].trim();
      if (level === 1) continue;
      if (level === 2) {
        // "## [1.0.0] - 2026-11-09" becomes "1.0.0" with the date beside it.
        const v = /^\[([^\]]+)\](?:\s*-\s*(.+))?$/.exec(text);
        const name = v ? v[1] : text, date = v && v[2] ? ` <span>${escapeHTML(v[2])}</span>` : "";
        out.push(`<h2 id="${slug(name) || "release"}">${escapeHTML(name)}${date}</h2>`);
      } else out.push("<h3>" + inline(text, refs) + "</h3>");
    } else if ((m = /^[-*]\s+(.*)$/.exec(l))) {
      if (para) flush();
      (list ||= []).push(m[1]);
    } else if (/^\s+\S/.test(l) && list) {
      list[list.length - 1] += " " + l.trim();
    } else if (!l.trim()) {
      flush();
    } else {
      if (list) flush();
      (para ||= []).push(l.trim());
    }
  }
  flush();
  return out.join("\n");
}

let rendered = null;

export async function changelogResponse(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const page = await env.ASSETS.fetch(new Request(new URL("/changelog", url)));
  if (!page.ok) return page;
  rendered ??= renderChangelog(CHANGELOG);
  const out = new HTMLRewriter().on("#log", { element(el) { el.setInnerContent(rendered, { html: true }); } }).transform(page);
  const res = new Response(out.body, out);
  res.headers.delete("ETag");
  res.headers.delete("Content-Length");
  return res;
}
