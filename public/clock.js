/* remmynd clock: what a countdown says, the same on the live badge, the reminder card and the
 * screen. More than 48 hours away: "in 12 days". Under 48 hours: "1d 04:12:09", then "04:12:09"
 * under a day. From the start: "Live now". After the end: "Ended". The Worker imports this to
 * write the first value; the card's script imports it to keep the value current. */

const HOUR = 3600, DAY = 86400;
const two = n => String(n).padStart(2, "0");

/** What the clock shows with `left` seconds to go. A digit changes the instant its second is used up: 37.4 s left shows :37, 37.0 s shows :36. */
export function clockText(left) {
  if (left > 2 * DAY) return "in " + Math.round(left / DAY) + " days";
  const t = Math.max(0, Math.ceil(left) - 1), d = Math.floor(t / DAY);
  return (d ? d + "d " : "") + two(Math.floor(t % DAY / HOUR)) + ":" + two(Math.floor(t % HOUR / 60)) + ":" + two(t % 60);
}

/** The countdown for a reminder from `start` to `end` (ms), seen at `now` (ms). */
export function countdown(start, end, now = Date.now()) {
  return now >= end ? "Ended" : now >= start ? "Live now" : clockText((start - now) / 1000);
}

/**
 * How long until the countdown next changes (ms). Inside 48 hours, the next second; otherwise every
 * 30 seconds, or sooner when the 48-hour mark, the start or the end comes first.
 */
export function nextTick(start, end, now = Date.now()) {
  const left = start - now;
  if (left > 0 && left <= 2 * DAY * 1000) return (left % 1000 || 1000) + 5;
  const edges = [start - 2 * DAY * 1000, start, end].map(t => t - now).filter(t => t > 0);
  return Math.min(30000, ...edges.map(t => t + 5));
}
