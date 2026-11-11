/* remmynd command palette: Ctrl or Cmd + K (or Search and commands in the menu). app.js loads this
 * the first time it's asked for, so a first visit never downloads it. Search your reminders and links,
 * or run a command: a new reminder, Coming up, My links, the floating countdown, theme, sound, sign in,
 * install and the site's pages. Typing something that matches nothing offers to make it a reminder. */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const FIRST = 5; // reminders and links shown before you type
const ALSO = { "/hosts": "badge embed", "/docs": "help api cli", "/privacy": "data", "/changelog": "new release", out: "source code" };

/** The rest comes from the page itself: the menu's own buttons and links, so the two always agree. */
function fromPage() {
  const acct = $("#acct-btn"), inst = $("#install"), fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  let sound = true;
  try { sound = localStorage.getItem("rm:sound") !== "off"; } catch (e) {}
  return {
    host: location.host, theme: document.documentElement.dataset.theme || "auto", sound,
    setTheme: t => $('[data-theme-set="' + t + '"]').click(),
    setSound: on => $('[data-sound="' + (on ? "on" : "off") + '"]').click(),
    account: () => acct.click(), accountLabel: acct.textContent,
    install: inst && !inst.hidden ? () => inst.click() : null,
    when: t => fmt.format(t),
    pages: [...document.querySelectorAll(".menu-links a")].map(a => [a.textContent, a.href]).concat([["Privacy", "/privacy"], ["Changelog", "/changelog"]]),
  };
}

/** Every command and every reminder and link, in the order they're listed. a: what app.js hands over, plus fromPage(). */
export function commands(a, now = Date.now()) {
  const list = [], n = { Reminders: 0, Links: 0 };
  const add = (group, label, run, hint = "", words = "") => {
    list.push({ group, label, run, hint, more: group in n && ++n[group] > FIRST, words: (label + " " + words + " " + hint).toLowerCase() });
  };
  add("Do", "New reminder", () => a.newOne(), "", "make create add write");
  if (a.float) add("Do", a.floating ? "Put the floating countdown away" : "Float the countdown above my windows", a.float, "", "picture in picture timer pip");
  add("Go to", "Coming up", () => a.go("/#coming-up"), "", "reminders upcoming list kept");
  add("Go to", "My links", () => a.go("/#links"), "", "made shared list");
  // Reminders: what's next first, then what's passed or kept, most recent first.
  const at = x => (x.replanAt > now ? x.replanAt : x.start);
  const recs = a.recs.filter(x => x.state !== "dropped").sort((x, y) => {
    const fx = at(x) >= now && x.state !== "kept", fy = at(y) >= now && y.state !== "kept";
    return fx !== fy ? (fx ? -1 : 1) : fx ? at(x) - at(y) : at(y) - at(x);
  });
  for (const x of recs) add("Reminders", x.title, () => a.go(x.share), x.state === "kept" ? "Done" : a.when(at(x)));
  const mine = new Set(recs.map(x => x.share));
  const links = a.links.filter(x => !mine.has(x.share)).sort((x, y) => (x.start >= now) !== (y.start >= now) ? (x.start >= now ? -1 : 1) : Math.abs(x.start - now) - Math.abs(y.start - now));
  for (const x of links) add("Links", x.title, () => a.go(x.share), a.when(x.start) + (x.private ? " · private" : ""));
  for (const t of ["auto", "light", "dark"]) add("Settings", t === "auto" ? "Theme: follow the system" : "Theme: " + t[0].toUpperCase() + t.slice(1), () => a.setTheme(t), a.theme === t ? "On" : "", "appearance mode colour color");
  add("Settings", a.sound ? "Turn the sound off" : "Turn the sound on", () => a.setSound(!a.sound), "", "chime mute audio");
  add("Settings", a.accountLabel, a.account, "", "account login log in passkey email sync devices");
  if (a.install) add("Settings", "Install app", a.install, "", "home screen add");
  for (const [label, href] of a.pages) {
    const u = new URL(href, "https://" + a.host), out = u.host !== a.host;
    add("Pages", label, () => (out ? window.open(u.href, "_blank", "noopener") : location.assign(u.pathname)), "", ALSO[out ? "out" : u.pathname] || "");
  }
  return list;
}

/** What to show for what's typed: every word has to match. Matching nothing offers to make it a reminder. */
export function pick(items, q, newOne) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter(i => !i.more);
  const hits = items.filter(i => words.every(w => i.words.includes(w))).slice(0, 60);
  const make = { group: "Make", label: "New reminder: " + q.trim(), run: () => newOne(q.trim()), hint: "", words: "" };
  return hits.length ? [...hits, make] : [make];
}

let api = null, items = [], shown = [], active = 0;

function render() {
  let html = "", g = "";
  shown.forEach((it, i) => {
    if (it.group !== g) { g = it.group; html += '<div class="pal-g" role="presentation">' + esc(g) + "</div>"; }
    html += '<div class="pal-o" role="option" id="pal-' + i + '" data-i="' + i + '" aria-selected="' + (i === active) + '"><span>' + esc(it.label) + "</span>" + (it.hint ? "<i>" + esc(it.hint) + "</i>" : "") + "</div>";
  });
  $("#pal-list").innerHTML = html;
  mark();
}
function mark(scroll) {
  const list = $("#pal-list");
  list.querySelectorAll('[aria-selected="true"]').forEach(o => o.setAttribute("aria-selected", "false"));
  const o = list.querySelector("#pal-" + active);
  if (o) { o.setAttribute("aria-selected", "true"); if (scroll) o.scrollIntoView({ block: "nearest" }); }
  $("#pal-in").setAttribute("aria-activedescendant", o ? o.id : "");
}
function update() { shown = pick(items, $("#pal-in").value, api.newOne); active = 0; render(); $("#pal-list").scrollTop = 0; }
function run(i) { const it = shown[i]; if (!it) return; close(); it.run(); }
function close() { const s = $("#pal"); if (s) s.hidden = true; }

function ensure() {
  if ($("#pal")) return Promise.resolve();
  const s = document.createElement("div");
  s.className = "sheet pal"; s.id = "pal"; s.hidden = true;
  s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true"); s.setAttribute("aria-label", "Search and commands");
  s.innerHTML = '<div class="sheet-card pal-card">' +
    '<input id="pal-in" class="pal-in" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Search, or type a command" aria-label="Search your reminders, or type a command">' +
    '<div class="pal-list" id="pal-list" role="listbox" aria-label="Results"></div>' +
    '<p class="pal-keys"><span><kbd>↑</kbd><kbd>↓</kbd>move</span><span><kbd>Enter</kbd>open</span><span><kbd>Esc</kbd>close</span></p></div>';
  document.body.append(s);
  const input = $("#pal-in"), list = $("#pal-list");
  input.addEventListener("input", update);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) { active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length; mark(true); }
    } else if (e.key === "Enter") { e.preventDefault(); run(active); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  list.addEventListener("mousemove", e => { const o = e.target.closest(".pal-o"); if (o && +o.dataset.i !== active) { active = +o.dataset.i; mark(); } });
  list.addEventListener("click", e => { const o = e.target.closest(".pal-o"); if (o) run(+o.dataset.i); });
  s.addEventListener("click", e => { if (e.target === s) close(); });
  // Its stylesheet comes with it; wait for it so the palette never shows unstyled.
  return new Promise(done => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/palette.css";
    l.addEventListener("load", done); l.addEventListener("error", done);
    document.head.append(l);
  });
}

/** Opens the palette, or closes it if it's open (Ctrl or Cmd + K again). */
export async function open(a) {
  const s = $("#pal");
  if (s && !s.hidden) return close();
  api = a; items = commands({ ...a, ...fromPage() });
  await ensure();
  $("#pal-in").value = "";
  update();
  $("#pal").hidden = false;
  $("#pal-in").focus();
}
