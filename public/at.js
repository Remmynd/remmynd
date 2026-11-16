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

/* Follow: notifications in this browser (an anonymous push address, as for alerts), the account when signed in, or
 * both. In the iPhone app, the app shows followed hosts' launches in Today. worker/follows.js keeps who follows whom. */
const KNOWN = "rm:follows";
const known = () => { try { return JSON.parse(localStorage.getItem(KNOWN) || "[]"); } catch (e) { return []; } };
const remember = (h, on) => { try { const k = known().filter(x => x !== h); if (on) k.push(h); localStorage.setItem(KNOWN, JSON.stringify(k)); } catch (e) {} };
const IN_APP = !!window.__rmNative;
const canPush = !IN_APP && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const post = async (path, body) => { const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || "Couldn't do that. Try again."), { need: j.need }); return j; };
const b64key = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function pushEndpoint(ask) {
  if (!canPush) return null;
  const perm = ask && Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (perm !== "granted") return null;
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && ask) { const k = await fetch("/push/key").then(r => r.json()); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(k.key) }); }
  return sub ? sub.endpoint : null;
}
const followButtons = [...document.querySelectorAll(".at-follow")];
function show(b, on, n) {
  b.setAttribute("aria-pressed", on ? "true" : "false");
  const c = b.parentElement.querySelector(".at-followers");
  if (c && n != null) { c.dataset.n = n; c.textContent = n ? n.toLocaleString("en-US") + (n === 1 ? " follower" : " followers") : ""; }
}
function say(b, html) { const p = b.parentElement.querySelector(".at-follow-note"); if (p) { p.innerHTML = html; p.hidden = !html; } return p; }
const escT = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
for (const b of followButtons) {
  if (known().includes(b.dataset.handle)) show(b, true);
  b.addEventListener("click", async () => {
    const h = b.dataset.handle, name = b.dataset.name, on = b.getAttribute("aria-pressed") === "true";
    b.disabled = true;
    try {
      if (on) {
        const r = await post("/api/unfollow", { handle: h, endpoint: await pushEndpoint(false).catch(() => null) });
        remember(h, false); show(b, false, r.count); say(b, "");
      } else {
        const endpoint = await pushEndpoint(true).catch(() => null);
        let r;
        try { r = await post("/api/follow", { handle: h, endpoint }); }
        catch (e) {
          if (e.need !== "signin") throw e;
          if (IN_APP) { r = { following: true, signedIn: false }; } // the app follows on this phone, and shows their launches in Today
          else { say(b, escT(canPush ? "Turn on notifications for remmynd to follow, or sign in to follow by email." : "This browser can't show notifications. Sign in to follow by email.") + ' <button type="button" class="btn at-signin">Sign in</button>');
            const si = b.parentElement.querySelector(".at-signin"); if (si) si.addEventListener("click", () => import("/account.js").then(m => m.open()).catch(() => location.assign("/")));
            return; }
        }
        remember(h, true); show(b, true, r.count);
        if (r.signedIn && !r.email) {
          const p = say(b, escT("Following. You'll hear when " + name + " announces or goes live.") + ' <button type="button" class="btn at-mail">Email me too</button>');
          p.querySelector(".at-mail").addEventListener("click", async e => { e.target.disabled = true; try { await post("/api/follow", { handle: h, endpoint, email: true }); say(b, escT("Following. We'll also email you when " + name + " announces.")); } catch (x) { say(b, escT(x.message)); } });
        } else if (r.email) say(b, escT("Following. We'll email you when " + name + " announces a launch."));
        else say(b, escT(IN_APP ? "Following. Their launches show in Today, and the app tells you when one goes live." : "Following. You'll hear when " + name + " announces or goes live."));
      }
    } catch (e) { say(b, escT(e.message)); }
    finally { b.disabled = false; }
  });
}
/* What the server says this browser or account follows, and the counts, once the page is up. */
if (followButtons.length) (async () => {
  const endpoint = await pushEndpoint(false).catch(() => null);
  const r = await post("/api/follow/state", { handles: followButtons.map(b => b.dataset.handle), endpoint }).catch(() => null);
  if (!r || !r.hosts) return;
  for (const b of followButtons) { const st = r.hosts[b.dataset.handle]; if (!st) continue; if (st.own) { b.hidden = true; say(b, 'This is your page. <a href="/host">Edit it</a>'); continue; }
    const on = st.following || (IN_APP && known().includes(b.dataset.handle)); if (!IN_APP) remember(b.dataset.handle, st.following); show(b, on, st.count); }
})();
