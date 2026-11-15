/* remmynd embed: the reminder card other sites show in an iframe. The Worker draws the card in
 * the host's time zone, with the countdown's first value; this shows the time in the visitor's own
 * zone instead, keeps the countdown current (every second inside 48 hours, every 30 seconds before)
 * and keeps the moment ring's state current (Soon in the last hour, Now while it runs, then Ended), keeping
 * the public count's outer rings when the host turned the count on. */
import { ringSVG, ringLabel } from "/ring.js";
import { countdown, nextTick } from "/clock.js";

const card = document.querySelector(".em:not(.em-launch)");
if (card) {
  let start = +card.dataset.start, end = +card.dataset.end;
  // The example card on For hosts: next Friday at 5 PM, in the visitor's zone.
  if (card.hasAttribute("data-example")) {
    const d = new Date(); d.setDate(d.getDate() + ((12 - d.getDay()) % 7 || 7)); d.setHours(17, 0, 0, 0);
    start = d.getTime(); end = start + 36e5;
  }
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const left = card.querySelector(".em-left");
  let shown = "";
  const paint = () => {
    const now = Date.now(), d = new Date(start);
    const state = now >= end ? "missed" : now >= start ? "now" : start - now <= 36e5 ? "soon" : "open";
    if (left) left.textContent = countdown(start, end, now);
    card.querySelector(".em-when").textContent = day.format(d) + ", " + time.format(d);
    const key = state + d.getHours() + ":" + d.getMinutes();
    if (key !== shown) {
      shown = key;
      const old = card.querySelector(".ring"), box = document.createElement("span");
      const size = old ? +old.getAttribute("width") || 52 : 52;
      box.innerHTML = ringSVG({ h: d.getHours(), m: d.getMinutes(), state, size, label: ringLabel(d.getHours(), d.getMinutes(), state) });
      // The public count's outer rings, drawn by the Worker, stay on the new ring.
      if (old && box.firstElementChild) { box.firstElementChild.append(...old.querySelectorAll(".r-count")); old.replaceWith(box.firstElementChild); }
    }
    setTimeout(paint, nextTick(start, end, Date.now()));
  };
  paint();
}

/* The launch countdown (?size=launch): days, hours, minutes and seconds, every second, then Live now and Ended. */
const launch = document.querySelector(".em-launch");
if (launch) {
  let start = +launch.dataset.start, end = +launch.dataset.end;
  if (launch.hasAttribute("data-example")) {
    const d = new Date(); d.setDate(d.getDate() + ((12 - d.getDay()) % 7 || 7)); d.setHours(17, 0, 0, 0);
    start = d.getTime(); end = start + 36e5;
  }
  const when = launch.querySelector(".em-when"), clock = launch.querySelector(".el-clock"), live = launch.querySelector(".el-live");
  const u = k => launch.querySelector('[data-u="' + k + '"]'), two = n => String(n).padStart(2, "0");
  when.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(start));
  const tick = () => {
    const now = Date.now();
    if (now >= start) {
      clock.hidden = true; live.hidden = false; live.textContent = now >= end ? "Ended" : "Live now";
      if (now < end) setTimeout(tick, end - now + 50);
      return;
    }
    const t = Math.ceil((start - now) / 1000), d = Math.floor(t / 86400);
    u("d").textContent = d; u("d").nextElementSibling.textContent = d === 1 ? "day" : "days";
    u("h").textContent = two(Math.floor(t % 86400 / 3600)); u("m").textContent = two(Math.floor(t % 3600 / 60)); u("s").textContent = two(t % 60);
    setTimeout(tick, ((start - now) % 1000) || 1000);
  };
  tick();
}
