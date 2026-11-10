/* remmynd app: the maker, the ticket and routing. Loaded as an ES module by index.html.
 * The library (remmynd.js) reads typed lines and makes links, so the site and the npm package agree. */
import * as R from "/remmynd.js";
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
const city=tz=>(tz.split("/").pop()||tz).replace(/_/g," ");
const pad=n=>String(n).padStart(2,"0");
const isHttp=s=>/^https?:\/\//i.test(s||"");
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* Named pages: remmynd.space/<name>. Each returns a reminder object. */
const PRESETS={
  example:()=>{const p=parts(new Date(Date.now()+3*864e5),TZ);return{t:"Example: launch day",s:pack(zonedToUTC(p.y,p.mo,p.d,18,0,TZ)),d:60,l:"https://remmynd.space",n:"This is a sample reminder. Make your own in a few seconds."};}
};
/* ---------- calendar payloads (credit lives in the description; nothing about the viewer is included) ---------- */
const stamp=d=>d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
const iesc=s=>String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
const te=new TextEncoder();
function fold(l){const out=[];let cur="",n=0;for(const ch of l){const b=te.encode(ch).length;if(n+b>73){out.push(cur);cur=" ";n=1;}cur+=ch;n+=b;}out.push(cur);return out.join("\r\n");}
function hash(s){let h=5381;for(const c of s)h=(h*33)^c.charCodeAt(0);return(h>>>0).toString(36);}
function eventOf(r,key,start,title,mins){
  const share=linkFor(r,key,S.priv),end=new Date(start.getTime()+mins*6e4);
  const head=[r.n,isHttp(r.l)?"Join: "+r.l:""].filter(Boolean);
  const desc=(head.length?head.join("\n")+"\n\n":"")+"Reminder link: "+share+"\nMade with remmynd.space · free reminder links, no sign-up";
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
  mark:'<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.947 7.775A9 9 0 1 1 14.781 3.44" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12L15.214 8.17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.24" fill="currentColor"/><circle cx="17.785" cy="5.106" r="2.1" fill="var(--moment)"/></svg>'
};

/* ---------- ticket ---------- */
const S={r:null,key:null,priv:false,morning:null,blob:null};
/* The host's own clock, when the link carries their zone (z) and it differs from the viewer's. */
function hostTime(start,z){if(!z||z===TZ)return"";try{const t=fShort(start,z),day=fDate(start,z)!==fDate(start,TZ);if(!day&&t===fShort(start,TZ))return"";
  return'<div class="t-zone">Host time · '+esc((day?new Intl.DateTimeFormat(undefined,{timeZone:z,weekday:"short"}).format(start)+" ":"")+t)+' · '+esc(city(z))+'</div>';}catch(e){return"";}}
function countHTML(start){return'<div class="t-count" data-until="'+start.getTime()+'"></div>';}
function tick(){document.querySelectorAll("[data-until]").forEach(el=>{const ms=+el.dataset.until-Date.now();
  if(ms<=0){if(!el.dataset.done){el.innerHTML='<span class="live"><span class="dot"></span>Live now</span>';el.dataset.done=1;}return;}
  delete el.dataset.done;const d=Math.floor(ms/864e5),h=Math.floor(ms%864e5/36e5),m=Math.floor(ms%36e5/6e4),s=Math.floor(ms%6e4/1e3);
  el.innerHTML=(d?'<div><b>'+d+'</b><i>days</i></div>':'')+'<div><b>'+pad(h)+'</b><i>hrs</i></div><div><b>'+pad(m)+'</b><i>min</i></div><div><b>'+pad(s)+'</b><i>sec</i></div>';});}
setInterval(tick,1000);

function renderTicket(el,r,o){
  const start=startOf(r),p=parts(start,TZ),night=p.h>=23||p.h<7;
  if(o.interactive&&S.morning===null)S.morning=night;
  const morning=o.interactive&&night&&S.morning;
  const when=morning?morningOf(start,TZ):start;
  const t=fTime(start,TZ);
  const where=r.l?'<div class="t-where">'+(isHttp(r.l)?I.link+'<a href="'+esc(r.l)+'" target="_blank" rel="noopener">'+esc(r.l.replace(/^https?:\/\//,"").replace(/\/$/,""))+'</a>':I.pin+'<span>'+esc(r.l)+'</span>')+'</div>':'';
  const sub=PREF==="apple"?"Adds to your calendar with alerts":"Opens Google Calendar · tap Save";
  el.innerHTML=
   '<div class="t-top">'+
     '<div class="t-host"><span class="dot"></span>'+(r.h?"From "+esc(r.h):"Reminder")+'</div>'+
     '<h2 class="t-title'+(o.ph?" ph":"")+'">'+esc(r.t)+'</h2>'+
     '<div><div class="t-date">'+esc(fDate(start,TZ))+'</div><div class="t-time">'+esc(t.main)+(t.per?'<small>'+esc(t.per)+'</small>':'')+'</div>'+
     '<div class="t-zone">Your time · '+esc(city(TZ))+' ('+esc(fZone(start,TZ))+')</div>'+hostTime(start,r.z)+'</div>'+
     countHTML(start)+where+(r.n?'<p class="t-notes">'+esc(r.n)+'</p>':'')+
   '</div><div class="t-perf" aria-hidden="true"><span></span></div>'+
   '<div class="t-bottom">'+
     (o.interactive&&night?'<div class="sleep"><span>That’s <b>'+esc(fShort(start,TZ))+'</b> for you. Remind me at <b>'+esc(fShort(morningOf(start,TZ),TZ))+'</b> instead.</span><label class="switch"><input type="checkbox" id="sleep"'+(morning?" checked":"")+' aria-label="Remind me in the morning instead"><span></span></label></div>':'')+
     (o.interactive?'<a class="remind" id="remind">'+I.bell+'Remind me</a><div class="t-sub">'+sub+'</div>'+
       '<div class="alts"><a id="a-google" target="_blank" rel="noopener">Google</a><a id="a-apple">Apple</a><a id="a-outlook" target="_blank" rel="noopener">Outlook</a><a id="a-o365" target="_blank" rel="noopener">Office 365</a><button type="button" id="a-share">Reminders &amp; Notes</button><button type="button" id="a-copy">Copy</button></div><div id="notify-row"></div>'
     :'<div class="remind" aria-hidden="true">'+I.bell+'Remind me</div>')+
     '<a class="via" href="'+BASE+'" target="_blank" rel="noopener">'+I.mark+'remmynd</a>'+
   '</div>';
  tick();
  if(!o.interactive)return;
  const title=morning?r.t+" (live since "+fShort(start,TZ)+")":r.t;
  const ev=eventOf(r,S.key,when,title,morning?15:(r.d||60));
  const file=(r.t.replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase().slice(0,40)||"reminder")+".ics";
  let icsHref,useDownload;
  if(IN_APP&&IOS&&OWN){icsHref="/ics?d="+enc({t:title,s:pack(when),d:morning?15:(r.d||60),l:r.l,n:r.n,u:linkFor(r,S.key,S.priv),k:pack(start),o:r.t});useDownload=false;}
  else{if(S.blob)URL.revokeObjectURL(S.blob);S.blob=URL.createObjectURL(new Blob([ics(ev)],{type:"text/calendar;charset=utf-8"}));icsHref=S.blob;useDownload=true;}
  const setApple=a=>{a.href=icsHref;if(useDownload)a.download=file;};
  const g=gcal(ev);
  $("#a-google").href=g;setApple($("#a-apple"));
  $("#a-outlook").href=outlook(ev,"outlook.live.com");$("#a-o365").href=outlook(ev,"outlook.office.com");
  const btn=$("#remind");
  if(PREF==="apple")setApple(btn);else{btn.href=g;btn.target="_blank";btn.rel="noopener";}
  const after=msg=>()=>{btn.classList.remove("rung");void btn.offsetWidth;btn.classList.add("rung");setTimeout(()=>toast(msg),250);};
  btn.addEventListener("click",after(PREF==="apple"?"Your calendar will ask you to add it":"Google Calendar opened. Tap Save to finish."));
  $("#a-google").addEventListener("click",()=>setTimeout(()=>toast("Tap Save in Google Calendar"),250));
  $("#a-apple").addEventListener("click",()=>setTimeout(()=>toast("Open the file to add it to your calendar"),250));
  $("#a-share").addEventListener("click",()=>shareIt({title:r.t,text:r.t+" · "+fDate(start,TZ)+", "+fShort(start,TZ),url:linkFor(r,S.key,S.priv)},"Pick Reminders or Notes to save it"));
  $("#a-copy").addEventListener("click",()=>copy(r.t+"\n"+fDate(start,TZ)+", "+fShort(start,TZ)+" ("+fZone(start,TZ)+")"+(r.l?"\n"+r.l:"")+"\n"+linkFor(r,S.key,S.priv),"Copied"));
  const sw=$("#sleep");if(sw)sw.addEventListener("change",()=>{S.morning=sw.checked;renderTicket(el,r,o);});
  const nd={el:$("#notify-row"),r,key:S.key,start,share:linkFor(r,S.key,S.priv),morningAt:morning?when:null};window.__rmLast={type:"ticket",detail:nd};window.dispatchEvent(new CustomEvent("rm:ticket",{detail:nd}));
}

/* ---------- utilities ---------- */
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("show"),2400);}
function copy(text,msg){const ok=()=>toast(msg||"Copied");const fb=()=>{const ta=document.createElement("textarea");ta.value=text;ta.setAttribute("readonly","");ta.style.cssText="position:fixed;opacity:0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy")?ok():toast("Select the text and copy it");}catch(e){toast("Select the text and copy it");}ta.remove();};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(ok,fb);else fb();}
async function shareIt(data,msg){if(navigator.share){try{await navigator.share(data);toast(msg);return;}catch(e){if(e&&e.name==="AbortError")return;}}copy(data.url,"Link copied. Paste it into Reminders or Notes.");}

/* ---------- maker: one line in, a link out ---------- */
const C={form:$("#cap-form"),input:$("#cap"),label:$("#cap-l"),hero:$("#hero"),try:$("#try"),draft:$("#draft"),ready:$("#ready"),prev:$("#t-preview"),hint:$("#draft-hint"),
  what:$("#c-what"),when:$("#c-when"),whenIn:$("#c-when-in"),where:$("#c-where"),note:$("#c-note"),edit:$("#edit"),editIn:$("#edit-in"),editL:$("#edit-l"),editOk:$("#edit-ok")};
const F={link:$("#f-link"),copy:$("#f-copy"),share:$("#f-share"),priv:$("#f-private"),copied:$("#copied"),card:$("#ready-card")};
/* D.line is the typed line; D.set holds parts fixed with a chip, which win over the line; D.made is the last link made. */
const D={line:"",set:{},made:null,mode:"home",editing:null};
const short=u=>String(u||"").replace(/^https?:\/\//,"").replace(/\/$/,"");
const webish=s=>/^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/|$)/i.test(s);
const nextHour=()=>new Date(Math.ceil((Date.now()+1)/36e5)*36e5);
function draft(){const p=R.parse(D.line,{timeZone:TZ});return Object.assign({title:p.title,start:p.start,dur:p.dur,place:p.place,notes:""},D.set);}
function whenText(d){return fDate(d,TZ)+" · "+fShort(d,TZ);}
function setMode(m){D.mode=m;C.hero.hidden=C.try.hidden=m!=="home";C.draft.hidden=m!=="draft";C.ready.hidden=m!=="ready";$("#badge").hidden=$(".facts").hidden=m==="draft";
  C.form.classList.toggle("typing",m==="draft");C.label.textContent=m==="draft"?"Enter makes the link":"New reminder";
  const n=$("#nav-right");if(m==="draft"){n.textContent="Cancel";n.href="/";n.dataset.act="cancel";}else{n.textContent="See an example";n.href="/#example";delete n.dataset.act;}}
function chip(el,text,empty){el.querySelector("b").textContent=text;el.classList.toggle("empty",!!empty);}
function renderDraft(){const d=draft();
  renderTicket(C.prev,{t:d.title||"Your event",s:pack(d.start||nextHour()),...(d.dur&&d.dur!==60?{d:d.dur}:{}),...(d.place?{l:d.place}:{}),...(d.notes?{n:d.notes}:{}),z:TZ},{interactive:false,ph:!d.title});
  chip(C.what,d.title||"Add what",!d.title);chip(C.when,d.start?whenText(d.start):"Pick a time",!d.start);chip(C.where,d.place?short(d.place):"Add a place",!d.place);
  C.note.textContent=d.notes?"Note: "+(d.notes.length>24?d.notes.slice(0,24)+"…":d.notes):"+ Note";C.note.classList.toggle("add",!d.notes);
  const s=d.start||nextHour(),p=parts(s,TZ);C.whenIn.value=p.y+"-"+pad(p.mo)+"-"+pad(p.d)+"T"+pad(p.h)+":"+pad(p.mi);
  C.hint.textContent=!d.title?"Add what it is to make the link.":!d.start?"Add a time to make the link.":"Not a link yet. Press Enter to make it.";}
function renderMaker(){if(D.mode==="draft")renderDraft();snippet();}
function clearDraft(){D.line="";D.set={};C.input.value="";closeEdit();setMode(D.made?"ready":"home");renderMaker();}
C.input.addEventListener("input",()=>{D.line=C.input.value;if(D.line.trim()||Object.keys(D.set).length){if(D.mode!=="draft")setMode("draft");renderDraft();}else if(D.mode==="draft"){setMode(D.made?"ready":"home");}});
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
  D.made={ev,link};D.line="";D.set={};C.input.value="";closeEdit();
  showReady();copy(link,"Link copied. Share it anywhere.");keepLink();}
function keepLink(prev){const m=D.made;if(!m||!window.remmyndDB)return;const DB=window.remmyndDB;
  (prev?DB.del("links",prev):Promise.resolve()).then(()=>DB.put("links",{share:m.link,title:m.ev.title,start:m.ev.start.getTime(),createdAt:Date.now(),private:F.priv.checked})).catch(()=>{});}
function showReady(){const m=D.made;F.link.value=m.link;
  F.card.href=m.link;F.card.innerHTML=I.mark+'<span><b>'+esc(m.ev.title)+'</b><i>'+esc(whenText(m.ev.start))+(m.ev.location?' · '+esc(short(m.ev.location)):'')+'</i></span>';
  F.copied.hidden=false;clearTimeout(F.copied._t);F.copied._t=setTimeout(()=>{F.copied.hidden=true;},2600);setMode("ready");snippet();}
F.priv.addEventListener("change",()=>{const m=D.made;if(!m)return;const prev=m.link;m.link=R.createLink(m.ev,{base:BASE,private:F.priv.checked});
  showReady();copy(m.link,F.priv.checked?"Private link copied":"Link copied");keepLink(prev);});
F.copy.addEventListener("click",()=>F.link.value&&copy(F.link.value,"Link copied. Share it anywhere."));
F.share.addEventListener("click",()=>{const m=D.made;if(!m)return;shareIt({title:m.ev.title,text:"Get a reminder: "+m.ev.title,url:m.link},"Shared");});
F.link.addEventListener("focus",()=>F.link.select());
/* Keep the bar above the on-screen keyboard where the browser doesn't move fixed elements itself. */
if(window.visualViewport){const vv=window.visualViewport,kb=()=>document.documentElement.style.setProperty("--kb",Math.max(0,Math.round(innerHeight-vv.height-vv.offsetTop))+"px");vv.addEventListener("resize",kb);vv.addEventListener("scroll",kb);}
let SNIP={fmt:"html",theme:"light"};
/* Try one: three examples worked out from today, so they are never in the past. */
(function tryOne(){const list=["Demo day Fri 5pm","Rent due 1st","Call Mum Sun 7:30pm"].map(line=>{const p=R.parse(line,{timeZone:TZ});return{p,link:R.createLink({title:p.title,start:p.start,timeZone:TZ},{base:BASE})};});
  $("#try-list").innerHTML=list.map(x=>'<a class="row" href="'+esc(x.link)+'">'+I.mark+'<span><b>'+esc(x.p.title)+'</b><i>'+esc(whenText(x.p.start))+'</i></span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>').join("");})();

/* ---------- badge ---------- */
function badgeSVG(theme){const dk=theme==="dark",bg=dk?"#0e0f11":"#ffffff",st=dk?"#2a2c31":"#e3e5e8",fg=dk?"#f2f3f5":"#0e0f11",mu=dk?"#9aa0a8":"#666c75",dot=dk?"#ffb52e":"#f2a000";
  return'<svg xmlns="http://www.w3.org/2000/svg" width="172" height="44" viewBox="0 0 172 44" role="img" aria-label="Remind me, with remmynd"><rect x=".5" y=".5" width="171" height="43" rx="21.5" fill="'+bg+'" stroke="'+st+'"/><g transform="translate(13 10)" fill="none"><path d="M19.947 7.775A9 9 0 1 1 14.781 3.44" stroke="'+fg+'" stroke-width="2" stroke-linecap="round"/><path d="M12 12L15.214 8.17" stroke="'+fg+'" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.24" fill="'+fg+'"/><circle cx="17.785" cy="5.106" r="2.1" fill="'+dot+'"/></g><text x="47" y="18.5" font-family="ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="8.5" font-weight="600" letter-spacing=".9" fill="'+mu+'">REMMYND</text><text x="47" y="33" font-family="ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="15" font-weight="600" letter-spacing="-.2" fill="'+fg+'">Remind me</text></svg>';}
$("#badges").innerHTML='<a href="/#example" aria-label="Light badge example">'+badgeSVG("light")+'</a><a href="/#example" aria-label="Dark badge example">'+badgeSVG("dark")+'</a>';
function snippet(){const L=F.link.value||"https://remmynd.space/r/your-link",img="https://remmynd.space/badge"+(SNIP.theme==="dark"?"-dark":"")+".svg";
  $("#snip").textContent=SNIP.fmt==="md"?"[![Remind me]("+img+")]("+L+")":'<a href="'+L+'" target="_blank" rel="noopener">\n  <img src="'+img+'" alt="Remind me" width="172" height="44">\n</a>';}
document.querySelectorAll("[data-fmt],[data-theme-b]").forEach(b=>b.addEventListener("click",()=>{const k=b.dataset.fmt?"fmt":"theme";SNIP[k]=b.dataset.fmt||b.dataset.themeB;
  b.parentElement.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));snippet();}));
$("#snip-copy").addEventListener("click",()=>copy($("#snip").textContent,"Code copied"));

/* ---------- routing ---------- */
function showHome(){$("#view").hidden=true;$("#home").hidden=false;C.form.hidden=false;document.body.classList.add("has-cap");setMode(D.mode);document.title="remmynd";renderMaker();window.__rmLast={type:"home"};window.dispatchEvent(new Event("rm:home"));}
function showView(r,key,priv){S.r=r;S.key=key;S.priv=!!priv;S.morning=null;$("#home").hidden=true;$("#view").hidden=false;C.form.hidden=true;document.body.classList.remove("has-cap");const n=$("#nav-right");n.textContent="Make your own";n.href="/";delete n.dataset.act;
  renderTicket($("#t-view"),r,{interactive:true});document.title=r.t+" · remmynd";window.scrollTo(0,0);}
/* /r/<payload> is a shared link, /#<payload> a private one (and every 1.x link), /#<name> a named page. */
let routed="";
function route(){if(location.href===routed)return;routed=location.href;const p=location.pathname;
  if(p.startsWith("/r/")){const r=dec(p.slice(3).replace(/\/+$/,""));return r?showView(r,null,false):showHome();}
  if(p==="/new"||p==="/new/")return fromNew();
  const h=decodeURIComponent(location.hash.slice(1));if(PRESETS[h])return showView(PRESETS[h](),h,false);const r=h&&dec(h);if(r)return showView(r,null,true);showHome();}
/* /new?t=…&at=… lands here only when the time has no zone. Read it in this device's zone with the library itself, then show the /r/ link. */
function fromNew(){const q=new URLSearchParams(location.search);
  const ev=R.fromQuery(q,{timeZone:TZ});if(ev){history.replaceState(null,"",R.toPath(ev));return route();}
  history.replaceState(null,"","/");routed=location.href;
  const set={};for(const[k,key]of[["t","title"],["l","place"],["n","notes"]]){const v=(q.get(k)||"").trim();if(v)set[key]=key==="place"&&webish(v)&&!/^https?:\/\//i.test(v)?"https://"+v:v;}
  D.set=set;D.mode=Object.keys(set).length?"draft":"home";showHome();toast("Add what's missing to make the link");}
const goHome=e=>{e.preventDefault();if(location.pathname==="/"&&!location.hash)return showHome();history.pushState(null,"","/");route();};
$("#home-link").addEventListener("click",goHome);$("#make-own").addEventListener("click",goHome);
$("#nav-right").addEventListener("click",e=>{const n=e.currentTarget;if(n.dataset.act==="cancel"){e.preventDefault();return clearDraft();}if(n.getAttribute("href")==="/")goHome(e);});
window.addEventListener("hashchange",route);window.addEventListener("popstate",route);route();

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
function refreshInstall(){installMode=detectInstall();const show=!!installMode&&OWN;inst.hidden=!show;heroInst.hidden=!show;}
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
/* shared with push.js */
window.__rm={OWN,IOS,STANDALONE,TZ,openSheet,toast,fShort};
if("serviceWorker" in navigator&&OWN&&location.protocol==="https:")navigator.serviceWorker.register("/sw.js").catch(()=>{});
