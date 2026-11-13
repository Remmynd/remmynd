/* remmynd app: the maker, the ticket and routing. Loaded as an ES module by index.html.
 * The library (remmynd.js) reads typed lines and makes links, so the site and the npm package agree. */
import * as R from "/remmynd.js";
import { ringSVG, ringLabel } from "/ring.js";
const $=s=>document.querySelector(s);
const TZ=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
const OWN=/(^|\.)remmynd\.space$|\.workers\.dev$|\.pages\.dev$|^localhost$|^127\./.test(location.hostname);
const BASE=OWN?location.origin+"/":"https://remmynd.space/";

/* ---------- link encoding: the link is the database ---------- */
const enc=o=>{const b=new TextEncoder().encode(JSON.stringify(o));let s="";b.forEach(x=>s+=String.fromCharCode(x));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");};
const dec=s=>{try{const bin=atob(s.replace(/-/g,"+").replace(/_/g,"/"));const o=JSON.parse(new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))));return o&&typeof o.t==="string"&&o.t&&o.s?o:null;}catch(e){return null;}};
const startOf=r=>/T/.test(String(r.s))?new Date(r.s):new Date(parseInt(r.s,36)*6e4);
const pack=d=>Math.round(d.getTime()/6e4).toString(36);
/* Shared links (/r/) let chat apps preview the title and time. Private links (/#) never reach a server. */
const linkFor=(r,key,priv)=>key?BASE+key:BASE+(priv?"#":"r/")+enc(r);

/* ---------- time ---------- */
function parts(date,tz){const g={};new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}).formatToParts(date).forEach(x=>g[x.type]=x.value);return{y:+g.year,mo:+g.month,d:+g.day,h:(+g.hour)%24,mi:+g.minute,s:+g.second};}
function offsetMin(date,tz){const p=parts(date,tz);return(Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi,p.s)-Math.floor(date.getTime()/1000)*1000)/6e4;}
function zonedToUTC(y,mo,d,h,mi,tz){const guess=Date.UTC(y,mo-1,d,h,mi);let off=offsetMin(new Date(guess),tz);off=offsetMin(new Date(guess-off*6e4),tz);return new Date(guess-off*6e4);}
function morningOf(start,tz){const p=parts(start,tz);let m=zonedToUTC(p.y,p.mo,p.d,9,0,tz);if(m<=start)m=zonedToUTC(p.y,p.mo,p.d+1,9,0,tz);return m;}
const fDate=(d,tz)=>new Intl.DateTimeFormat(undefined,{timeZone:tz,weekday:"short",day:"numeric",month:"short"}).format(d);
const fShort=(d,tz)=>new Intl.DateTimeFormat(undefined,{timeZone:tz,hour:"numeric",minute:"2-digit"}).format(d);
function fTime(d,tz){let main="",per="";new Intl.DateTimeFormat(undefined,{timeZone:tz,hour:"numeric",minute:"2-digit"}).formatToParts(d).forEach(x=>{if(x.type==="dayPeriod")per=x.value;else main+=x.value;});return{main:main.trim(),per};}
const fZone=(d,tz)=>{const p=new Intl.DateTimeFormat("en-US",{timeZone:tz,timeZoneName:"short"}).formatToParts(d).find(x=>x.type==="timeZoneName");return p?p.value:"";};
/* Browsers still report a few old zone names (Asia/Calcutta); show today's city names. */
const CITY={Calcutta:"Kolkata",Saigon:"Ho Chi Minh",Kiev:"Kyiv",Katmandu:"Kathmandu",Rangoon:"Yangon"};
const city=tz=>{const c=(tz.split("/").pop()||tz).replace(/_/g," ");return CITY[c]||c;};
const pad=n=>String(n).padStart(2,"0");
const isHttp=s=>/^https?:\/\//i.test(s||"");
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* Named pages: remmynd.space/<name>. Each returns a reminder object. */
/* Named examples, by the address after #. A Map, so only these names match (never #constructor). */
const PRESETS=new Map(Object.entries({
  example:()=>{const p=parts(new Date(Date.now()+3*864e5),TZ);return{t:"Example: launch day",s:pack(zonedToUTC(p.y,p.mo,p.d,18,0,TZ)),d:60,l:"https://remmynd.space",n:"This is a sample reminder. Make your own in a few seconds."};}
}));
/* ---------- calendar payloads (credit lives in the description; nothing about the viewer is included) ---------- */
const stamp=d=>d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
const iesc=s=>String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
const te=new TextEncoder();
function fold(l){const out=[];let cur="",n=0;for(const ch of l){const b=te.encode(ch).length;if(n+b>73){out.push(cur);cur=" ";n=1;}cur+=ch;n+=b;}out.push(cur);return out.join("\r\n");}
function hash(s){let h=5381;for(const c of s)h=(h*33)^c.charCodeAt(0);return(h>>>0).toString(36);}
function eventOf(r,key,start,title,mins){
  const share=linkFor(r,key,S.priv),end=new Date(start.getTime()+mins*6e4);
  const head=[r.n,isHttp(r.l)?"Join: "+r.l:""].filter(Boolean);
  const desc=(head.length?head.join("\n")+"\n\n":"")+"Reminder link: "+share+"\nMade with remmynd.space · free reminder links, no account needed";
  return{title,start,end,loc:r.l||"",desc,url:isHttp(r.l)?r.l:share,uid:"rm-"+pack(startOf(r))+"-"+hash(r.t)+"@remmynd.space"};
}
function ics(ev){const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//zoof04//remmynd//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT","UID:"+ev.uid,"DTSTAMP:"+stamp(new Date()),"DTSTART:"+stamp(ev.start),"DTEND:"+stamp(ev.end),"SUMMARY:"+iesc(ev.title),"DESCRIPTION:"+iesc(ev.desc)];
  if(ev.loc)L.push("LOCATION:"+iesc(ev.loc));L.push("URL:"+ev.url);
  L.push("BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+iesc(ev.title),"TRIGGER:-PT1H","END:VALARM","BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+iesc(ev.title),"TRIGGER:PT0M","END:VALARM","END:VEVENT","END:VCALENDAR");
  return L.map(fold).join("\r\n")+"\r\n";}
const gcal=ev=>"https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(ev.title)+"&dates="+stamp(ev.start)+"/"+stamp(ev.end)+"&details="+encodeURIComponent(ev.desc)+"&location="+encodeURIComponent(ev.loc);
const outlook=(ev,host)=>"https://"+host+"/calendar/0/action/compose?rru=addevent&subject="+encodeURIComponent(ev.title)+"&startdt="+ev.start.toISOString()+"&enddt="+ev.end.toISOString()+"&body="+encodeURIComponent(ev.desc)+"&location="+encodeURIComponent(ev.loc);

/* ---------- device: pick the one-tap default ---------- */
const UA=navigator.userAgent;
const IOS=/iPhone|iPad|iPod/.test(UA)||(/Macintosh/.test(UA)&&navigator.maxTouchPoints>1);
const MAC_SAFARI=!IOS&&/Macintosh/.test(UA)&&/Safari/.test(UA)&&!/Chrome|Chromium|Edg|Firefox/.test(UA);
const IN_APP=/FBAN|FBAV|Instagram|LinkedInApp|Line\/|Twitter|CriOS|FxiOS|EdgiOS|GSA\//.test(UA);
const PREF=(IOS||MAC_SAFARI)?"apple":"google";

/* ---------- icons ---------- */
const I={
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>',
  mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 8l8 6 8-6"/></svg>',
  on:'<svg class="s-on" viewBox="0 0 24 24" fill="none" role="img" aria-label="On"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  out:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16l8-8M9 8h7v7"/></svg>',
  float:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="15" rx="3"/><rect x="11.5" y="10.5" width="6.5" height="5.5" rx="1.5"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  mark:'<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.947 7.775A9 9 0 1 1 14.781 3.44" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12L15.214 8.17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.24" fill="currentColor"/><circle cx="17.785" cy="5.106" r="2.1" fill="var(--moment)"/></svg>'
};

/* ---------- ticket ---------- */
const S={r:null,key:null,priv:false,morning:null,blob:null,held:false,rkey:"",rec:null,ctx:null};
const rkeyOf=(t,start)=>pack(start)+"-"+hash(t);
/* The host's own clock, when the link carries their zone (z) and it differs from the viewer's. */
function hostClock(start,z){if(!z||z===TZ)return"";try{const t=fShort(start,z),day=fDate(start,z)!==fDate(start,TZ);if(!day&&t===fShort(start,TZ))return"";
  return(day?new Intl.DateTimeFormat(undefined,{timeZone:z,weekday:"short"}).format(start)+" ":"")+t+" · "+city(z);}catch(e){return"";}}
const lengthText=m=>m<60?m+" min":m%60?Math.floor(m/60)+" h "+(m%60)+" min":(m/60)+(m===60?" hour":" hours");
/* The ring's state comes from the clock and from whether this device holds the reminder (section 8). */
function ringState(start,end,held,rs,replan){const now=Date.now();if(rs==="kept")return"kept";if(rs==="dropped")return"missed";
  if(held&&replan>now)return replan-now<=36e5?"soon":"held";if(now>=end)return"missed";if(now>=start)return"now";if(held&&start-now<=36e5)return"soon";return held?"held":"open";}
function ringFor(start,state,size){const p=parts(start,TZ);return ringSVG({h:p.h,m:p.mi,state,size});}
function tick(){if(S.ctx&&S.held&&S.ctx.el.isConnected&&phase(S.ctx)!==S.phase)renderBottom();
  document.querySelectorAll(".ticket[data-start]").forEach(el=>{const start=+el.dataset.start,end=+el.dataset.end,st=ringState(start,end,el.dataset.held==="1",el.dataset.rstate,+el.dataset.replan||0);
  const svg=el.querySelector(".t-when .ring");if(svg&&!svg.classList.contains("ring-"+st)){svg.setAttribute("class","ring ring-"+st);const p=parts(new Date(start),TZ);svg.setAttribute("aria-label",ringLabel(p.h,p.mi,st));}
  const soon=el.querySelector(".t-soon");if(!soon)return;const ms=start-Date.now();
  soon.textContent=st==="now"?"Live now":ms>0&&ms<=36e5?"starts in "+Math.floor(ms/6e4)+":"+pad(Math.floor(ms%6e4/1e3)):"";soon.hidden=!soon.textContent;});}
setInterval(tick,1000);
/* Held: the gap closes, then a quiet two-note chime (unless Sound is off) and a short buzz. */
const soundOn=()=>{try{return localStorage.getItem("rm:sound")!=="off";}catch(e){return true;}};
function chime(){if(!soundOn())return;try{const ac=new(window.AudioContext||window.webkitAudioContext)(),t=ac.currentTime;
  [[659,0],[988,.09]].forEach(([f,dt])=>{const o=ac.createOscillator(),g=ac.createGain();o.type="sine";o.frequency.value=f;g.gain.setValueAtTime(0,t+dt);g.gain.linearRampToValueAtTime(.05,t+dt+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dt+.09);o.connect(g);g.connect(ac.destination);o.start(t+dt);o.stop(t+dt+.1);});
  setTimeout(()=>ac.close(),500);}catch(e){}}
const CAL_NAME={apple:"Apple Calendar",google:"Google Calendar",outlook:"Outlook"};
const MOBILE=IOS||/Mobi|Android/.test(UA),DEVICE=MOBILE?"phone":"computer";
const PUSH_OK="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window&&OWN;
const keepRec=()=>{const DB=window.remmyndDB;if(DB&&S.rec)DB.put("reminders",S.rec).catch(()=>{});};
function hold(cal){const c=S.ctx;if(S.held||!c)return;S.held=true;c.el.dataset.held="1";tick();setTimeout(chime,320);try{if(navigator.vibrate&&(!navigator.userActivation||navigator.userActivation.isActive))navigator.vibrate(20);}catch(e){}
  S.rec={rkey:S.rkey,title:c.r.t,start:c.start.getTime(),dur:c.r.d||60,place:c.r.l||"",host:c.r.h||"",z:c.r.z||"",share:c.share,state:"held",nudge:false,cal,heldAt:Date.now(),doneAt:null,replanAt:null};
  keepRec();c.nd.nudge=false;
  /* Notifications where they are allowed: push.js asks inside this same tap, then fills the stack's row. */
  if(window.__rmPush)window.__rmPush.remind(c.nd,false);
  /* Swap Remind me for the stack after the tap, so the link it was on still opens the calendar. */
  setTimeout(renderBottom,60);}
const VIA=()=>'<a class="via" href="'+BASE+'" target="_blank" rel="noopener">'+I.mark+'remmynd</a>';
const ALTS='<div class="alts" id="alts" hidden><a id="a-google" target="_blank" rel="noopener">Google</a><a id="a-apple">Apple</a><a id="a-outlook" target="_blank" rel="noopener">Outlook</a><a id="a-o365" target="_blank" rel="noopener">Office 365</a><button type="button" id="a-share">Reminders &amp; Notes</button><button type="button" id="a-copy">Copy</button><button type="button" id="a-qr">QR code</button></div>';
function remindHTML(c){return(c.night?'<div class="sleep"><span>That’s <b>'+esc(fShort(c.start,TZ))+'</b> for you. Remind me at <b>'+esc(fShort(morningOf(c.start,TZ),TZ))+'</b> instead?</span><label class="switch"><input type="checkbox" id="sleep"'+(c.morning?" checked":"")+' aria-label="Remind me in the morning instead"><span></span></label></div>':'')+
  '<a class="remind" id="remind">'+I.bell+'Remind me</a><div class="t-sub">'+(PUSH_OK?"Calendar and a notification on this "+DEVICE+", in one tap.":"Adds it to your calendar, with alerts.")+'</div>'+
  '<button type="button" class="more" id="more" aria-expanded="false" aria-controls="alts">More ways to be reminded</button>'+ALTS+VIA();}
/* The stack (mock-up 05): what this one tap set up, plus the nudge switch. */
/* Email: on for signed-in accounts (account.js), never for private links, which stay on the device. */
let ACC={signedIn:false};
function emailRow(c){const priv=String(c.share).includes("/#"),on=ACC.signedIn&&ACC.emailAlerts&&!priv;
  const sub=priv?"Private links stay on this device, so they aren't emailed":!ACC.signedIn?"Sign in to get it by email too":ACC.emailAlerts?"To "+esc(ACC.email)+", 1 hour before and at the start":"Off. Turn it on in your account";
  return'<div class="srow'+(on?'':' muted')+'">'+I.mail+'<span class="stext"><b>Email</b><span>'+sub+'</span></span>'+(on?I.on:priv?'':'<button type="button" class="btn small" id="s-email-b">'+(ACC.signedIn?"Account":"Sign in")+'</button>')+'</div>';}
/* Desktop Chrome and Edge: the countdown can float above every other window (Document Picture-in-Picture). Elsewhere the row isn't shown. */
const floatRow=()=>{if(!PIP||FL.no)return"";const on=FL.on&&FL.k===S.rkey;return'<button type="button" class="srow" id="s-float">'+I.float+'<span class="stext"><b>'+(on?"Floating above your windows":"Float it above my windows")+'</b><span>'+(on?"Tap to put it away.":"A small countdown that stays on top until it starts.")+'</span></span>'+(on?I.on:'')+'</button>';};
function stackHTML(c){const rec=S.rec||{},cal=rec.cal;
  const back=rec.replanAt>Date.now()?"Back at "+whenText(new Date(rec.replanAt))+".":"Held. You\'re set.";
  return'<p class="held-line">'+I.on+esc(back)+'</p><div class="label">Your reminder stack</div><div class="stack">'+
    '<a class="srow" id="s-cal">'+I.cal+'<span class="stext"><b>Calendar</b><span>'+(cal?"Sent to "+CAL_NAME[cal]+". Confirm there.":"Not sent yet. Tap to add it.")+'</span></span>'+(cal?I.on:'')+'</a>'+
    '<div id="s-notify"></div>'+
    emailRow(c)+floatRow()+'</div>'+
    '<label class="plan" for="s-plan"><span class="opt-text"><b>My plan</b><span>Say when and where. Your alerts repeat it back.</span></span><input id="s-plan" type="text" maxlength="120" enterkeyhint="done" autocomplete="off" placeholder="At my desk, 5 minutes early" value="'+esc(rec.plan||"")+'"></label>'+
    '<label class="opt-row"><span class="opt-text"><b id="nudge-l">Nudge me until I\'m in</b><span id="nudge-d">Up to 3 nudges, 10 minutes apart.</span></span><span class="switch"><input type="checkbox" id="s-nudge" role="switch" aria-labelledby="nudge-l" aria-describedby="nudge-d"'+(rec.nudge?" checked":"")+'><span></span></span></label>'+
    '<div class="s-actions">'+(isHttp(c.r.l)?'<a class="btn" href="'+esc(c.r.l)+'" target="_blank" rel="noopener">Open the link</a>':'')+'<button type="button" class="btn" id="more" aria-expanded="false" aria-controls="alts">More ways to be reminded</button></div>'+ALTS+
    '<div class="s-add" id="s-add" hidden><span>Keep remmynd on your Home Screen for alerts.</span><button type="button" class="btn small" id="s-add-b">Add</button></div>'+
    '<button type="button" class="linkish s-remove" id="s-remove">Remove this reminder</button>'+VIA();}
/* Follow through (step 5): before it starts the stack; from the start, Open the link, Not yet and Done;
 * after Not yet, the stack again until the new time; then the same question. */
function phase(c){const now=Date.now(),r=S.rec||{};if(r.state==="kept")return"kept";if(r.state==="dropped")return"dropped";
  if(r.replanAt>now)return"later";if(now>=c.start.getTime()||r.replanAt)return"due";return"before";}
const mapsUrl=place=>(IOS||MAC_SAFARI?"https://maps.apple.com/?q=":"https://www.google.com/maps/search/?api=1&query=")+encodeURIComponent(place);
function followHTML(c){const l=c.r.l,plan=S.rec&&S.rec.plan;
  return(plan?'<p class="plan-say"><span class="label">Your plan</span>'+esc(plan)+'</p>':'')+(l?'<a class="remind" id="f-open" href="'+esc(isHttp(l)?l:mapsUrl(l))+'" target="_blank" rel="noopener">'+(isHttp(l)?"Open the link":"Directions")+I.out+'</a>':'')+
    '<div class="s-actions two"><button type="button" class="btn" id="f-later">Not yet</button><button type="button" class="btn" id="f-done">'+I.check+'Done</button></div>'+
    '<p class="t-sub">We ask once whether you made it. Then we stop.</p>'+VIA();}
function labelFor(c,ph){const now=Date.now(),end=c.start.getTime()+(c.r.d||60)*6e4;
  return ph==="kept"?"Kept":ph==="dropped"?"Dropped":ph==="due"?(S.rec&&S.rec.replanAt?"It's time":now<end?"Starting now":"Ended"):S.held?"Held":"Reminder";}
function renderBottom(){const c=S.ctx;if(!c||!c.el.isConnected)return;const b=c.el.querySelector(".t-bottom");
  const ph=S.held?phase(c):"open",was=S.phase;S.phase=ph;
  /* It has started and the page is open: the remmynd chime and a buzz, once. */
  if(S.held&&was&&was!=="due"&&ph==="due"&&document.visibilityState==="visible"){chime();try{if(navigator.vibrate)navigator.vibrate([30,60,30]);}catch(e){}}c.el.dataset.rstate=(S.rec&&S.rec.state)||"";c.el.dataset.replan=(S.rec&&S.rec.replanAt)||0;
  b.innerHTML=!S.held?remindHTML(c):ph==="due"?followHTML(c):ph==="kept"?'<p class="held-line">'+I.on+'Done. You kept it.</p>'+VIA():
    ph==="dropped"?'<p class="held-line muted">Dropped. No more alerts for this one.</p><button type="button" class="btn" id="f-later">Pick a new time</button>'+VIA():stackHTML(c);
  c.el.querySelector(".t-head .label").textContent=labelFor(c,ph);
  if(S.held){const n=$("#nav-right");n.textContent="Coming up";n.href="/#coming-up";}
  const on=(sel,fn)=>{const x=b.querySelector(sel);if(x)fn(x);};
  const sent=(k,a)=>()=>{hold(k);setTimeout(()=>toast("Sent to "+CAL_NAME[k]+". Confirm there."),250);};
  on("#remind",btn=>{if(PREF==="apple")c.setApple(btn);else{btn.href=c.g;btn.target="_blank";btn.rel="noopener";}
    btn.addEventListener("click",()=>{btn.classList.remove("rung");void btn.offsetWidth;btn.classList.add("rung");sent(PREF)();});});
  on("#a-google",a=>{a.href=c.g;a.addEventListener("click",sent("google"));});
  on("#a-apple",a=>{c.setApple(a);a.addEventListener("click",sent("apple"));});
  on("#a-outlook",a=>{a.href=c.ol;a.addEventListener("click",sent("outlook"));});
  on("#a-o365",a=>{a.href=c.o365;a.addEventListener("click",sent("outlook"));});
  on("#a-share",x=>x.addEventListener("click",()=>shareIt({title:c.r.t,text:c.r.t+" · "+fDate(c.start,TZ)+", "+fShort(c.start,TZ),url:c.share},"Pick Reminders or Notes to save it")));
  on("#a-copy",x=>x.addEventListener("click",()=>copy(c.r.t+"\n"+fDate(c.start,TZ)+", "+fShort(c.start,TZ)+" ("+fZone(c.start,TZ)+")"+(c.r.l?"\n"+c.r.l:"")+"\n"+c.share,"Copied")));
  on("#a-qr",x=>x.addEventListener("click",()=>openQR(c.share,c.r.t)));
  on("#more",m=>m.addEventListener("click",()=>{const al=b.querySelector("#alts");al.hidden=!al.hidden;m.setAttribute("aria-expanded",String(!al.hidden));}));
  on("#sleep",sw=>sw.addEventListener("change",()=>{S.morning=sw.checked;renderTicket(c.el,c.r,c.o);}));
  on("#s-cal",a=>{const k=S.rec&&S.rec.cal||PREF;if(k==="apple")c.setApple(a);else{a.href=k==="google"?c.g:c.ol;a.target="_blank";a.rel="noopener";}
    if(!(S.rec&&S.rec.cal))a.addEventListener("click",()=>{if(S.rec){S.rec.cal=k;keepRec();setTimeout(renderBottom,60);}});});
  on("#s-nudge",sw=>sw.addEventListener("change",()=>{if(!S.rec)return;S.rec.nudge=c.nd.nudge=sw.checked;keepRec();if(window.__rmPush)window.__rmPush.setNudge(c.nd,sw.checked).catch(()=>{});toast(sw.checked?"Nudges on: up to 3, 10 minutes apart":"Nudges off");}));
  on("#f-open",a=>a.addEventListener("click",()=>{if(!S.rec)return;S.rec.openedAt=Date.now();keepRec();if(window.__rmPush)window.__rmPush.cancel(S.rkey,["nudge"]).catch(()=>{});}));
  on("#f-done",x=>x.addEventListener("click",markDone));
  on("#s-email-b",x=>x.addEventListener("click",openAccount));
  on("#s-float",x=>x.addEventListener("click",floatIt));
  on("#s-plan",x=>{const save=()=>{if(!S.rec)return;const v=x.value.replace(/\s+/g," ").trim().slice(0,120);if(v===(S.rec.plan||""))return;S.rec.plan=v;keepRec();toast(v?"Plan saved. Your alerts will repeat it.":"Plan cleared");};
    x.addEventListener("change",save);x.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();x.blur();}});});
  on("#s-remove",x=>x.addEventListener("click",()=>{const rec=S.rec,k=S.rkey;if(!rec)return;unfloat(k);const flip=h=>{S.held=h;S.rec=h?rec:null;if(h)c.el.dataset.held="1";else delete c.el.dataset.held;renderTicket(c.el,c.r,c.o);};
    flip(false);later("r:"+k,()=>forgetRec(k),()=>flip(true),"Removed. Delete it from your calendar too.");}));
  on("#f-later",x=>x.addEventListener("click",openReplan));
  on("#s-add-b",x=>x.addEventListener("click",()=>{if(!openSheet())toast("Open remmynd.space in Safari or Chrome to install it");}));
  if(S.held&&b.querySelector("#s-notify")){c.nd.el=b.querySelector("#s-notify");window.__rmLast={type:"stack",detail:c.nd};window.dispatchEvent(new CustomEvent("rm:stack",{detail:c.nd}));refreshInstall();}
  else window.__rmLast={type:"ticket"};}

function renderTicket(el,r,o){
  const start=startOf(r),end=new Date(start.getTime()+(r.d||60)*6e4),p=parts(start,TZ),night=(p.h>=23||p.h<7)&&start-Date.now()>=432e5;
  /* Sleep-safe is an offer, off by default, and only for a night-time reminder at least 12 hours away. */
  if(o.interactive&&S.morning===null)S.morning=false;
  const morning=o.interactive&&night&&S.morning;
  const when=morning?morningOf(start,TZ):start;
  const t=fTime(start,TZ),host=hostClock(start,r.z),H=o.interactive?"h1":"h2",held=o.interactive&&S.held;
  el.dataset.start=start.getTime();el.dataset.end=end.getTime();el.dataset.held=held?"1":"0";
  const where=r.l?'<div class="t-where">'+(isHttp(r.l)?I.link+'<a href="'+esc(r.l)+'" target="_blank" rel="noopener">'+esc(r.l.replace(/^https?:\/\//,"").replace(/\/$/,""))+'</a>':I.pin+'<span>'+esc(r.l)+'</span>')+'</div>':'';
  el.innerHTML=
   '<div class="t-top">'+
     '<div class="t-head"><span class="label">Reminder</span>'+(r.h?'<span class="t-from">from '+esc(r.h)+'</span>':'')+'</div>'+
     '<div class="t-when">'+ringFor(start,ringState(start,end,held))+'<div class="t-clock"><div class="t-time">'+esc(t.main)+(t.per?'<small>'+esc(t.per)+'</small>':'')+'</div>'+
       '<div class="t-date">'+esc(fDate(start,TZ))+'</div><div class="t-zone">your time · '+esc(city(TZ))+'</div><div class="t-soon" hidden></div></div></div>'+
     '<'+H+' class="t-title'+(o.ph?" ph":"")+'">'+esc(r.t)+'</'+H+'>'+(r.n?'<p class="t-notes">'+esc(r.n)+'</p>':'')+where+
   '</div><div class="t-perf" aria-hidden="true"><span></span></div>'+
   '<div class="t-meta">'+(host?'<div><span class="label">Host time</span><b>'+esc(host)+'</b></div>':'')+'<div class="t-len"><span class="label">Length</span><b>'+esc(lengthText(r.d||60))+'</b></div></div>'+
   '<div class="t-bottom">'+(o.interactive?'':'<div class="remind" aria-hidden="true">'+I.bell+'Remind me</div>')+'</div>';
  tick();
  if(!o.interactive)return;
  S.rkey=rkeyOf(r.t,start);
  /* Held already, from an earlier visit: show it and its stack without the animation. */
  if(!S.held&&window.remmyndDB)window.remmyndDB.getAll("reminders").then(list=>{const rec=list.find(x=>x.rkey===S.rkey&&!PEND.has("r:"+x.rkey));
    if(!S.held&&rec&&el.dataset.start===String(start.getTime())){S.held=true;S.rec=rec;if(S.ctx)S.ctx.nd.nudge=!!rec.nudge;el.dataset.held="1";el.classList.add("still");renderBottom();tick();requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.remove("still")));
      if(new URLSearchParams(location.search).get("act")==="replan"){history.replaceState(null,"",location.pathname+location.hash);openReplan();}}}).catch(()=>{});
  const title=morning?r.t+" (live since "+fShort(start,TZ)+")":r.t;
  const ev=eventOf(r,S.key,when,title,morning?15:(r.d||60));
  const file=(r.t.replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase().slice(0,40)||"reminder")+".ics";
  let icsHref,useDownload;
  if(IN_APP&&IOS&&OWN){icsHref="/ics?d="+enc({t:title,s:pack(when),d:morning?15:(r.d||60),l:r.l,n:r.n,u:linkFor(r,S.key,S.priv),k:pack(start),o:r.t});useDownload=false;}
  else{if(S.blob)URL.revokeObjectURL(S.blob);S.blob=URL.createObjectURL(new Blob([ics(ev)],{type:"text/calendar;charset=utf-8"}));icsHref=S.blob;useDownload=true;}
  const setApple=a=>{a.href=icsHref;if(useDownload)a.download=file;else a.removeAttribute("download");};
  const share=linkFor(r,S.key,S.priv);
  S.ctx={el,r,o,start,night,morning,setApple,g:gcal(ev),ol:outlook(ev,"outlook.live.com"),o365:outlook(ev,"outlook.office.com"),share,
    nd:{el:null,r,key:S.key,start,share,morningAt:morning?when:null}};
  renderBottom();
}

/* ---------- floating countdown: loaded the first time it's asked for ---------- */
const PIP="documentPictureInPicture" in window,FL={on:false,k:""};
const floatOpts=()=>{const c=S.ctx,r=S.rec||{},st=c.start.getTime(),at=r.replanAt>Date.now()?r.replanAt:st;return{title:c.r.t,at,end:Math.max(at+6e5,st+(c.r.d||60)*6e4),ring:s=>ringFor(c.start,s,56),onclose:()=>{FL.on=false;if(S.held)renderBottom();}};};
function floatIt(){if(!PIP||!S.ctx)return;const k=S.rkey;if(FL.on&&FL.k===k)return FL.m.close();
  import("/float.js").then(m=>(FL.m=m).open(floatOpts())).then(()=>{FL.on=true;FL.k=k;renderBottom();}).catch(()=>{FL.no=1;renderBottom();toast("This browser can't float the countdown");});}
const unfloat=(k,move)=>{if(FL.on&&FL.k===k){if(move)FL.m.open(floatOpts());else FL.m.close();}};

/* ---------- not yet: the re-plan sheet (mock-up 07) ---------- */
/* In 10 minutes, tonight at 8:00 PM (not after 7:00 PM), tomorrow at 9:00 AM and Monday at 9:00 AM (unless tomorrow is Monday). */
const replanOptions=(now,tz)=>{const p=parts(now,tz),day=n=>{const t=new Date(Date.UTC(p.y,p.mo-1,p.d+n));return{y:t.getUTCFullYear(),m:t.getUTCMonth()+1,d:t.getUTCDate(),dow:t.getUTCDay()};},at=(d,h)=>zonedToUTC(d.y,d.m,d.d,h,0,tz).getTime(),today=day(0),tom=day(1),mon=day(((8-today.dow)%7)||7),o=[{key:"in10",label:"In 10 minutes",at:Math.ceil((now.getTime()+6e5)/6e4)*6e4}];if(p.h<19)o.push({key:"tonight",label:"Tonight",at:at(today,20)});o.push({key:"tomorrow",label:"Tomorrow morning",at:at(tom,9)});if(mon.d!==tom.d||mon.m!==tom.m)o.push({key:"monday",label:"Monday",at:at(mon,9)});return o;};
const RP={el:$("#replan"),head:$("#rp-head"),grid:$("#rp-grid"),pick:$("#rp-pick"),drop:$("#rp-drop"),x:$("#rp-x")};
function openReplan(){const c=S.ctx;if(!c||!S.rec)return;const t=fTime(c.start,TZ);
  RP.head.innerHTML=ringFor(c.start,"held",28)+'<span><b>'+esc(c.r.t)+'</b><i>'+esc(t.main+(t.per?" "+t.per:"")+" · "+fDate(c.start,TZ))+'</i></span>';
  RP.grid.innerHTML=replanOptions(new Date(),TZ).map(o=>{const d=new Date(o.at),sub=o.key==="in10"||o.key==="tonight"?fShort(d,TZ):new Intl.DateTimeFormat(undefined,{timeZone:TZ,weekday:"short"}).format(d)+" "+fShort(d,TZ)+(o.key==="monday"?" · fresh start":"");
    return'<button type="button" class="rp-opt" data-at="'+o.at+'"><b>'+esc(o.label)+'</b><span>'+esc(sub)+'</span></button>';}).join("");
  const p=parts(new Date(Date.now()+36e5),TZ);RP.pick.value=p.y+"-"+pad(p.mo)+"-"+pad(p.d)+"T"+pad(p.h)+":00";
  RP.el.hidden=false;const first=RP.grid.querySelector("button");if(first)first.focus();}
function closeReplan(){RP.el.hidden=true;}
function replanTo(at){const c=S.ctx;if(!c||!S.rec||!(at>Date.now()))return;S.rec.replanAt=at;S.rec.state="held";keepRec();unfloat(S.rkey,1);closeReplan();renderBottom();tick();
  (window.__rmPush?window.__rmPush.replan(c.nd,at):Promise.resolve(false)).then(ok=>toast("Back at "+whenText(new Date(at))+(ok?".":". Turn on notifications to be reminded then."))).catch(()=>{});}
function dropIt(){if(!S.rec)return;unfloat(S.rkey);S.rec.state="dropped";keepRec();closeReplan();renderBottom();tick();if(window.__rmPush)window.__rmPush.cancel(S.rkey).catch(()=>{});toast("Dropped. No more alerts for this one.");}
function markDone(){if(!S.rec)return;unfloat(S.rkey);S.rec.state="kept";S.rec.doneAt=Date.now();keepRec();renderBottom();tick();if(window.__rmPush)window.__rmPush.cancel(S.rkey).catch(()=>{});toast("Done. You kept it.");}
RP.grid.addEventListener("click",e=>{const b=e.target.closest("[data-at]");if(b)replanTo(+b.dataset.at);});
RP.pick.addEventListener("click",()=>{try{RP.pick.showPicker();}catch(e){}});
RP.pick.addEventListener("change",()=>{const[dt,tm]=RP.pick.value.split("T");if(!dt||!tm)return;const[y,mo,d]=dt.split("-").map(Number),[h,mi]=tm.split(":").map(Number);const at=zonedToUTC(y,mo,d,h,mi,TZ).getTime();
  if(at>Date.now())replanTo(at);else toast("Pick a time that hasn't passed");});
RP.drop.addEventListener("click",dropIt);RP.x.addEventListener("click",closeReplan);
RP.el.addEventListener("click",e=>{if(e.target===RP.el)closeReplan();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!RP.el.hidden)closeReplan();});

/* ---------- desk to phone: a QR code for any link, drawn on this device by qr.js, loaded only when asked for ---------- */
const QR={el:$("#qr-sheet"),box:$("#qr-box"),save:$("#qr-save"),x:$("#qr-x"),link:"",title:"",mod:null};
async function openQR(link,title){QR.link=link;QR.title=title;QR.box.innerHTML='<p class="hint">Drawing the code…</p>';QR.el.hidden=false;QR.x.focus();
  try{QR.mod=QR.mod||await import("/qr.js");QR.box.innerHTML=QR.mod.qrSVG(link,{label:"QR code for "+title});}
  catch(e){QR.box.innerHTML='<p class="hint">Couldn\'t draw the code here. Copy the link instead.</p>';}}
function closeQR(){QR.el.hidden=true;}
QR.save.addEventListener("click",async()=>{if(!QR.mod)return;try{const blob=await QR.mod.qrPNG(QR.link),u=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=u;a.download=((QR.title||"").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase().slice(0,40)||"reminder")+"-qr.png";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000);toast("QR code saved");}catch(e){toast("Couldn't save the code");}});
QR.x.addEventListener("click",closeQR);QR.el.addEventListener("click",e=>{if(e.target===QR.el)closeQR();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!QR.el.hidden)closeQR();});

/* ---------- utilities ---------- */
function toast(m){const t=$("#toast");t.textContent=m;t.classList.remove("act");t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("show"),2400);}
function toastUndo(m,undo){const t=$("#toast"),b=document.createElement("button");t.textContent=m;b.type="button";b.className="toast-undo";b.textContent="Undo";
  b.addEventListener("click",()=>{t.classList.remove("show","act");undo();});t.append(b);t.classList.add("show","act");clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("show","act"),5000);}
/* Delete with Undo: what is deleted disappears at once, but the delete itself waits 5 seconds, so Undo can
 * bring it back (a held reminder's alerts are cancelled only when the time is up). Leaving the page finishes it. */
const PEND=new Map();
function later(key,run,undo,msg){PEND.set(key,{run,t:setTimeout(()=>{PEND.delete(key);run();},5000)});
  toastUndo(msg,()=>{const p=PEND.get(key);if(!p)return;clearTimeout(p.t);PEND.delete(key);undo();});}
addEventListener("pagehide",()=>{for(const[k,p]of PEND){clearTimeout(p.t);PEND.delete(k);p.run();}});
const forgetRec=k=>{if(window.remmyndDB)window.remmyndDB.del("reminders",k).catch(()=>{});if(window.__rmPush)window.__rmPush.cancel(k).catch(()=>{});};
function copy(text,msg){const ok=()=>toast(msg||"Copied");const fb=()=>{const ta=document.createElement("textarea");ta.value=text;ta.setAttribute("readonly","");ta.style.cssText="position:fixed;opacity:0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy")?ok():toast("Select the text and copy it");}catch(e){toast("Select the text and copy it");}ta.remove();};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(ok,fb);else fb();}
async function shareIt(data,msg){if(navigator.share){try{await navigator.share(data);toast(msg);return;}catch(e){if(e&&e.name==="AbortError")return;}}copy(data.url,"Link copied. Paste it into Reminders or Notes.");}

/* ---------- maker: one line in, a link out ---------- */
const C={form:$("#cap-form"),input:$("#cap"),label:$("#cap-l"),hero:$("#hero"),try:$("#try"),draft:$("#draft"),ready:$("#ready"),prev:$("#t-preview"),hint:$("#draft-hint"),
  what:$("#c-what"),when:$("#c-when"),whenIn:$("#c-when-in"),where:$("#c-where"),note:$("#c-note"),edit:$("#edit"),editIn:$("#edit-in"),editL:$("#edit-l"),editOk:$("#edit-ok")};
const F={remind:$("#f-remind"),edit:$("#f-edit"),link:$("#f-link"),copy:$("#f-copy"),share:$("#f-share"),qr:$("#f-qr"),priv:$("#f-private"),copied:$("#copied"),card:$("#ready-card"),chat:$("#chat-card")};
/* D.line is the typed line; D.set holds parts fixed with a chip, which win over the line; D.made is the last link made. */
const D={line:"",set:{},made:null,mode:"home",base:"home",editing:null,replace:null};
const short=u=>String(u||"").replace(/^https?:\/\//,"").replace(/\/$/,"");
const webish=s=>/^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/|$)/i.test(s);
const nextHour=()=>new Date(Math.ceil((Date.now()+1)/36e5)*36e5);
function draft(){const p=R.parse(D.line,{timeZone:TZ});return Object.assign({title:p.title,start:p.start,dur:p.dur,place:p.place,notes:""},D.set);}
function whenText(d){return fDate(d,TZ)+" · "+fShort(d,TZ);}
/* Line to ticket: a same-document view transition where the browser has one, a plain swap elsewhere. */
const STILL=matchMedia("(prefers-reduced-motion: reduce)");
function swap(fn){if(document.startViewTransition&&!STILL.matches){const t=document.startViewTransition(fn);t.ready.catch(()=>{});t.finished.catch(()=>{});}else fn();}
function setMode(m){D.mode=m;$("#home").dataset.mode=m;$("#pane-l").textContent=m==="draft"?"Live preview":m==="ready"?"Your link":m==="lists"?(L.tab==="links"?"My links":"Coming up"):"Example";C.hero.hidden=C.try.hidden=m!=="home";C.draft.hidden=m!=="draft";C.ready.hidden=m!=="ready";L.el.hidden=m!=="lists";$(".facts").hidden=m==="draft"||m==="lists";
  C.form.classList.toggle("typing",m==="draft");C.label.textContent=m==="draft"?"Enter makes the link":"New reminder";
  const n=$("#nav-right");delete n.dataset.act;if(m==="draft"){n.textContent="Cancel";n.href="/";n.dataset.act="cancel";}else if(m==="ready"){n.textContent="My links";n.href="/#links";}
  else if(m==="home"&&L.has){n.textContent="Coming up";n.href="/#coming-up";}else{n.textContent="See an example";n.href="/#example";}}
function chip(el,text,empty){el.querySelector("b").textContent=text;el.classList.toggle("empty",!!empty);}
function renderDraft(){const d=draft();
  renderTicket(C.prev,{t:d.title||"Your event",s:pack(d.start||nextHour()),...(d.dur&&d.dur!==60?{d:d.dur}:{}),...(d.place?{l:d.place}:{}),...(d.notes?{n:d.notes}:{}),z:TZ},{interactive:false,ph:!d.title});
  chip(C.what,d.title||"Add what",!d.title);chip(C.when,d.start?whenText(d.start):"Pick a time",!d.start);chip(C.where,d.place?short(d.place):"Add a place",!d.place);
  C.note.textContent=d.notes?"Note: "+(d.notes.length>24?d.notes.slice(0,24)+"…":d.notes):"+ Note";C.note.classList.toggle("add",!d.notes);
  const s=d.start||nextHour(),p=parts(s,TZ);C.whenIn.value=p.y+"-"+pad(p.mo)+"-"+pad(p.d)+"T"+pad(p.h)+":"+pad(p.mi);
  C.hint.textContent=!d.title?"Add what it is to make the link.":!d.start?"Add a time to make the link.":"Not a link yet. Press Enter to make it.";}
/* The pane: the live preview while typing; otherwise the link just made, or an example (seen beside the maker from 960 px). */
function renderPane(){if(D.mode==="draft")return renderDraft();if(D.mode==="lists")return previewRow(L.body.querySelector(".li-main"));
  const x=D.mode==="ready"&&D.made?D.made.ev:EX[0];if(!x)return;
  renderTicket(C.prev,{t:x.title,s:pack(x.start),...(x.durationMinutes&&x.durationMinutes!==60?{d:x.durationMinutes}:{}),...(x.location?{l:x.location}:{}),...(x.notes?{n:x.notes}:{}),z:TZ},{interactive:false});}
function renderMaker(){renderPane();}
function clearDraft(){swap(()=>{D.line="";D.set={};D.replace=null;C.input.value="";closeEdit();setMode(D.made?"ready":D.base);renderMaker();});}
C.input.addEventListener("input",()=>{D.line=C.input.value;const typing=!!(D.line.trim()||Object.keys(D.set).length);
  if(typing&&D.mode!=="draft"){D.mode="draft";swap(()=>{setMode("draft");renderDraft();});}
  else if(typing)renderDraft();
  else if(D.mode==="draft"){const m=D.made?"ready":D.base;D.mode=m;swap(()=>{setMode(m);renderMaker();});}});
/* Smart paste: a long paste or an image can be read by the browser's own on-device AI, where it has one (smartpaste.js, loaded only then). */
C.input.addEventListener("paste",e=>{const d=e.clipboardData;if(!d||!("LanguageModel" in self))return;const t=d.getData("text/plain")||"",image=[...d.files].find(f=>/^image\//.test(f.type))||null;
  if(image||t.length>80||/\n/.test(t.trim()))import("/smartpaste.js").then(m=>m.offer({text:t,image,form:C.form,put:newOne,toast,R,timeZone:TZ})).catch(()=>{});});
C.form.addEventListener("submit",e=>{e.preventDefault();make();});
/* Chips: What, Where and Note open a small editor; When opens the device's own date and time picker. */
const EDIT={title:"What",place:"Where",notes:"Note"};
function openEdit(key){const d=draft();D.editing=key;C.editL.textContent=EDIT[key];C.editIn.value=d[key]||"";C.edit.hidden=false;C.editIn.focus();}
function closeEdit(){D.editing=null;C.edit.hidden=true;}
function saveEdit(){const k=D.editing;if(!k)return;let v=C.editIn.value.trim();if(k==="place"&&v&&webish(v)&&!/^https?:\/\//i.test(v))v="https://"+v;D.set[k]=v;closeEdit();if(D.mode!=="draft")setMode("draft");renderDraft();C.input.focus();}
C.what.addEventListener("click",()=>openEdit("title"));C.where.addEventListener("click",()=>openEdit("place"));C.note.addEventListener("click",()=>openEdit("notes"));
C.editOk.addEventListener("click",saveEdit);
C.editIn.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();saveEdit();}else if(e.key==="Escape"){closeEdit();C.input.focus();}});
C.whenIn.addEventListener("click",()=>{try{C.whenIn.showPicker();}catch(e){}});
C.whenIn.addEventListener("change",()=>{const[dt,tm]=C.whenIn.value.split("T");if(!dt||!tm)return;const[y,mo,d]=dt.split("-").map(Number),[h,mi]=tm.split(":").map(Number);
  D.set.start=zonedToUTC(y,mo,d,h,mi,TZ);if(D.mode!=="draft")setMode("draft");renderDraft();});
/* Enter: make the link, copy it and keep it in this device's list of links. */
function make(){if(D.editing)saveEdit();const d=draft();
  if(!d.title){if(D.mode!=="draft")setMode("draft");renderDraft();openEdit("title");return toast("Add what it is first");}
  if(!d.start){if(D.mode!=="draft")setMode("draft");renderDraft();try{C.whenIn.showPicker();}catch(e){C.whenIn.focus();}return toast("Pick a time to make the link");}
  const ev={title:d.title,start:d.start,durationMinutes:d.dur||undefined,location:d.place,notes:d.notes,timeZone:TZ};
  let link;try{link=R.createLink(ev,{base:BASE,private:F.priv.checked});}catch(e){return toast("That reminder can't be made: "+e.message);}
  swap(()=>{D.made={ev,link};D.line="";D.set={};C.input.value="";closeEdit();showReady();});
  copy(link,"Link copied. Share it anywhere.");D.made={ev,link};keepLink(D.replace||undefined);D.replace=null;}
function keepLink(prev){const m=D.made;if(!m||!window.remmyndDB)return;const DB=window.remmyndDB;
  (prev?DB.del("links",prev):Promise.resolve()).then(()=>DB.put("links",{share:m.link,title:m.ev.title,start:m.ev.start.getTime(),createdAt:Date.now(),private:F.priv.checked})).catch(()=>{});}
function showReady(){const m=D.made;F.link.value=m.link;
  F.card.href=m.link;F.card.innerHTML=ringFor(m.ev.start,"open",28)+'<span><b>'+esc(m.ev.title)+'</b><i>'+esc(whenText(m.ev.start))+(m.ev.location?' · '+esc(short(m.ev.location)):'')+'</i></span>';
  /* How it looks in chats: what a chat app shows for this link. A private link shows nothing about the reminder. */
  const host=new URL(BASE).host;
  F.chat.innerHTML='<div class="chat-img" aria-hidden="true">'+ringFor(m.ev.start,"open",28)+'<span>remmynd</span></div><div class="chat-text">'+(F.priv.checked?
    '<b>remmynd</b><span>Reminders that make sure it happens. Free, no account needed, no tracking.</span>':'<b>'+esc(m.ev.title)+'</b><span>'+esc(R.describeWhen(m.ev.start,TZ))+' · Tap to get reminded</span>')+'<i>'+esc(host)+'</i></div>';
  F.copied.hidden=false;clearTimeout(F.copied._t);F.copied._t=setTimeout(()=>{F.copied.hidden=true;},2600);setMode("ready");renderMaker();}
F.priv.addEventListener("change",()=>{const m=D.made;if(!m)return;const prev=m.link;m.link=R.createLink(m.ev,{base:BASE,private:F.priv.checked});
  showReady();copy(m.link,F.priv.checked?"Private link copied":"Link copied");keepLink(prev);});
F.copy.addEventListener("click",()=>F.link.value&&copy(F.link.value,"Link copied. Share it anywhere."));
F.share.addEventListener("click",()=>{const m=D.made;if(!m)return;shareIt({title:m.ev.title,text:"Get a reminder: "+m.ev.title,url:m.link},"Shared");});
F.link.addEventListener("focus",()=>F.link.select());
F.remind.insertAdjacentHTML("afterbegin",I.bell);
/* Remind me, right after making it: open the new reminder and press its own Remind me inside this same tap,
 * so the calendar, notifications and the stack work exactly as on any reminder link. */
F.remind.addEventListener("click",()=>{const m=D.made;if(!m)return;const u=new URL(m.link);S.back=true;history.pushState(null,"",u.pathname+u.hash);route();const b=$("#remind");if(b)b.click();});
F.edit.addEventListener("click",()=>{if(D.made)editMade(D.made.link);});
/* Edit a reminder you made: back to the line with its parts filled in. Making it again replaces the old link in My links. */
const payloadOf=l=>{const s=String(l),i=s.indexOf("/r/");return i>=0?s.slice(i+3).split(/[?#/]/)[0]:s.slice(s.indexOf("#")+1);};
function editMade(link){const r=dec(payloadOf(link));if(!r)return;
  D.set={title:r.t,start:startOf(r),dur:r.d&&r.d!==60?r.d:null,place:r.l||"",notes:r.n||""};D.replace=link;D.line="";D.made=null;C.input.value="";F.priv.checked=!String(link).includes("/r/");
  if(location.pathname!=="/"||location.hash){history.pushState(null,"","/");routed=location.href;}
  D.base=D.mode==="lists"?"lists":"home";swap(()=>{setMode("draft");showHome();});C.input.focus();toast("Change what you need, then press Enter");}
F.qr.addEventListener("click",()=>{const m=D.made;if(m)openQR(m.link,m.ev.title);});
/* The live badge and the Discord line: livebadge.js, loaded only when asked for. */
$("#f-live").addEventListener("click",e=>{const m=D.made,b=e.currentTarget;if(m)import("/livebadge.js").then(x=>x.open(m.link,{copy,from:b})).catch(()=>toast("Couldn't open it here. Try again."));});
/* Keep the bar above the on-screen keyboard where the browser doesn't move fixed elements itself. */
if(window.visualViewport){const vv=window.visualViewport,kb=()=>document.documentElement.style.setProperty("--kb",Math.max(0,Math.round(innerHeight-vv.height-vv.offsetTop))+"px");vv.addEventListener("resize",kb);vv.addEventListener("scroll",kb);}
/* Try one: three examples worked out from today, so they are never in the past. */
const EX=["Demo day Fri 5pm","Rent due 1st","Call Mum Sun 7:30pm"].map(line=>{const p=R.parse(line,{timeZone:TZ});return{title:p.title,start:p.start};});
(function tryOne(){const list=EX.map(ev=>({p:ev,link:R.createLink({title:ev.title,start:ev.start,timeZone:TZ},{base:BASE})}));
  $("#try-list").innerHTML=list.map(x=>'<a class="row" href="'+esc(x.link)+'">'+ringFor(x.p.start,"open",28)+'<span><b>'+esc(x.p.title)+'</b><i>'+esc(whenText(x.p.start))+'</i></span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>').join("");})();

/* ---------- lists: Coming up and My links (mock-up 08) ---------- */
const L={el:$("#lists"),body:$("#list-body"),hint:$("#list-hint"),tab:"coming",recs:[],links:[],has:false};
const dayNum=(t,tz)=>{const p=parts(new Date(t),tz);return Date.UTC(p.y,p.mo-1,p.d)/864e5;};
/* Today, This week (the next seven days), Later; links that have passed go under Earlier, kept reminders under Kept. */
const groupOf=(t,now,tz)=>{const d=dayNum(t,tz)-dayNum(now,tz);return d===0?"today":d<0?"earlier":d<=7?"week":"later";};
const GROUPS={today:"Today",week:"This week",later:"Later",kept:"Kept",earlier:"Earlier"};
/* Kept N of M this month: the reminders that came due this month (once over, or marked done this month); kept are the ones marked Done. */
const keptCount=(recs,now,tz)=>{const p=parts(new Date(now),tz),from=zonedToUTC(p.y,p.mo,1,0,0,tz).getTime();let k=0,n=0;for(const x of recs){const kept=x.state==="kept",t=kept?x.doneAt||x.start:Math.max(x.start+(x.dur||60)*6e4,x.replanAt||0);if(t>=from&&t<=now){n++;if(kept)k++;}}return{k,n};};
const relText=(t,end,now)=>now>=t&&now<end?"now":now>=end?"ended":(t-now)<36e5?"in "+Math.max(1,Math.round((t-now)/6e4))+" min":"in "+Math.round((t-now)/36e5)+" h";
const MORE=t=>'<button type="button" class="li-more" aria-label="Actions for '+esc(t)+'" aria-expanded="false"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>';
const ACTS=a=>'<div class="li-acts">'+a.map(([k,t])=>'<button type="button" data-act="'+k+'">'+t+'</button>').join("")+'</div>';
function upRow(x,now){const later=x.replanAt>now,t=later?x.replanAt:x.start,end=x.start+(x.dur||60)*6e4,kept=x.state==="kept";
  const st=kept?"kept":ringState(x.start,end,true,x.state,x.replanAt||0),g=kept?"kept":groupOf(t,now,TZ),d=new Date(t);
  const sub=kept?fDate(new Date(x.doneAt||x.start),TZ)+" · done":g==="today"?fShort(d,TZ)+" · "+(later?"back ":"")+relText(t,later?t+1:end,now):fDate(d,TZ)+" · "+fShort(d,TZ)+(x.host?" · "+x.host:"");
  const chip=st==="soon"?'<span class="li-chip">Soon</span>':st==="now"?'<span class="li-chip">Now</span>':"";
  const acts=kept?[["delete","Delete"]]:[["replan","Re-plan"],["done","Done"],["delete","Delete"]];
  return{g,t:kept?(x.doneAt||x.start):t,html:'<div class="li n'+acts.length+'" data-rkey="'+esc(x.rkey)+'">'+ACTS(acts)+
    '<a class="li-main" href="'+esc(x.share)+'">'+ringFor(new Date(x.start),st,28)+'<span><b>'+esc(x.title)+'</b><i>'+esc(sub)+'</i></span>'+chip+'</a>'+MORE(x.title)+'</div>'};}
function linkRow(x,now){const d=new Date(x.start);
  return{g:groupOf(x.start,now,TZ),t:x.start,html:'<div class="li n3" data-share="'+esc(x.share)+'">'+ACTS([["copy","Copy"],["edit","Edit"],["delete","Delete"]])+
    '<a class="li-main" href="'+esc(x.share)+'">'+ringFor(d,x.start<now?"missed":"open",28)+'<span><b>'+esc(x.title)+'</b><i>'+esc(fDate(d,TZ)+" · "+fShort(d,TZ)+(x.private?" · private":""))+'</i></span></a>'+MORE(x.title)+'</div>'};}
async function loadLists(){const DB=window.remmyndDB;if(!DB)return;try{[L.recs,L.links]=await Promise.all([DB.getAll("reminders"),DB.getAll("links")]);}catch(e){}
  L.recs=L.recs.filter(x=>!PEND.has("r:"+x.rkey));L.links=L.links.filter(x=>!PEND.has("l:"+x.share));L.has=!!(L.recs.length||L.links.length);}
async function renderLists(focusAt){await loadLists();const now=Date.now(),up=L.tab==="coming";
  $("#tab-coming").setAttribute("aria-current",up?"page":"false");$("#tab-links").setAttribute("aria-current",up?"false":"page");
  const rows=up?L.recs.filter(x=>x.state!=="dropped").map(x=>upRow(x,now)).filter(r=>r.g!=="earlier"&&!(r.g==="kept"&&now-r.t>30*864e5)):L.links.map(x=>linkRow(x,now));
  const order=up?["today","week","later","kept"]:["today","week","later","earlier"];
  L.body.innerHTML=rows.length?order.map(g=>{const rs=rows.filter(r=>r.g===g).sort((a,b)=>g==="kept"||g==="earlier"?b.t-a.t:a.t-b.t);
      return rs.length?'<div class="label">'+GROUPS[g]+'</div><div class="li-group">'+rs.map(r=>r.html).join("")+'</div>':"";}).join(""):
    '<p class="li-empty">'+(up?(L.links.length?"Nothing to remind you of yet. You made "+L.links.length+(L.links.length>1?" reminders":" reminder")+": open one in My links and tap Remind me.":"Nothing coming up yet. Write one in the bar below, then tap Remind me."):"No reminders made yet. Write one in the bar below and press Enter.")+'</p>';
  L.hint.textContent=rows.length?(MOBILE?"Swipe a row left, or tap ⋯, for "+(up?"Re-plan, Done and Delete.":"Copy, Edit and Delete."):"J and K move, "+(up?"D marks done, S re-plans, ":"")+"Delete removes, Enter opens."):"";L.hint.hidden=!L.hint.textContent;
  /* It only ever celebrates: hidden until one is kept this month. */
  const kc=keptCount(L.recs,now,TZ);$("#kept-n").textContent="Kept "+kc.k+" of "+kc.n+" this month";$("#kept").hidden=!(up&&kc.k);
  const mains=[...L.body.querySelectorAll(".li-main")];if(focusAt!=null&&mains.length)mains[Math.min(focusAt,mains.length-1)].focus();else if(D.mode==="lists")previewRow(mains[0]);}
/* From 960 px the pane shows the row in focus (J and K move through them). */
function previewRow(a){if(!a)return renderTicket(C.prev,{t:EX[0].title,s:pack(EX[0].start),z:TZ},{interactive:false});
  const m=/\/r\/([A-Za-z0-9_-]+)|#(.+)$/.exec(a.getAttribute("href")||""),r=m&&dec(m[1]||m[2]);if(r)renderTicket(C.prev,r,{interactive:false});}
async function rowAct(rkey,act,at){const x=L.recs.find(r=>r.rkey===rkey);if(!x)return;if(act!=="replan")unfloat(rkey);
  if(act==="delete"){renderListsSoon(at);return later("r:"+rkey,()=>forgetRec(rkey),()=>renderLists(at),"Deleted “"+x.title+"”. Delete it from your calendar too.");}
  if(act==="replan"){const u=new URL(x.share,location.origin);u.searchParams.set("act","replan");location.href=u.href;return;}
  await window.remmyndDB.put("reminders",{...x,state:"kept",doneAt:Date.now()}).catch(()=>{});if(window.__rmPush)window.__rmPush.cancel(rkey).catch(()=>{});
  toast("Done. You kept it.");renderLists(at);}
function linkAct(share,act,at){const x=L.links.find(l=>l.share===share);if(!x)return;
  if(act==="copy")return copy(share,"Link copied");
  if(act==="edit")return editMade(share);
  if(act==="delete"){renderListsSoon(at);later("l:"+share,()=>{if(window.remmyndDB)window.remmyndDB.del("links",share).catch(()=>{});},()=>renderLists(at),"Deleted “"+x.title+"”");}}
/* A delete hides its row at once (PEND keeps it out of the list until Undo or the time is up). */
const renderListsSoon=at=>setTimeout(()=>renderLists(at),0);
/* Swipe a row left (or tap ⋯) to show its actions under it; swipe right to hide them. */
L.body.addEventListener("pointerdown",e=>{const a=e.target.closest(".li-main"),row=a&&a.parentElement;if(!a||e.pointerType==="mouse")return;
  const x0=e.clientX,y0=e.clientY;let done=false;
  const move=ev=>{const dx=ev.clientX-x0;if(done||Math.abs(dx)<40||Math.abs(dx)<Math.abs(ev.clientY-y0)*1.5)return;done=true;setOpen(row,dx<0);a.dataset.swiped="1";setTimeout(()=>{delete a.dataset.swiped;},350);};
  const up=()=>{a.removeEventListener("pointermove",move);a.removeEventListener("pointerup",up);a.removeEventListener("pointercancel",up);};
  a.addEventListener("pointermove",move);a.addEventListener("pointerup",up);a.addEventListener("pointercancel",up);});
const setOpen=(li,on)=>{li.classList.toggle("open",on);const m=li.querySelector(".li-more");if(m)m.setAttribute("aria-expanded",String(on));};
L.body.addEventListener("click",e=>{const a=e.target.closest(".li-main"),at=[...L.body.querySelectorAll(".li")].indexOf(e.target.closest(".li"));
  if(a&&a.dataset.swiped){e.preventDefault();return;}
  const more=e.target.closest(".li-more");if(more){const li=more.closest(".li"),on=!li.classList.contains("open");L.body.querySelectorAll(".li.open").forEach(x=>setOpen(x,false));setOpen(li,on);if(on)li.querySelector(".li-acts button").focus();return;}
  const b=e.target.closest("[data-act]");if(b){const li=b.closest(".li");return li.dataset.rkey?rowAct(li.dataset.rkey,b.dataset.act,at):linkAct(li.dataset.share,b.dataset.act,at);}
  /* Open a row inside the app, so Back returns to the list. */
  if(a&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){const u=new URL(a.href,location.href);if(u.origin===location.origin){e.preventDefault();S.back=true;history.pushState(null,"",u.pathname+u.search+u.hash);route();}}});
L.body.addEventListener("focusin",e=>{const a=e.target.closest(".li-main");if(a)previewRow(a);if(e.target.closest(".li-acts"))e.target.closest(".li").classList.add("open");});
L.body.addEventListener("focusout",e=>{const li=e.target.closest(".li");if(li&&!li.contains(e.relatedTarget))li.classList.remove("open");});
/* Desktop keys: J and K move, D marks done, S re-plans, Enter opens. */
document.addEventListener("keydown",e=>{if(D.mode!=="lists"||$("#home").hidden||e.metaKey||e.ctrlKey||e.altKey||!RP.el.hidden||!$("#menu").hidden||/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName))return;
  const rows=[...L.body.querySelectorAll(".li-main")],i=rows.indexOf(document.activeElement),k=e.key.toLowerCase();
  if(k==="j"||k==="k"){if(!rows.length)return;e.preventDefault();rows[i<0?0:Math.max(0,Math.min(rows.length-1,i+(k==="j"?1:-1)))].focus();}
  else if((k==="d"||k==="s")&&i>=0){const li=rows[i].closest(".li");if(li.dataset.rkey&&li.querySelector('[data-act="done"]')){e.preventDefault();rowAct(li.dataset.rkey,k==="d"?"done":"replan",i);}}
  else if((e.key==="Delete"||e.key==="Backspace")&&i>=0){const li=rows[i].closest(".li");e.preventDefault();if(li.dataset.rkey)rowAct(li.dataset.rkey,"delete",i);else linkAct(li.dataset.share,"delete",i);}
  else if(e.key==="Escape")L.body.querySelectorAll(".li.open").forEach(x=>setOpen(x,false));});
loadLists().then(()=>{if(D.mode==="home")setMode("home");});

/* ---------- routing ---------- */
function showHome(){$("#view").hidden=true;$("#home").hidden=false;C.form.hidden=false;document.body.classList.add("has-cap");setMode(D.mode);document.title="remmynd";renderMaker();}
function showLists(tab){L.tab=tab;D.base="lists";if(D.mode!=="draft")D.mode="lists";showHome();document.title=(tab==="links"?"My links":"Coming up")+" · remmynd";renderLists();}
function showView(r,key,priv){if(r.l&&!isHttp(r.l)&&webish(r.l))r={...r,l:"https://"+r.l};S.r=r;S.key=key;S.priv=!!priv;S.morning=null;S.held=false;S.rec=null;$("#home").hidden=true;$("#view").hidden=false;C.form.hidden=true;document.body.classList.remove("has-cap");const n=$("#nav-right");n.href="/";if(S.back){n.textContent="Back";n.dataset.act="back";S.back=false;}else{n.textContent="Make your own";delete n.dataset.act;}
  renderTicket($("#t-view"),r,{interactive:true});document.title=r.t+" · remmynd";window.scrollTo(0,0);}
/* /r/<payload> is a shared link, /#<payload> a private one (and every 1.x link), /#<name> a named page. */
let routed="";
function route(){if(location.href===routed)return;routed=location.href;const p=location.pathname;
  if(p.startsWith("/r/")){const r=dec(p.slice(3).replace(/\/+$/,""));return r?showView(r,null,false):showHome();}
  if(p==="/new"||p==="/new/")return fromNew();
  if(p==="/share"||p==="/share/")return fromShare();
  const h=decodeURIComponent(location.hash.slice(1));if(h==="coming-up"||h==="links")return showLists(h==="links"?"links":"coming");
  const preset=PRESETS.get(h);if(typeof preset==="function")return showView(preset(),h,false);const r=h&&dec(h);if(r)return showView(r,null,true);D.base="home";if(D.mode==="lists")D.mode="home";showHome();}
/* /new?t=…&at=… lands here only when the time has no zone. Read it in this device's zone with the library itself, then show the /r/ link. */
function fromNew(){const q=new URLSearchParams(location.search);
  const ev=R.fromQuery(q,{timeZone:TZ});if(ev){history.replaceState(null,"",R.toPath(ev));return route();}
  history.replaceState(null,"","/");routed=location.href;
  const set={};for(const[k,key]of[["t","title"],["l","place"],["n","notes"]]){const v=(q.get(k)||"").trim();if(v)set[key]=key==="place"&&webish(v)&&!/^https?:\/\//i.test(v)?"https://"+v:v;}
  D.set=set;D.mode=Object.keys(set).length?"draft":"home";showHome();toast("Add what's missing to make the link");}
/* Shared from another app (Android share sheet, manifest share_target): title, text and link become one line in the bar, read like anything typed there. */
const shareLine=q=>{const u=(q.get("url")||"").trim();let s=[q.get("title"),q.get("text")].map(x=>(x||"").trim()).filter((x,i,a)=>x&&a.indexOf(x)===i).join(" ");if(u&&!s.includes(u))s+=" "+u;return s.replace(/\s+/g," ").trim().slice(0,600);};
function fromShare(){const t=shareLine(new URLSearchParams(location.search));history.replaceState(null,"","/");routed=location.href;D.base="home";D.mode="home";showHome();if(t){C.input.value=t;C.input.dispatchEvent(new Event("input"));}}
const goHome=e=>{e.preventDefault();if(location.pathname==="/"&&!location.hash)return showHome();history.pushState(null,"","/");route();};
$("#home-link").addEventListener("click",goHome);$("#make-own").addEventListener("click",goHome);
$("#nav-right").addEventListener("click",e=>{const n=e.currentTarget;if(n.dataset.act==="back"){e.preventDefault();return history.back();}if(n.dataset.act==="cancel"){e.preventDefault();return clearDraft();}if(n.getAttribute("href")==="/")goHome(e);});
window.addEventListener("hashchange",route);window.addEventListener("popstate",route);route();

/* ---------- sound: the Held chime, on unless switched off (rm:sound) ---------- */
function applySound(){const on=soundOn();document.querySelectorAll("[data-sound]").forEach(b=>b.setAttribute("aria-pressed",String((b.dataset.sound==="on")===on)));}
document.querySelectorAll("[data-sound]").forEach(b=>b.addEventListener("click",()=>{try{if(b.dataset.sound==="off")localStorage.setItem("rm:sound","off");else localStorage.removeItem("rm:sound");}catch(e){}applySound();}));
applySound();

/* ---------- theme: Auto follows the system; Light and Dark are kept in rm:theme ---------- */
const PAPER={light:"#F5F6F7",dark:"#0B0C0E"};
function applyTheme(t){const root=document.documentElement;if(t==="light"||t==="dark")root.dataset.theme=t;else{delete root.dataset.theme;t="auto";}
  const tl=$("#tc-light"),td=$("#tc-dark");
  if(tl&&td){tl.content=t==="dark"?PAPER.dark:PAPER.light;td.content=t==="light"?PAPER.light:PAPER.dark;}
  document.querySelectorAll("[data-theme-set]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.themeSet===t)));}
let savedTheme="auto";try{savedTheme=localStorage.getItem("rm:theme")||"auto";}catch(e){}
applyTheme(savedTheme);
document.querySelectorAll("[data-theme-set]").forEach(b=>b.addEventListener("click",()=>{const t=b.dataset.themeSet;
  try{if(t==="auto")localStorage.removeItem("rm:theme");else localStorage.setItem("rm:theme",t);}catch(e){}
  applyTheme(t);}));

/* ---------- install (PWA) ---------- */
const STANDALONE=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const IOS_VER=(()=>{const m=UA.match(/OS (\d+)_/)||UA.match(/Version\/(\d+)/);return m?+m[1]:0;})();
const IPAD=/iPad/.test(UA)||(/Macintosh/.test(UA)&&navigator.maxTouchPoints>1);
const SOCIAL_APP=/FBAN|FBAV|Instagram|LinkedInApp|Line\/|Twitter|Snapchat|Pinterest|GSA\//.test(UA);
const IOS_OTHER=IOS&&/CriOS|FxiOS|EdgiOS/.test(UA);
let deferred=null,installMode=null;
const ICON={share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M7 8l5-5 5 5"/></svg>',
  dots:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'};
const k=(icon,label)=>'<span class="kbd">'+(icon?ICON[icon]:"")+label+'</span>';
function detectInstall(){
  if(STANDALONE)return null;
  if(deferred)return"prompt";
  if(SOCIAL_APP)return"social";
  if(IOS&&IOS_OTHER)return IOS_VER>=16?"ios-other":null;
  if(IOS)return IOS_VER>=26?"ios26":"ios";
  return null;
}
function sheetBody(mode){
  if(mode==="prompt")return'<button type="button" class="btn ink" id="do-install">Install remmynd</button><p class="sheet-note">Free. Adds an icon to your home screen. Remove it any time.</p>';
  if(mode==="ios26")return'<ol class="steps"><li>Tap '+k("dots","")+' next to the address bar</li><li>Tap '+k("share","Share")+'</li><li>Scroll and tap '+k("plus","Add to Home Screen")+'</li><li>Tap <b>Add</b></li></ol>';
  if(mode==="ios")return'<ol class="steps"><li>Tap '+k("share","Share")+(IPAD?' at the top':' at the bottom')+'</li><li>Scroll and tap '+k("plus","Add to Home Screen")+'</li><li>Tap <b>Add</b></li></ol>';
  if(mode==="ios-other")return'<ol class="steps"><li>Tap '+k("share","Share")+' in the address bar</li><li>Tap '+k("plus","Add to Home Screen")+'</li><li>Tap <b>Add</b></li></ol>';
  if(mode==="social")return'<ol class="steps"><li>Apps like Instagram and LinkedIn can\'t add pages to your home screen</li><li>Tap '+k("dots","")+' at the top and choose <b>Open in browser</b>, or copy the link</li></ol><button type="button" class="btn mt-14" id="copy-page">Copy link</button>';
  return"";
}
function arrowFor(mode){const a=$("#arrow");a.classList.remove("br","bc","tr");
  const pos=mode==="ios26"?(IPAD?"tr":"br"):mode==="ios"?(IPAD?"tr":"bc"):mode==="ios-other"?"tr":null;
  if(pos){a.classList.add(pos);a.hidden=false;}else a.hidden=true;}
function openSheet(){const mode=detectInstall();if(!mode)return false;
  $("#toast").classList.remove("show");$("#sheet-body").innerHTML=sheetBody(mode);$("#sheet").hidden=false;arrowFor(mode);
  const di=$("#do-install");if(di){di.focus();di.addEventListener("click",async()=>{if(!deferred)return;closeSheet();deferred.prompt();try{await deferred.userChoice;}catch(e){}deferred=null;refreshInstall();});}
  const cp=$("#copy-page");if(cp)cp.addEventListener("click",()=>copy(location.href,"Link copied. Paste it into Safari or Chrome."));
  return true;}
function closeSheet(){$("#sheet").hidden=true;$("#arrow").hidden=true;}
$("#sheet-x").addEventListener("click",closeSheet);
$("#sheet").addEventListener("click",e=>{if(e.target.id==="sheet")closeSheet();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#sheet").hidden)closeSheet();});
const inst=$("#install"),heroInst=$("#hero-install");
function refreshInstall(){installMode=detectInstall();const show=!!installMode&&OWN;inst.hidden=!show;heroInst.hidden=!show;const sa=$("#s-add");if(sa)sa.hidden=!show;}
[inst,heroInst].forEach(b=>b.addEventListener("click",()=>{if(!openSheet())toast("Open remmynd.space in Safari or Chrome to install it");}));
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;refreshInstall();});
window.addEventListener("appinstalled",()=>{deferred=null;closeSheet();refreshInstall();toast("Added. Find remmynd on your home screen.");});
/* Offer it once, right after someone gets value: saved a reminder or copied a link. */
const NUDGE_KEY="remmynd-install-nudge";
function nudgeInstall(){if(!OWN||STANDALONE)return;let last=0;try{last=+localStorage.getItem(NUDGE_KEY)||0;}catch(e){}
  if(Date.now()-last<14*864e5)return;
  setTimeout(()=>{if(document.hidden)return;if(openSheet()){try{localStorage.setItem(NUDGE_KEY,String(Date.now()));}catch(e){}}},1800);}
document.addEventListener("click",e=>{if(e.target.closest("#remind,#a-google,#a-apple,#f-copy,#f-share"))nudgeInstall();});
refreshInstall();
/* ---------- menu: the website's pages, theme, sound and Install ---------- */
const menu=$("#menu"),menuBtn=$("#menu-btn");let menuBack=null;
function closeMenu(){if(menu.hidden)return;menu.hidden=true;menuBtn.setAttribute("aria-expanded","false");if(menuBack&&$("#sheet").hidden)menuBack.focus();}
menuBtn.addEventListener("click",()=>{menuBack=document.activeElement;menu.hidden=false;menuBtn.setAttribute("aria-expanded","true");menu.querySelector("a").focus();});
$("#menu-x").addEventListener("click",closeMenu);
menu.addEventListener("click",e=>{if(e.target===menu)closeMenu();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu();});
inst.addEventListener("click",closeMenu);
/* ---------- account: optional sign-in for sync and email, loaded only when it's needed ---------- */
const acctBtn=$("#acct-btn");
function openAccount(){closeMenu();import("/account.js").then(m=>m.open()).catch(()=>toast("Sign-in couldn't load. Check your connection."));}
acctBtn.addEventListener("click",openAccount);
addEventListener("rm:account",e=>{ACC=e.detail||{signedIn:false};acctBtn.textContent=ACC.signedIn?"Your account":"Sign in to sync and get email";if(S.held)renderBottom();});
try{if(localStorage.getItem("rm:acct")==="1")import("/account.js").then(m=>m.boot()).catch(()=>{});}catch(e){}
/* ---------- Ctrl or Cmd + K: search and commands, loaded the first time it's asked for ---------- */
const go=h=>{const u=new URL(h,location.href);if(u.origin!==location.origin||!/^\/(r\/|$)/.test(u.pathname))return location.assign(u.href);S.back=true;history.pushState(null,"",u.pathname+u.search+u.hash);route();};
const newOne=t=>{if(!$("#view").hidden)go("/");if(t){C.input.value=t;C.input.dispatchEvent(new Event("input"));}C.input.focus();};
function openPalette(){if(document.querySelector(".sheet:not([hidden]):not(#menu):not(#pal)"))return;closeMenu();Promise.all([import("/palette.js"),loadLists()]).then(([m])=>m.open({recs:L.recs,links:L.links,go,newOne,float:PIP&&!FL.no&&!$("#view").hidden&&S.held&&/before|later/.test(S.phase)?floatIt:null,floating:FL.on&&FL.k===S.rkey}))
  .catch(()=>toast("Search couldn't load. Check your connection."));}
document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&(e.key||"").toLowerCase()==="k"){e.preventDefault();openPalette();}});
$("#cmd-btn").addEventListener("click",openPalette);if(/Macintosh|iPhone|iPad/.test(UA))$("#cmd-k").textContent="⌘K";
/* Sheets: Tab stays inside an open sheet, and focus goes back where it was when the sheet closes. */
let lastOut=null;document.addEventListener("focusin",e=>{if(!e.target.closest(".sheet"))lastOut=e.target;});
document.addEventListener("keydown",e=>{if(e.key!=="Tab")return;const s=[...document.querySelectorAll(".sheet")].find(x=>!x.hidden);if(!s)return;
  const f=[...s.querySelectorAll("a[href],button,input,select")].filter(x=>x.offsetParent);if(!f.length)return;const a=f[0],z=f[f.length-1],el=document.activeElement;
  if(!s.contains(el)||(e.shiftKey?el===a:el===z)){e.preventDefault();(e.shiftKey?z:a).focus();}});
new MutationObserver(ms=>{for(const m of ms){const s=m.target,el=document.activeElement;if(s.classList.contains("sheet")&&s.hidden&&(s.contains(el)||el===document.body)&&lastOut&&lastOut.isConnected)lastOut.focus({preventScroll:true});}})
  .observe(document.body,{subtree:true,attributes:true,attributeFilter:["hidden"]});
/* shared with push.js */
window.__rm={OWN,IOS,STANDALONE,TZ,openSheet,toast,fShort,refresh:()=>{if(D.mode==="lists"&&!$("#home").hidden)renderLists();else loadLists();}};
if("serviceWorker" in navigator&&OWN&&location.protocol==="https:")navigator.serviceWorker.register("/sw.js").catch(()=>{});
