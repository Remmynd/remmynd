/* The Pro page (/pro): the plans, the early bird and its countdown, from /api/pro (worker/pro.js). Get Pro opens the
 * site's own account sheet (account.js), which signs people in and sends them to Polar's checkout with the early bird
 * applied by the server. Inside the iPhone app the website never sells Pro: the app's Settings does, through Apple. */
const $ = s => document.getElementById(s);
const IN_APP = !!window.__rmNative;
let P = null, tick = 0;

const left = ms => {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
  return d ? d + "d " + h + "h " + mm + "m" : h ? h + "h " + mm + "m" : mm + "m";
};
const day = ms => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
const show = (id, on) => { $(id).hidden = !on; };

function render() {
  const p = P || {}, e = p.early;
  if (p.plans) { $("pro-y").textContent = p.plans.yearly.price; $("pro-m").textContent = p.plans.monthly.price; $("pro-y-was").textContent = p.plans.yearly.price; $("pro-m-was").textContent = p.plans.monthly.price; }
  if (e && e.until > Date.now()) {
    show("pro-early", true); show("pro-y-was", true); show("pro-m-was", true);
    $("pro-left").textContent = "Ends " + day(e.until) + ", in " + left(e.until - Date.now()) + ".";
    $("pro-y").textContent = e.yearly; $("pro-y-per").textContent = "for your first year";
    $("pro-y-then").textContent = "Then " + p.plans.yearly.price + " a year.";
    $("pro-m").textContent = e.monthly; $("pro-m-per").textContent = "a month for " + e.months + " months";
    $("pro-m-then").textContent = "Then " + p.plans.monthly.price + " a month. Cancel any time.";
  } else {
    show("pro-early", false); show("pro-y-was", false); show("pro-m-was", false);
  }
  if (p.trialOpen === false) $("pro-trial").textContent = "Cancel any time. Payment is handled by Polar.";
  const note = IN_APP ? "In the iPhone app, get Pro in the app's Settings tab." : p.pro ? "Pro is on for your account. Thank you." : p.signedIn && !p.offer ? "Pro isn't open for your account yet." : !p.web && P ? "Paying on the website isn't available right now." : "";
  $("pro-note").textContent = note; show("pro-note", !!note);
  $("pro-get").textContent = p.pro ? "Manage Pro" : "Get Pro";
  $("pro-get").hidden = IN_APP || (!!P && !p.web && !p.pro);
}

async function load() {
  try { const r = await fetch("/api/pro", { credentials: "same-origin" }); P = r.ok ? await r.json() : null; } catch (e) { P = null; }
  render();
}

$("pro-get").addEventListener("click", () => import("/account.js").then(m => m.open()).catch(() => location.assign("/")));
load();
// The countdown moves once a minute; the plans are asked again every ten, so the page is right when the offer ends.
setInterval(() => { tick++; if (tick % 10 === 0) load(); else render(); }, 60000);
