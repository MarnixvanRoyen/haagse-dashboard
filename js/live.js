// live.js — live muziekcijfers (YouTube + SoundCloud ververst bij openen), gebruikt door Ovâhzicht en Muziek

/* ---------- Live muziekcijfers ----------
   YouTube en SoundCloud: bij het openen vraagt de app Supabase om nieuwe cijfers (rpc muziek_live,
   hooguit 1x per 10 min). "Vandaag erbè" = laatste meting van vandaag min de laatste meting van de dag ervoor.
   Spotify heeft geen API: daar is het verschil tussen de laatste twee CSV-exports. */
const LIVE={yt:null,sc:null,gc:null,ig:null,th:null,bezig:false,t:0};
store.del("hc_muziek_gezien");                         // oude "sinds je vorige bezoek"-telling opruimen
function vandaagAms(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Amsterdam"}).format(new Date())}
function tijdAms(ts){return ts?new Date(ts).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Amsterdam"}):""}
function gisteren(d){const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()-1);return x.toISOString().slice(0,10)}

// per nummer: stand op de laatste dag min de stand van de meting daarvoor
function dagGroei(snaps,idVeld,veld){
  if(!snaps||!snaps.length)return null;
  const dates=[...new Set(snaps.map(s=>s.snap_date))].sort();
  const last=dates[dates.length-1],prevDag=dates.length>1?dates[dates.length-2]:null;
  const per=new Map();
  snaps.forEach(s=>{if(s[veld]==null)return;let m=per.get(s[idVeld]);if(!m){m=[];per.set(s[idVeld],m)}m.push(s)});
  let tot=0,erbe=0;const perId=new Map();
  per.forEach((rows,id)=>{rows.sort((a,b)=>a.snap_date<b.snap_date?-1:1);
    const cur=rows[rows.length-1];if(cur.snap_date!==last)return;
    tot+=+cur[veld];
    if(!prevDag)return;
    const prev=rows.length>1?rows[rows.length-2]:null;
    const d=prev?(+cur[veld])-(+prev[veld]):(+cur[veld]);   // nieuw nummer: alles telt als erbè
    erbe+=d;perId.set(id,d);
  });
  return {last,prevDag,tot,erbe,per:perId,vandaag:!!prevDag&&last===vandaagAms()};
}
// tekst voor "vandaag erbè": groot getal (v) + uitleg (s), inclusief of hij net ververst is
function liveInfo(bron,g){
  const L=LIVE[bron]||{},vandaag=L.vandaag||vandaagAms();
  let status="";
  if(LIVE.bezig)status=" · effe bèwerke…";
  else if(L.fout)status=/muziek_live/.test(L.fout)?" · live staat nog uit (draai 07_live.sql)":" · live ophalen lukte nie";
  else if(L.om&&g&&g.last===vandaag)status=" · bègewerkt "+tijdAms(L.om);
  if(!g)return {v:"—",s:"nog geen meting"+status,leeg:true};
  if(!g.prevDag)return {v:"—",s:"eerste meting, morgen zie je wat erbè komt"+status};
  const v=(g.erbe>0?"+":"")+nf0.format(g.erbe);
  if(g.last!==vandaag)return {v,s:`erbè op ${dLabel(g.last)} · vandaag nog geen meting${status}`};
  let sinds;
  if(g.prevDag===gisteren(vandaag))sinds=L.vorige_om&&L.vorige_dag===g.prevDag?"sinds gisteren "+tijdAms(L.vorige_om):"sinds de meting van gisteren";
  else sinds="sinds "+dLabel(g.prevDag);
  return {v,s:`vandaag erbè (${sinds})${status}`};
}
// laatste meettijd van vandaag, voor de uitleg bovenaan de tabbladen
function laatsteMeting(bron,g){const L=LIVE[bron]||{};
  return g?dLabel(g.last,1)+(L.om&&g.last===(L.vandaag||vandaagAms())?" "+tijdAms(L.om):""):"nog geen"}
// YouTube, SoundCloud, GoatCounter (Sneek-bezoekers), Insta en Threads tegelijk verversen, elk een eigen vraag (i.v.m. tijdslimiet)
async function muziekLive(){
  if(!sb||LIVE.bezig||Date.now()-LIVE.t<10*60e3)return;
  LIVE.bezig=true;LIVE.t=Date.now();hertekenLive();
  const bronnen=["yt","sc","gc","ig","th"];
  // na de Ververse-knop bovenaan mag het al na 5 min opnieuw (de oude "Nâh ververse"-knoppen per tabblad deden dat ook); gewoon openen: 10 min
  const mm=VERVERS_GEDRUKT?5:10;VERVERS_GEDRUKT=false;
  const res=await Promise.all(bronnen.map(b=>(b==="gc"?sb.rpc("gc_live",{min_minuten:mm}):b==="ig"?sb.rpc("ig_live",{min_minuten:mm}):b==="th"?sb.rpc("th_live",{min_minuten:mm}):sb.rpc("muziek_live",{bron:b,min_minuten:mm})).then(r=>r,e=>({error:e}))));
  const laden=[];
  res.forEach((r,i)=>{const b=bronnen[i];
    LIVE[b]=r.error?{fout:r.error.message||String(r.error)}:r.data;
    if(r.data&&r.data.ververst)laden.push(b==="yt"?loadYT():b==="sc"?loadSCL():b==="ig"?loadIG():b==="th"?loadTH():loadGC());});
  await Promise.all(laden);
  LIVE.bezig=false;
  hertekenLive();
}
function hertekenLive(){
  if(sectie==="ovahzicht"){renderOvahzicht();vnPopTeken()}
  else if(sectie==="muziek"&&(state.tab==="youtube"||state.tab==="sclive"))render();
  else if(sectie==="apps")renderSneek();
  else if(sectie==="insta")renderInsta();
  else if(sectie==="threads")renderThreads();
  else if(sectie==="kansen")renderKansen();
}
// statusstukje achter een live-getal: bezig / fout / wanneer bijgewerkt
function liveStatus(bron,sqlNaam){const L=LIVE[bron]||{};
  if(LIVE.bezig)return " · effe bèwerke…";
  if(L.fout)return new RegExp(bron==="gc"?"gc_live|gc_uur":bron==="ig"?"ig_live":"muziek_live").test(L.fout)?` · live staat nog uit (draai ${sqlNaam})`:" · live ophalen lukte nie";
  return L.om?" · bègewerkt "+tijdAms(L.om):"";
}
// app weer in beeld (bijv. telefoon uit je zak)? dan opnieuw proberen, hooguit 1x per 10 min
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!$("app").hidden)muziekLive()});

/* ---------- Wat draaide d'r vandaag? (02-10, chat 09) ----------
   YouTube- en SoundCloud-tab: liggende staaf per nummâh met vandaag ≥ 1 erbè, meeste bovenaan.
   Vandaag = laatste meting van vandaag min de laatste meting van de dag ervoor (per nummer), dus dezelfde
   dagGroei() als de tegel "Vandaag erbè": geen extra Supabase-vraag. YouTube: zelfde titel (track + eigen video)
   samen, net als Meest bekeke/Groeiâhs. Spotify hoort hier bewust niet bij (geen dagcijfers, alleen CSV's). */
const VN_MAX=15;                         // eerst de top 15; knop "Toon allâh" voor de rest
const VN_ALLES={yt:false,sc:false};      // knop aangetikt? (alleen tot herladen)
// gedeelde nummerlijst (06-10, chat 14): naam + sleutel per video/track. YouTube: zelfde titel = één nummâh
// (track + eigen video samen); SoundCloud: elk nummer apart. Gebruikt door "Wat draaide d'r vandaag?" (en de regel Likes op Ovâhzicht).
function nummerNaam(bron){
  const yt=bron==="yt",idV=yt?"video_id":"track_id";
  const titel=new Map((yt?YT.videos:SCL.tracks).map(x=>[x[idV],x.title]));
  return id=>{const naam=String(titel.get(id)||id).trim();return {naam,k:yt?naam.toLowerCase():id,artiest:muziekArtiest(bron,id,naam)}};
}
// artiest per nummer: nu nog nie bekend (geen artiestkolom in yt_videos/sc_tracks). Chat 05 (Beuk splitsen):
// alleen deze functie aanpassen ("Marreman Rojas"/"Beuk") en in vandaagNummers op r.artiest filteren.
function muziekArtiest(bron,id,naam){return null}
function vandaagNummers(bron){
  const yt=bron==="yt",snaps=yt?YT.snaps:SCL.snaps,idV=yt?"video_id":"track_id",veld=yt?"views":"plays";
  const g=dagGroei(snaps,idV,veld);
  if(!g||!g.prevDag)return {g,rijen:[],likes:0};
  const gl=dagGroei(snaps,idV,"likes");                     // likes vandaag: zelfde rekenregel (06-10, chat 14)
  const nn=nummerNaam(bron);
  const stand=new Map(),lstand=new Map();
  snaps.forEach(s=>{if(s.snap_date!==g.last)return;if(s[veld]!=null)stand.set(s[idV],+s[veld]);if(s.likes!=null)lstand.set(s[idV],+s.likes)});
  const per=new Map(),ids=new Set();
  const rij=id=>{const {naam,k}=nn(id);let r=per.get(k);if(!r){r={naam,n:0,tot:0,l:0,lt:0,versies:0};per.set(k,r)}
    if(!ids.has(id)){ids.add(id);r.tot+=stand.get(id)||0;r.lt+=lstand.get(id)||0;r.versies++}return r};
  g.per.forEach((d,id)=>{rij(id).n+=d});
  if(gl&&gl.prevDag)gl.per.forEach((d,id)=>{if(d)rij(id).l+=d});
  // getoond: nummâhs met ≥ 1 play/weergave erbè, óf met likes erbij/eraf vandaag
  const rijen=[...per.values()].filter(r=>r.n>=1||r.l!==0).sort((a,b)=>b.n-a.n||b.l-a.l||a.naam.localeCompare(b.naam,"nl"));
  return {g,rijen,likes:rijen.reduce((a,r)=>a+r.l,0)};
}
function renderVandaagNummers(bron,el,sub){      // el/sub meegeven = ergens anders tekenen (pop-up op Ovâhzicht)
  const yt=bron==="yt";el=el||$(yt?"ytVandaag":"sclVandaag");sub=sub||$(yt?"ytVandaagSub":"sclVandaagSub");
  if(!el||!sub)return;
  const eenheid=yt?"weergaven":"plays",kleur=yt?"yt":"sc",L=LIVE[bron]||{},vandaag=L.vandaag||vandaagAms();
  const leeg=t=>{el.innerHTML=`<p class="sub vnleeg">${t}</p>`};
  if(yt?YT.err:SCL.err){sub.textContent="Per nummâh wat er vandaag bij kwam.";leeg("Geen cijfers: ophalen lukte nie (zie hierboven).");return}
  const {g,rijen,likes}=vandaagNummers(bron);
  // uitleg: wat er gemeten is, wanneer, en dat het iets achterloopt
  const nu=g&&g.last===vandaag?(L.om&&L.vandaag===g.last?"vandaag "+tijdAms(L.om):"vandaag"):null;
  const toen=!g||!g.prevDag?"":g.prevDag===gisteren(g.last)?(L.vorige_om&&L.vorige_dag===g.prevDag?"gistâh "+tijdAms(L.vorige_om):"gistâh"):dKort(g.prevDag);
  sub.textContent=`Per nummâh hoeveel ${eenheid} en likes (♥) er vandaag bij kwamen: meting ${nu||"van vandaag"} min die van ${toen||"gistâh"}. `+
    `Loopt iets achter: het dashboard meet hooguit 1x per 10 min (na Ververse 5)${yt?" en YouTube telt zelf ook met vertraging":""}.`;
  if(!g){leeg(LIVE.bezig?"Effe bèwerke… de eerste meting wordt opgehaald.":"Nog geen metingen. Tik bovenaan op Ververse.");return}
  if(!g.prevDag){leeg("Eerste meting: vanaf morgen zie je hier per nummâh wat erbè kwam.");return}
  if(g.last!==vandaag){leeg(LIVE.bezig?"Effe bèwerke… de meting van vandaag wordt opgehaald."
    :`Vandaag nog geen meting (laatste: ${dKort(g.last)}). Tik bovenaan op Ververse${L.fout?"; live ophalen lukte net nie":""}.`);return}
  if(!rijen.length){leeg(`Nog niks erbè vandaag (sinds ${toen}${nu?", gemeten "+nu:""}). Kom later nog effe kèke.`);return}
  const som=rijen.reduce((a,r)=>a+Math.max(0,r.n),0),gedraaid=rijen.filter(r=>r.n>=1).length,alles=VN_ALLES[bron]||rijen.length<=VN_MAX,toon=alles?rijen:rijen.slice(0,VN_MAX);
  const verschil=som!==g.erbe?` <span class="sub">(tegel Vandaag erbè: ${g.erbe>0?"+":""}${nf0.format(g.erbe)}, want bij een nummâh ging de teller omlaag)</span>`:"";
  const lk=`${likes>0?"+":""}${nf0.format(likes)} like${Math.abs(likes)===1?"":"s"}`;
  el.innerHTML=`<p class="vnsamen"><b>${gedraaid}</b> nummâh${gedraaid===1?"":"s"} gedraaid · samen <b>+${nf0.format(som)}</b> ${eenheid} · <b><span class="vnhart" aria-hidden="true">♥</span>${lk}</b>${verschil}</p>
    <div class="chart vnchart"></div>
    ${rijen.length>VN_MAX?`<button class="btn vnmeer" type="button" data-vnalles="${bron}">${alles?"Alleen de top "+VN_MAX:"Toon allâh "+rijen.length+" nummâhs"}</button>`:""}`;
  vnGrafiek(el.querySelector(".vnchart"),toon,kleur,eenheid,yt);
}
// liggende staven: naam links (telefoon afgekapt, volledig bij tikken/aanwijzen), staaf, aantal aan het eind
function vnGrafiek(box,rijen,kleur,eenheid,yt){
  const W=Math.max(280,Math.round(box.clientWidth||800)),tel=W<600;
  const rh=tel?26:28,bh=tel?14:16,mt=22,mb=4;                       // mt: ruimte voor het getal boven de bovenste staaf
  const naamW=tel?Math.min(130,Math.max(92,Math.round(W*.34))):Math.min(240,Math.round(W*.26));
  const metLikes=rijen.some(r=>r.l);
  const x0=naamW+8,valW=metLikes?(tel?84:96):48,iw=W-x0-valW,max=Math.max(1,...rijen.map(r=>r.n)),H=mt+rijen.length*rh+mb;
  const lt=r=>r.l?`♥ ${r.l>0?"+":"−"}${nf0.format(Math.abs(r.l))}`:"";   // likes vandaag achter het getal
  const rechts=(x,y,w,h,r)=>{r=Math.min(r,h/2,w);return `M${x},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h-r}Q${x+w},${y+h} ${x+w-r},${y+h}H${x}Z`};
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${yt?"YouTube-weergaven":"SoundCloud-plays"} vandaag per nummer">`;
  rijen.forEach((r,i)=>{const y=mt+i*rh,yb=y+(rh-bh)/2,w=Math.max(3,Math.max(0,r.n)/max*iw),ym=y+rh/2+4;
    s+=`<text class="vnnaam" x="${naamW}" y="${ym}" text-anchor="end">${esc(r.naam)}</text>`;
    s+=`<path fill="var(--${kleur})" d="${rechts(x0,yb,w,bh,4)}"/>`;
    s+=`<text class="vnval" x="${x0+w+6}" y="${ym}">${r.n>0?"+":""}${nf0.format(r.n)}</text>`;
    if(r.l)s+=`<text class="vnlike" data-i="${i}" x="${x0+w+44}" y="${ym}"><tspan class="hart">♥</tspan> ${r.l>0?"+":"−"}${nf0.format(Math.abs(r.l))}</text>`;
    const nm=tel&&r.naam.length>26?r.naam.slice(0,24).trimEnd()+"…":r.naam;   // telefoon: lange naam kort in het getal-label
    s+=`<rect class="hit" data-i="${i}" x="0" y="${y}" width="${W}" height="${rh}"${staafGetal(x0+w/2,y+4,(r.n>0?"+":"")+nf0.format(r.n)+" "+eenheid+(r.l?" · "+lt(r):""),nm)}/>`});
  s+=`<line class="base" x1="${x0}" x2="${x0}" y1="${mt-2}" y2="${H-mb}"/>`;
  box.innerHTML=s+"</svg>";
  // likes direct achter het getal zetten (breedte van het getal gemeten)
  box.querySelectorAll("text.vnlike").forEach(t=>{const v=t.previousElementSibling;try{t.setAttribute("x",+v.getAttribute("x")+v.getComputedTextLength()+8)}catch(e){}});
  // te lange namen afkappen met … (gemeten, dus past precies); volledige naam bij tikken (toonGetal) en aanwijzen
  box.querySelectorAll("text.vnnaam").forEach(t=>{let vol=t.textContent,k=vol;
    try{while(k.length>1&&t.getComputedTextLength()>naamW-4){k=k.slice(0,-1);t.textContent=k.trimEnd()+"…"}}catch(e){}});
  box.querySelectorAll(".hit").forEach(h=>{const r=rijen[+h.dataset.i];
    h.addEventListener("mousemove",e=>showTip(e,`<div class="t">${esc(r.naam)}</div><div class="r"><span><i class="dot ${kleur}"></i>Vandaag erbij</span><b class="num">+${nf0.format(r.n)}</b></div><div class="r"><span>Totaal</span><b class="num">${nf0.format(r.tot)}</b></div><div class="r"><span><span class="vnhart">♥</span>Likes vandaag</span><b class="num">${r.l>0?"+":""}${nf0.format(r.l)}</b></div><div class="r"><span><span class="vnhart">♥</span>Likes totaal</span><b class="num">${nf0.format(r.lt)}</b></div>${r.versies>1?`<div class="r"><span>${r.versies} versies samen</span></div>`:""}`));
    h.addEventListener("mouseleave",hideTip)});
}
document.addEventListener("click",e=>{const b=e.target.closest&&e.target.closest("[data-vnalles]");if(!b)return;
  const bron=b.dataset.vnalles;VN_ALLES[bron]=!VN_ALLES[bron];renderVandaagNummers(bron);if(VN_POP===bron)vnPopTeken()});

/* ---------- Pop-up op Ovâhzicht (02-10, chat 09) ----------
   Tegel Muziek: tik op de regel SoundCloud-plays of YouTube-weergaven → dezelfde grafiek "Wat draaide d'r vandaag?"
   als pop-up (telefoon: van onderen, Mac: in het midden). Sluiten: ✕, naast de pop-up tikken of Esc.
   Bewust op tikken en nie op "vinger eroverheen": anders springt hij open zodra je langs de tegel scrollt. */
let VN_POP=null;                         // "sc" / "yt" als de pop-up open is
function vnPopOpen(bron){
  VN_POP=bron;$("vnPop").hidden=false;document.body.classList.add("popopen");
  vnPopTeken();$("vnPopDicht").focus({preventScroll:true});
}
function vnPopDicht(){if(!VN_POP)return;const bron=VN_POP;VN_POP=null;$("vnPop").hidden=true;document.body.classList.remove("popopen");hideTip();
  const r=document.querySelector(`[data-vnpop="${bron}"]`);if(r)r.focus({preventScroll:true})}
function vnPopTeken(){
  if(!VN_POP)return;const yt=VN_POP==="yt";
  $("vnPopTitel").innerHTML=`<i class="dot ${yt?"yt":"sc"}"></i> ${yt?"YouTube":"SoundCloud"} · wat draaide d'r vandaag?`;
  $("vnPopNaar").textContent=yt?"Kèk bè YouTube":"Kèk bè SoundCloud live";
  $("vnPopNaar").dataset.vntab=yt?"youtube":"sclive";
  renderVandaagNummers(VN_POP,$("vnPopInhoud"),$("vnPopSub"));
}
document.addEventListener("click",e=>{
  const rij=e.target.closest&&e.target.closest("[data-vnpop]");
  if(rij){vnPopOpen(rij.dataset.vnpop);return}
  if(!VN_POP)return;
  const naar=e.target.closest("#vnPopNaar");
  if(naar){const t=naar.dataset.vntab;vnPopDicht();setSectie("muziek");setTab(t);scrollTo(0,0);return}
  if(e.target.closest("#vnPopDicht")||e.target.id==="vnPop")vnPopDicht();   // ✕ of naast de pop-up (de donkere achtergrond)
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&VN_POP)vnPopDicht();
  const rij=(e.key==="Enter"||e.key===" ")&&e.target.closest&&e.target.closest("[data-vnpop]");
  if(rij){e.preventDefault();vnPopOpen(rij.dataset.vnpop)}
});

/* ---------- Ovâhzicht: regel Likes (06-10, chat 14) ----------
   Tegel Muziek: likes vandaag erbè (SoundCloud + YouTube samen, groot) en de totalen eronder.
   Zelfde rekenregel als "Vandaag erbè" (dagGroei op likes). Per nummâh: tik op de regel SoundCloud of YouTube (pop-up). */
function likesRij(){
  const d={sc:dagGroei(SCL.snaps,"track_id","likes"),yt:dagGroei(YT.snaps,"video_id","likes")};
  if(!d.sc&&!d.yt)return "";
  const vandaag=b=>(LIVE[b]||{}).vandaag||vandaagAms();
  const ok=["sc","yt"].filter(b=>d[b]&&d[b].prevDag&&d[b].last===vandaag(b));
  const erbe=ok.reduce((a,b)=>a+d[b].erbe,0);
  const v=ok.length?(erbe>0?"+":"")+nf0.format(erbe):"—";
  const tot=[d.sc?"SoundCloud "+nf0.format(d.sc.tot):"",d.yt?"YouTube "+nf0.format(d.yt.tot):""].filter(Boolean).join(" · ");
  return tegelRij('<span class="vnhart" aria-hidden="true">♥</span>Likes',v,(ok.length?"vandaag erbè · ":"")+"totaal "+tot);
}
