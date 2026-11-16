/* Host pages: keep each launch's clock ticking, switch it to "Live now" at the start and to "This launch has
 * happened" at the end, show the time in the visitor's own zone, and share the page. The server drew all of it
 * first, so without this script the page is still right when it loaded. */
const two = n => String(n).padStart(2, "0");
const launches = [...document.querySelectorAll(".at-launch[data-start]")];

function tick() {
  const now = Date.now();
  let soonest = 1000;
  for (const el of launches) {
    const start = +el.dataset.start, end = +el.dataset.end;
    const phase = now >= end ? "ended" : now >= start ? "live" : "before";
    if (el.dataset.phase !== phase) {
      el.dataset.phase = phase;
      // On the host's page, the label over the next launch says so when it goes live.
      const label = el.closest("section") && el.closest("section").querySelector("#at-next");
      if (label) label.textContent = phase === "live" ? "Live now" : phase === "ended" ? "Just happened" : "Next";
    }
    if (phase !== "before") continue;
    const t = Math.max(0, Math.ceil((start - now) / 1000));
    const v = { d: Math.floor(t / 86400), h: Math.floor(t % 86400 / 3600), m: Math.floor(t % 3600 / 60), s: t % 60 };
    for (const k of "dhms") { const b = el.querySelector('[data-u="' + k + '"]'); const s = k === "d" ? String(v.d) : two(v[k]); if (b && b.textContent !== s) b.textContent = s; }
    soonest = Math.min(soonest, (start - now) % 1000 || 1000);
  }
  setTimeout(tick, soonest + 5);
}
if (launches.length) tick();

/* The time in the visitor's own zone: "Fri, Dec 4 · 7:30 PM EST". */
for (const t of document.querySelectorAll(".at-wrap time[datetime]")) {
  const d = new Date(t.getAttribute("datetime"));
  if (isNaN(d)) continue;
  const thisYear = d.getFullYear() === new Date().getFullYear();
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) }).format(d);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  t.textContent = day + " · " + time;
}

/* Share: the phone's share sheet, or the link copied. */
for (const b of document.querySelectorAll(".at-share")) {
  b.addEventListener("click", async () => {
    const url = b.dataset.url, title = b.dataset.title;
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); b.textContent = "Link copied"; } catch (e) { b.textContent = url; }
    setTimeout(() => (b.textContent = "Share"), 2400);
  });
}
