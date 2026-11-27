// /pricing: the Monthly / Yearly switch, the launch code, and the way into checkout.
// Prices are the server's (worker/pro.js PLANS, checked against this page by the tests). The launch offer shows only when
// /api/pro says it's on offer; the code is kept for this visit (sessionStorage rm:code), as the account sheet keeps it.
const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const KEY = "rm:code";
let bill = "yearly", launch = null, yearly = "$79.99";
const code = () => { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; } };
const keep = c => { try { sessionStorage.setItem(KEY, c); } catch (e) {} };
const half = p => "$" + (Math.round(parseFloat(p.slice(1)) * 50) / 100).toFixed(2);

const q = new URLSearchParams(location.search).get("code");
if (q) keep(q.replace(/\s+/g, "").toUpperCase().slice(0, 24));

function show() {
  $$("[data-bill]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.bill === bill)));
  $$("[data-price]").forEach(p => { p.hidden = p.dataset.price !== bill; });
  const coded = !!launch && bill === "yearly" && code() === launch.code;
  const c = $("#coded");
  c.hidden = !coded;
  if (coded) c.textContent = "Code " + launch.code + ": " + half(yearly) + " for your first year, then " + yearly + " a year.";
  const offer = $("#offer");
  offer.hidden = !launch;
  if (launch) $("#offer-use").hidden = code() === launch.code;
  const href = "/?pro=" + bill + (coded ? "&code=" + encodeURIComponent(launch.code) : "");
  $("#get-pro").setAttribute("href", href);
}
$$("[data-bill]").forEach(b => b.addEventListener("click", () => { bill = b.dataset.bill; show(); }));
$("#offer-use").addEventListener("click", () => { if (launch) { keep(launch.code); bill = "yearly"; show(); } });

fetch("/api/pro", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null).then(p => {
  if (!p) return;
  launch = p.launch || null;
  if (p.plans && p.plans.yearly) yearly = p.plans.yearly.price;
  show();
}).catch(() => {});
show();
