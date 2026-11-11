/* remmynd embed: the reminder card other sites show in an iframe. The Worker draws the card in
 * the host's time zone; this shows the time in the visitor's own zone instead, and keeps the moment
 * ring's state current (Soon in the last hour, Now while it runs, then Ended). */
import { ringSVG, ringLabel } from "/ring.js";

const card = document.querySelector(".em");
if (card) {
  let start = +card.dataset.start, end = +card.dataset.end;
  // The example card on For hosts: next Friday at 5 PM, in the visitor's zone.
  if (card.hasAttribute("data-example")) {
    const d = new Date(); d.setDate(d.getDate() + ((12 - d.getDay()) % 7 || 7)); d.setHours(17, 0, 0, 0);
    start = d.getTime(); end = start + 36e5;
  }
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  let shown = "";
  const paint = () => {
    const now = Date.now(), d = new Date(start);
    const state = now >= end ? "missed" : now >= start ? "now" : start - now <= 36e5 ? "soon" : "open";
    card.querySelector(".em-when").textContent = (state === "now" ? "Live now · " : state === "missed" ? "Ended · " : "") + day.format(d) + ", " + time.format(d);
    const key = state + d.getHours() + ":" + d.getMinutes();
    if (key === shown) return;
    shown = key;
    const old = card.querySelector(".ring"), box = document.createElement("span");
    box.innerHTML = ringSVG({ h: d.getHours(), m: d.getMinutes(), state, size: 52, label: ringLabel(d.getHours(), d.getMinutes(), state) });
    if (old && box.firstElementChild) old.replaceWith(box.firstElementChild);
  };
  paint();
  setInterval(paint, 30000);
}
