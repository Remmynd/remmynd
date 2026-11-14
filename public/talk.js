/* remmynd Talk: tap the mic, say the reminder, stop. app.js loads this on the first tap of the mic.
 * What you say goes into the bar as if typed, after anything already there, so the live preview and the
 * chips work as they always do. When speech ends, a line with a time in it becomes the link, exactly as
 * Enter makes it. Any other line stays in the bar. The browser turns speech into text; where it can do
 * that on this device (processLocally), nothing leaves it. This file sends nothing anywhere, and it never
 * measures the sound, so there is no level meter. */

const NOTE = "If you use the mic, your browser turns your speech into text, and it may send the sound to its maker to do that. remmynd never receives your voice.";
let o = null, cur = null, own = false, wired = false;

/** The line under the bar. With dot, the pulsing dot that shows it's listening. */
function say(text, dot) {
  const h = o.hint;
  h.classList.remove("idle"); h.textContent = text || ""; h.hidden = !text;
  if (dot) { const d = document.createElement("span"); d.className = "talk-dot"; d.setAttribute("aria-hidden", "true"); h.prepend(d); }
}

/** Into the bar, read like anything typed there. */
function put(text) { own = true; o.input.value = text; o.input.dispatchEvent(new Event("input")); own = false; }

/** On first use only, what happens to the sound, under the bar until the next tap of the mic. */
function note() {
  const old = document.getElementById("talk-note");
  if (old) old.remove();
  try { if (localStorage.getItem("rm:talk-note")) return; localStorage.setItem("rm:talk-note", "1"); } catch (e) { /* no storage here: say it each time */ }
  const p = document.createElement("p");
  p.className = "cap-note"; p.id = "talk-note"; p.textContent = NOTE;
  o.hint.after(p);
}

function wire() {
  if (wired) return;
  wired = true;
  if (!document.querySelector('link[href="/talk.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/talk.css"; document.head.append(l); }
  // Typing or Enter after Talk said something: that line has done its job.
  o.input.addEventListener("input", () => { if (!own && !cur) say(""); });
  o.form.addEventListener("submit", () => { if (!cur) say(""); });
  // Esc or Cancel stops without making anything.
  document.addEventListener("keydown", e => { if (e.key === "Escape" && cur) cancel(); });
  document.addEventListener("click", e => { if (cur && e.target.closest && e.target.closest('[data-act="cancel"]')) cancel(); }, true);
}

function cancel() {
  const c = cur;
  if (!c) return;
  c.cancelled = true;
  if (c.started) c.r.abort(); else end(c);
}

function end(c) {
  if (cur !== c) return;
  cur = null;
  o.form.classList.remove("listening");
  o.btn.setAttribute("aria-pressed", "false");
  if (c.retry) return start(false);
  if (c.cancelled) return say("");
  if (c.msg) return say(c.msg);
  if (c.failed) return say("");
  done(c.heard);
}

/** Speech ended. A clock time or "in 20 minutes": make the link. A day alone: wait for a time. Nothing: ask when. */
function done(line) {
  say("");
  if (!line) return;
  const p = o.parse(line, { timeZone: o.timeZone });
  if (o.timed(p)) return o.make(line);
  if (p.start) return say("Say a time, or press Enter for " + o.at(p.start) + ".");
  say("Say when, like “Friday 5 pm”.");
}

async function start(local) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const r = new SR(), lang = navigator.language || "en-US";
  const c = { r, base: o.input.value.trim(), heard: "", started: false };
  cur = c;
  r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  // On this device where the browser can: then the sound never leaves it. No language download here.
  if (local && "processLocally" in r && typeof SR.available === "function") {
    try { if (await SR.available({ langs: [lang], processLocally: true }) === "available") r.processLocally = true; } catch (e) { /* the browser's usual way */ }
    if (cur !== c) return;
  }
  r.onstart = () => {
    o.form.classList.add("listening");
    o.btn.setAttribute("aria-pressed", "true");
    say("Listening. Pause to finish.", true);
    note();
  };
  r.onresult = e => {
    let t = "";
    for (const x of e.results) t += x[0].transcript;
    t = t.trim();
    if (t) { c.heard = (c.base ? c.base + " " : "") + t; put(c.heard); }
  };
  r.onerror = e => {
    const why = e.error;
    if (why === "language-not-supported" && r.processLocally) c.retry = true;
    else if (why === "not-allowed" || why === "service-not-allowed") c.msg = "The mic is blocked for this site. You can still type.";
    else if (why === "network") c.msg = "Speech needs a connection in this browser. You can still type.";
    else c.failed = true; // no-speech, aborted and the rest: stop quietly
  };
  r.onend = () => end(c);
  try { r.start(); c.started = true; } catch (e) { c.failed = true; end(c); }
}

/** The mic button. The first tap listens; a tap while listening finishes early. */
export function toggle(opts) {
  o = opts;
  wire();
  if (cur) { if (cur.started) cur.r.stop(); else cancel(); return Promise.resolve(); }
  return start(true);
}
