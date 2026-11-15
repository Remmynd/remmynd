/* The launch kit (/launch): one line in, a launch countdown out. The link is made here, on this device, with the same
 * library as the rest of the site (remmynd.js); nothing is sent anywhere to make it. The preview is the real card,
 * drawn from the link. The link is kept in My links on this device, so its count shows there and in the app. */
import * as R from "/remmynd.js";

const $ = s => document.querySelector(s);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const BASE = location.origin + "/";
const F = { form: $("#lk-form"), line: $("#lk-line"), host: $("#lk-host"), count: $("#lk-count"), read: $("#lk-read"), frame: $("#lk-frame") };
const fmt = d => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
const short = u => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

function read() {
  const line = F.line.value.trim();
  if (!line) { F.read.textContent = "Try “Demo day Fri 5pm lu.ma/demo”."; F.read.classList.remove("bad"); return null; }
  const p = R.parse(line, { timeZone: TZ });
  const bad = !p.title ? "Say what it is, like “Demo day Fri 5pm”." : !p.start ? "Add a day and time, like “Fri 5pm”." : p.start.getTime() <= Date.now() ? "That time has passed. Pick a later one." : "";
  F.read.classList.toggle("bad", !!bad);
  F.read.textContent = bad || [p.title, fmt(p.start), p.repeat ? R.describeRepeat(p.repeat) : "", short(p.place)].filter(Boolean).join(" · ");
  return bad ? null : p;
}

async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); const was = button.textContent; button.textContent = "Copied"; setTimeout(() => (button.textContent = was), 1600); }
  catch (e) { button.textContent = "Select and copy"; }
}

function snippet(title, about, code, extra = "") {
  const box = document.createElement("div");
  box.className = "lk-snip";
  box.innerHTML = "<h3></h3><p></p><pre><code></code></pre><div class=\"btns\"><button type=\"button\" class=\"btn small\">Copy</button>" + extra + "</div>";
  box.querySelector("h3").textContent = title;
  box.querySelector("p").textContent = about;
  box.querySelector("code").textContent = code;
  box.querySelector("button").addEventListener("click", e => copy(code, e.currentTarget));
  return box;
}

/* The countdown's code for other sites' pages, sized as embedHTML() sizes the small card. It's text to copy, never put in this page. */
function launchSnippet(src, title) {
  return '<iframe src="' + src + '" title="Countdown: ' + title.replace(/"/g, "&quot;") + '" width="560" height="400" style="width:100%;max-width:560px;border:0" loading="lazy"></iframe>';
}

async function make(e) {
  e.preventDefault();
  const p = read();
  if (!p) { F.line.focus(); return; }
  const ev = { title: p.title, start: p.start, durationMinutes: p.dur || 60, location: p.place || "", host: F.host.value.trim(), timeZone: TZ, count: F.count.checked, repeat: p.repeat || undefined };
  let link;
  try { link = R.createLink(ev, { base: BASE }); } catch (err) { F.read.textContent = err.message; F.read.classList.add("bad"); return; }
  const code = link.slice(link.lastIndexOf("/r/") + 3);
  const launch = BASE + "embed/" + code + "?size=launch";
  F.frame.src = launch;

  $("#lk-title").textContent = p.title;
  const a = $("#lk-link"); a.href = link; a.textContent = short(link);
  $("#lk-copy-link").onclick = e2 => copy(link, e2.currentTarget);
  const grid = $("#lk-grid"); grid.textContent = "";
  grid.append(
    snippet("Launch countdown", "For your landing page: days, hours, minutes and seconds, Remind me and Add to calendar.", launchSnippet(launch, p.title)),
    snippet("Small card", "One line high, for a sidebar, a docs page or a footer.", R.embedHTML(link)),
    snippet("Live badge", "A picture that counts down, for READMEs, forums and newsletters.", R.liveBadgeHTML(link)),
    snippet("Badge, Markdown", "For GitHub, Notion and anywhere that takes Markdown.", R.liveBadgeMarkdown(link)),
    snippet("Discord", "Discord shows the time as a countdown in each reader's own zone.", R.discordLine(link)));
  // A QR code for slides and posters, drawn on this device.
  try {
    const qr = await import("/qr.js");
    const box = document.createElement("div");
    box.className = "lk-snip lk-qr";
    box.innerHTML = "<h3>QR code</h3><p>For slides, posters and the last slide of a talk.</p><div></div><div class=\"btns\"><button type=\"button\" class=\"btn small\">Download PNG</button></div>";
    box.children[2].innerHTML = qr.qrSVG(link, { label: "QR code for " + p.title });
    box.querySelector("button").addEventListener("click", async () => {
      const blob = await qr.qrPNG(link), u = URL.createObjectURL(blob), dl = document.createElement("a");
      dl.href = u; dl.download = (p.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "launch") + "-qr.png";
      document.body.append(dl); dl.click(); dl.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000);
    });
    grid.append(box);
  } catch (err) {}
  $("#lk-out").hidden = false;
  $("#lk-out").scrollIntoView({ behavior: "smooth", block: "start" });
  // Kept in My links on this device, where its count shows.
  try { await window.remmyndDB.put("links", { share: link, title: p.title, start: p.start.getTime(), createdAt: Date.now(), private: false, launch: true }); } catch (err) {}
}

F.line.addEventListener("input", read);
F.form.addEventListener("submit", make);
const q = new URLSearchParams(location.search).get("t");
if (q) { F.line.value = q; read(); }
