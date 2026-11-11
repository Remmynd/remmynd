/* remmynd floating countdown: a small window that stays above every other window and counts down
 * to the reminder (Document Picture-in-Picture: Chrome and Edge on a computer). app.js loads this only
 * when someone asks for it, and doesn't offer it where the browser can't. The window uses the site's
 * own stylesheets, so it follows the theme and the content security policy like the page does. */

let win = null, cur = null, last = "", watch = null;
const pad = n => String(n).padStart(2, "0");

/** "41:58" under an hour, "5:41:58" under two days, then "3 days". */
export function left(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s >= 172800) return Math.floor(s / 86400) + " days";
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s % 60);
}

/** What the window shows at a moment: the ring's state, the big line and the small one. */
export function face({ title, at, end }, now) {
  if (now < at) return { state: at - now <= 36e5 ? "soon" : "held", big: left(at - now), small: "until " + title };
  if (now < end) return { state: "now", big: "Now", small: title };
  return { state: "missed", big: "Ended", small: title };
}

function paint() {
  if (!win || !cur) return;
  const d = win.document, f = face(cur, Date.now());
  if (f.state !== last) { d.querySelector(".fl-ring").innerHTML = cur.ring(f.state); last = f.state; }
  d.querySelector(".fl-big").textContent = f.big;
  d.querySelector(".fl-small").textContent = f.small;
  d.title = f.big + " · " + cur.title;
}
const theme = () => { const t = document.documentElement.dataset.theme, root = win && win.document.documentElement; if (!root) return; if (t) root.dataset.theme = t; else delete root.dataset.theme; };

/** Opens the window, or shows another reminder in the one that's open. o: { title, at, end, ring(state), onclose }. */
export async function open(o) {
  cur = o; last = "";
  if (!win) {
    win = await window.documentPictureInPicture.requestWindow({ width: 340, height: 150 });
    const d = win.document;
    for (const href of ["/app.css", "/float.css"]) { const l = d.createElement("link"); l.rel = "stylesheet"; l.href = new URL(href, location.href).href; d.head.append(l); }
    d.documentElement.lang = "en";
    d.body.className = "fl";
    d.body.innerHTML = '<div class="fl-ring"></div><div class="fl-text"><b class="fl-big"></b><span class="fl-small"></span></div>';
    theme();
    watch = new MutationObserver(theme);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // The timer belongs to the floating window, which stays visible, so a background tab doesn't slow it down.
    win.setInterval(paint, 1000);
    win.addEventListener("pagehide", () => {
      watch.disconnect(); win = null;
      const done = cur && cur.onclose; cur = null;
      if (done) done();
    }, { once: true });
  }
  paint();
}

export function close() { if (win) win.close(); }
