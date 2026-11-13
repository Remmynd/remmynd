/* remmynd live badge: the sheet behind "The live badge" on the ready screen. app.js loads it only on
 * that tap. It shows the reminder's live badge, the picture /b/ draws on this site, and copies it as
 * HTML or Markdown, or copies a line for Discord that counts down in each reader's own zone. Private
 * links never reach a server, so they have no live badge; the Discord line works for both. */
import { liveBadgeURL, liveBadgeHTML, liveBadgeMarkdown, discordLine } from "/remmynd.js";

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
let back = null;

function onKey(e) { if (e.key === "Escape") close(); }
function close() {
  const el = $("#lb-sheet");
  if (!el) return;
  el.remove(); document.removeEventListener("keydown", onKey);
  if (back && back.isConnected) back.focus();
}

/** Open the sheet for a link. copy(text, message) is the app's own, so copying works the same everywhere. */
export function open(link, { copy, from } = {}) {
  if (!$('link[href="/livebadge.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/livebadge.css"; document.head.append(l); }
  close();
  back = from || document.activeElement;
  const shared = !String(link).includes("#");
  const el = document.createElement("div");
  el.className = "sheet"; el.id = "lb-sheet";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "lb-t");
  el.innerHTML = '<div class="sheet-card lb-card"><button type="button" class="sheet-x" aria-label="Close">×</button><h2 id="lb-t">The live badge</h2>' +
    (shared
      ? '<p class="lb-sub">A picture that counts down, for websites, READMEs and forums. Tap it and the reminder opens.</p>' +
        '<img class="lb-img" src="' + esc(liveBadgeURL(link)) + '" alt="Your live badge" width="360" height="96">' +
        '<div class="lb-btns"><button type="button" class="btn" data-k="html">Copy HTML</button><button type="button" class="btn" data-k="md">Copy Markdown</button></div>'
      : '<p class="lb-sub">Private links never reach our server, so they have no live badge. Turn off Private link to get one.</p>') +
    '<button type="button" class="btn ink" data-k="discord">Copy for Discord</button>' +
    '<p class="sheet-note">On Discord the time shows as a countdown, in each reader\'s own time zone.</p>' +
    '<a class="lb-more" href="/hosts#live-badge">More for hosts</a></div>';
  document.body.append(el);
  const say = { html: "Live badge copied. Paste it into your page.", md: "Live badge copied. Paste it into your README.", discord: "Copied for Discord. Paste it into a channel." };
  el.addEventListener("click", e => {
    if (e.target === el || e.target.closest(".sheet-x")) return close();
    const k = e.target.closest("[data-k]");
    if (!k) return;
    const key = k.dataset.k;
    copy(key === "html" ? liveBadgeHTML(link) : key === "md" ? liveBadgeMarkdown(link) : discordLine(link), say[key]);
  });
  document.addEventListener("keydown", onKey);
  el.querySelector(".sheet-x").focus();
}
