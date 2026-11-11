/* remmynd smart paste: when a long paste (an email, an invitation) or an image (a poster, a
 * screenshot) lands in the bar, offer to read it with the browser's own on-device AI (the Prompt
 * API, LanguageModel). It runs on this device: the text or image is never sent anywhere. app.js loads
 * this only on such a paste, and only where the browser has the API. The answer becomes one line in
 * the bar ("Quarterly review 2026-12-05 18:00 for 90 min at Studio 4"), which the app reads like
 * anything typed, so the live preview shows what was found and nothing is made until Enter. */

const MAX_TEXT = 6000;
const SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

/** What the model has to answer: the one event, as plain fields. */
export const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "What it is, in a few words" },
    date: { type: "string", description: "YYYY-MM-DD, or empty" },
    time: { type: "string", description: "HH:mm, 24-hour, as written, or empty" },
    time_zone: { type: "string", description: "IANA time zone the time is written in, if the text says, or empty" },
    duration_minutes: { type: "integer", minimum: 0, maximum: 1440 },
    place: { type: "string", description: "Meeting link or place, or empty" }
  },
  required: ["title", "date", "time", "time_zone", "duration_minutes", "place"],
  additionalProperties: false
};

/** The instructions, with today's date and the reader's zone so "next Friday" can be read. */
export function instructions(now, timeZone) {
  const today = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  return "You read emails, invitations and posters and find the one event in them. Today is " + today + " and the reader's time zone is " + timeZone + ". " +
    "Answer with its title (a few words saying what it is), its date (YYYY-MM-DD), its start time as written (HH:mm, 24-hour), the IANA time zone that time is written in if the text says so, " +
    "its length in minutes if stated (otherwise 0), and its meeting link or place. Leave a field empty when the text doesn't say. Never invent a date or time.";
}

const pad = n => String(n).padStart(2, "0");
const clean = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const validZone = z => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };

/** The model's answer as one line for the bar, in the reader's zone. found: whether it had a date. */
export function lineFrom(r, timeZone, zonedTime) {
  r = r && typeof r === "object" ? r : {};
  const title = clean(r.title, 120), place = clean(r.place, 300);
  let dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(r.date, 10));
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clean(r.time, 5));
  // Only a real calendar date counts: no 13th month, no 31 November.
  if (dm && !(+dm[2] >= 1 && +dm[2] <= 12 && +dm[3] >= 1 && +dm[3] <= new Date(Date.UTC(+dm[1], +dm[2], 0)).getUTCDate())) dm = null;
  let when = "";
  if (dm) {
    let [y, mo, d] = [+dm[1], +dm[2], +dm[3]], h = tm ? +tm[1] : 0, mi = tm ? +tm[2] : 0;
    const zone = clean(r.time_zone, 64);
    // A time written in another zone ("6 PM ET") is moved into the reader's own.
    if (tm && zone && zone !== timeZone && validZone(zone)) {
      const p = {};
      for (const x of new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(zonedTime(y, mo, d, h, mi, zone))) p[x.type] = x.value;
      [y, mo, d, h, mi] = [+p.year, +p.month, +p.day, +p.hour % 24, +p.minute];
    }
    when = y + "-" + pad(mo) + "-" + pad(d) + (tm ? " " + pad(h) + ":" + pad(mi) : "");
  }
  const dur = Number.isInteger(r.duration_minutes) && r.duration_minutes > 0 && r.duration_minutes <= 1440 ? "for " + r.duration_minutes + " min" : "";
  const where = place ? (/^https?:\/\//i.test(place) || /^[\w-]+(\.[\w-]+)+\//.test(place) ? place : "at " + place) : "";
  return { line: [title, when, dur, where].filter(Boolean).join(" "), found: !!dm };
}

const $ = s => document.querySelector(s);
const close = () => { const el = $("#sp"); if (el) el.remove(); };

/** Offer to read a paste. Called by app.js with the pasted text or image, and what it needs back. */
export async function offer({ text = "", image = null, form, put, toast, R, timeZone }) {
  const LM = self.LanguageModel;
  if (!LM) return;
  const opts = { expectedInputs: [{ type: "text", languages: ["en"] }, ...(image ? [{ type: "image" }] : [])], expectedOutputs: [{ type: "text", languages: ["en"] }] };
  let ready;
  try { ready = await LM.availability(opts); } catch (e) { return; }
  if (ready === "unavailable") { if (image) toast("This browser can't read images. Paste the text instead."); return; }
  if (!$('link[href="/smartpaste.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/smartpaste.css"; document.head.append(l); }
  close();
  const el = document.createElement("div");
  el.className = "sp"; el.id = "sp"; el.setAttribute("role", "group"); el.setAttribute("aria-label", "Smart paste");
  el.innerHTML = '<button type="button" class="sp-go">' + SPARK + '<span>' + (image ? "Read this image with on-device AI" : "Read it with on-device AI") + '</span></button>' +
    '<span class="sp-sub" role="status">Runs on this device. Nothing is sent anywhere.' + (ready === "available" ? "" : " The first time, your browser downloads its model.") + '</span>' +
    '<button type="button" class="sp-x" aria-label="Not now">×</button>';
  form.insertBefore(el, form.querySelector(".cap-bar"));
  el.querySelector(".sp-x").addEventListener("click", close);
  el.querySelector(".sp-go").addEventListener("click", async () => {
    const go = el.querySelector(".sp-go"), sub = el.querySelector(".sp-sub");
    go.disabled = true; sub.textContent = "Reading it on this device…";
    let session;
    try {
      session = await LM.create({
        ...opts,
        initialPrompts: [{ role: "system", content: instructions(new Date(), timeZone) }],
        monitor(m) { m.addEventListener("downloadprogress", e => { sub.textContent = "Downloading the model, once: " + Math.round((e.loaded || 0) * 100) + "%"; }); }
      });
      const content = [{ type: "text", value: text ? text.slice(0, MAX_TEXT) : "Find the event on this poster or screenshot." }, ...(image ? [{ type: "image", value: image }] : [])];
      const answer = await session.prompt([{ role: "user", content }], { responseConstraint: SCHEMA });
      const { line, found } = lineFrom(JSON.parse(answer), timeZone, R.zonedTime);
      close();
      if (line) put(line);
      toast(found ? "Read on this device. Check it, then press Enter." : "No date found in it. Add one in the bar.");
    } catch (e) {
      go.disabled = false; sub.textContent = "That didn't work this time. Try again, or type it in.";
    } finally { if (session) session.destroy(); }
  });
}
