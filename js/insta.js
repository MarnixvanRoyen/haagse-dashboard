// insta.js — onderdeel Insta (@the_hague_beachlife). Data uit Supabase (09_insta.sql + 09b_insta_extra.sql).
// Let op: Meta rekent dagen in Los Angeles-tijd (9 uur achter op Den Haag). Account-cijfers per dag gebruiken die "Meta-dag".

let IG={acc:null,profiel:[],dag:[],posts:[],stories:[],err:null};
let igKies="soort";            // "Wat werkt": waarop vergelijken
let igLabelAantal=20;          // hoeveel posts in de muziek-lijst
let igAlleenLeeg=false;        // alleen posts zonder muziek-label tonen
let igSorteer="nieuw";         // muziek-lijst: "nieuw" of "bereik"
let igTopPeriode="90";         // toppâhs: "90" (laatste 90 dagen) of "alles" (allâh tijde)
let igTopOp="bereik";          // toppâhs: sorteren op "bereik" of "kwaliteit"
let igStoryPeriode="7";        // stories: "7", "30" of "alles"

async function igAlles(maak){   // haalt alles op, 1000 per keer (Supabase geeft max 1000 regels per vraag)
  let out=[],from=0;
  for(;;){const {data,error}=await maak().range(from,from+999);if(error)throw error;out=out.concat(data);if(data.length<1000)break;from+=1000}
  return out;
}
async function loadIG(){
  try{
    const since=new Date(Date.now()-120*864e5).toISOString().slice(0,10);
    const [a,p,d,m,s]=await Promise.all([
      sb.from("ig_account").select("ig_id,gebruikersnaam,volgers,volgend,posts,bijgewerkt_om").order("bijgewerkt_om",{ascending:false}).limit(1),
      sb.from("ig_profiel_dag").select("dag,volgers,volgend,posts").gte("dag",since).order("dag"),
      sb.from("ig_account_dag").select("dag,cijfers").gte("dag",since).order("dag"),
      igAlles(()=>sb.from("ig_post_stats").select("media_id,soort,product,gepost_om,permalink,plaatje,bijschrift,bereik,weergaven,likes,reacties,bewaard,gedeeld,nieuwe_volgers,profielbezoeken,kijktijd_sec,kwaliteit,volgers_toen,weekdag,uur,labels").order("gepost_om",{ascending:false})),
      sb.from("ig_story").select("media_id,soort,gepost_om,permalink,cijfers,fout").order("gepost_om",{ascending:false}).range(0,1999)]);   // alle stories: ze blijven bewaard, ook na 24 uur
    for(const r of [a,p,d,s])if(r.error)throw r.error;
    IG={acc:a.data[0]||null,profiel:p.data,dag:d.data.map(x=>({dag:String(x.dag).slice(0,10),c:x.cijfers||{}})),posts:m,stories:s.data,err:null};
  }catch(e){IG={acc:null,profiel:[],dag:[],posts:[],stories:[],err:e.message||String(e)}}
  IG.status=await igStatusLaden();
  await igStoryLabels();
  if(typeof igSamenLaden==="function")await igSamenLaden();   // samenwerkingen + Facebook-sleutel (samenwerking.js)
  igBadge();
}
// muziek-keuzes van stories (posts krijgen hun labels al mee via ig_post_stats)
async function igStoryLabels(){
  if(!IG.stories.length)return;
  let rijen=[];try{rijen=await igAlles(()=>sb.from("ig_media_label").select("media_id,soort,label,bron").eq("soort","muziek").eq("weg",false))}catch(e){}
  const per=new Map();rijen.forEach(r=>{if(!per.has(r.media_id))per.set(r.media_id,[]);per.get(r.media_id).push(r)});
  IG.stories.forEach(s=>s.labels=per.get(s.media_id)||[]);
}
// laatste ververs-poging (ig_ververst) en de sleutel (ig_token); los opgehaald, zodat een ontbrekende tabel niks kapot maakt
async function igStatusLaden(){
  const [v,t]=await Promise.all([
    sb.from("ig_ververst").select("om,fout").limit(1).then(r=>r,()=>({})),
    sb.from("ig_token").select("verloopt_op,fout,gecontroleerd_om").limit(1).then(r=>r,()=>({}))]);
  return {ververst:(v.data&&v.data[0])||null,token:(t.data&&t.data[0])||null};
}

/* ---------- Waarschuwing: werkt de koppeling met Meta nog? ----------
   Een fout telt alleen als hij nieuwer is dan de laatste keer dat het wél lukte (ig_account.bijgewerkt_om),
   zodat een oude fout na het maken van een nieuwe sleutel vanzelf verdwijnt. */
const IG_SLEUTELFOUT=/access token|not authori[sz]ed|OAuthException|session has expired|Error validating|\(#190\)|code 190/i;
function igTijd(ts){return new Date(ts).toLocaleString("nl-NL",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Amsterdam"})}
function igKoppeling(){
  const st=IG.status||{},acc=IG.acc;
  const gelukt=acc&&acc.bijgewerkt_om?Date.parse(acc.bijgewerkt_om):0;
  const fouten=[];
  const zet=(tekst,ts)=>{if(tekst&&IG_SLEUTELFOUT.test(tekst)&&(!ts||Date.parse(ts)>gelukt))fouten.push(tekst)};
  if(LIVE.ig&&LIVE.ig.fout)zet(LIVE.ig.fout,LIVE.ig.om||new Date().toISOString());
  if(st.ververst)zet(st.ververst.fout,st.ververst.om);
  if(st.token)zet(st.token.fout,st.token.gecontroleerd_om);
  const sinds=gelukt?igTijd(gelukt):"onbekend";
  if(fouten.length)return {nivo:"kapot",kop:"Insta-koppeling is stuk",
    tekst:`Meta weigert de sleutel. De laatste keer dat het lukte: <b>${sinds}</b>. Tot je een nieuwe sleutel maakt, komen er geen nieuwe Insta-cijfers binnen.`,
    detail:fouten[0].replace(/^[a-z ]+\d*[-\d]*:\s*/i,"")};
  if(gelukt&&Date.now()-gelukt>30*36e5)return {nivo:"oud",kop:"Geen verse Insta-cijfâhs",
    tekst:`De laatste keer dat het ophalen lukte: <b>${sinds}</b> (meer dan een dag geleden). Klik op de Insta-pagina op "Nâh ververse" om het opnieuw te proberen; blijft dit staan, maak dan een nieuwe sleutel.`};
  const vo=st.token&&st.token.verloopt_op?Date.parse(st.token.verloopt_op):0;
  if(vo&&vo-Date.now()<7*864e5)return {nivo:"oud",kop:"Insta-sleutel verloopt bijna",
    tekst:`De sleutel verloopt op <b>${igTijd(vo)}</b> en het automatisch verlengen is niet gelukt. Maak op tijd een nieuwe sleutel.`,detail:st.token.fout||""};
  return null;
}
function igAlarmHTML(){
  const fb=typeof fbAlarmHTML==="function"?fbAlarmHTML():"";   // Facebook-sleutel (samenwerkingen) apart, zie samenwerking.js
  const k=igKoppeling();if(!k)return fb;
  return `<div class="alarm ${k.nivo}" role="alert">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">!</span><h2>${k.kop}</h2></div>
    <p>${k.tekst}</p>
    <details><summary>Zo los je het op (5 minuten)</summary><ol>
      <li>Ga naar <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">developers.facebook.com</a> → <b>My Apps</b> → <b>haagse-dashboard</b> → <b>Use cases</b> → <b>Customize</b> → <b>API setup with Instagram login</b>.</li>
      <li>Klap <b>2. Generate access tokens</b> open en klik bij the_hague_beachlife op <b>Generate token</b> (niet op het prullenbakje).</li>
      <li>Zet alleen <b>Profiel</b> en <b>Statistieken</b> aan, klik <b>Toestaan</b> en kopieer de sleutel.</li>
      <li>Supabase → <b>Integrations</b> → <b>Vault</b> → <code>instagram_access_token</code> → <b>Edit</b> → plakken → <b>Save</b>.</li>
      <li>Klik hier op de Insta-pagina op <b>Nâh ververse</b>. Is het gelukt, dan verdwijnt deze melding vanzelf.</li>
    </ol>${k.detail?`<p class="sub">Melding van Meta: ${esc(k.detail)}</p>`:""}</details>
  </div>`+fb;
}

/* ---------- hulpjes ---------- */
const DAGEN_KORT=["ma","di","wo","do","vr","za","zo"];
const DAGEN_LANG=["maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","zondag"];
function vandaagLA(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles"}).format(new Date())}
function dagMin(d,n){const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()-n);return x.toISOString().slice(0,10)}
const med=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
const plus=v=>(v>0?"+":v<0?"−":"")+nf0.format(Math.abs(v));
function soortNaam(p){return p.product==="REELS"||p.soort==="VIDEO"?"Reel":p.soort==="CAROUSEL_ALBUM"?"Carrousel":p.soort==="IMAGE"?"Foto":p.soort||"?"}
function dagdeel(u){return u<6?"Nacht (0–6)":u<12?"Ochtend (6–12)":u<17?"Middag (12–17)":u<21?"Avond (17–21)":"Laat (21–24)"}
const DAGDELEN=["Ochtend (6–12)","Middag (12–17)","Avond (17–21)","Laat (21–24)","Nacht (0–6)"];
function labelsVan(p,soort){return (p.labels||[]).filter(l=>l.soort===soort).map(l=>l.label)}
function zeker(n){return n>=10?'<span class="chip good">betrouwbaar</span>':n>=5?'<span class="chip warn">voorzichtig</span>':'<span class="chip mute">te weinig</span>'}

// account-cijfers opgeteld over een reeks Meta-dagen
function igSom(van,tot){   // van t/m tot (JJJJ-MM-DD)
  const s={dagen:0};
  IG.dag.forEach(r=>{if(r.dag<van||r.dag>tot)return;s.dagen++;
    for(const [k,v] of Object.entries(r.c))if(typeof v==="number")s[k]=(s[k]||0)+v});
  return s;
}

// nieuwe volgers per 1.000 bereikte niet-volgers over een reeks Meta-dagen (alleen dagen mét opsplitsing volgers/nieuw)
function igPer1kNieuw(van,tot){
  const r=IG.dag.filter(x=>x.dag>=van&&x.dag<=tot&&x.c.reach_nieuw!=null);
  const n=r.reduce((a,x)=>a+x.c.reach_nieuw,0);
  return r.length>=3&&n?r.reduce((a,x)=>a+(x.c.follows||0),0)*1000/n:null;   // minstens 3 dagen, anders zegt het te weinig
}
function igCompute(){
  const vandaag=vandaagLA(),gist=dagMin(vandaag,1);
  const w=igSom(dagMin(vandaag,7),gist), vw=igSom(dagMin(vandaag,14),dagMin(vandaag,8)), nu=igSom(vandaag,vandaag);
  const metSplit=IG.dag.filter(r=>r.dag>=dagMin(vandaag,7)&&r.dag<=gist&&r.c.reach_nieuw!=null);
  const nieuw=metSplit.reduce((a,r)=>a+r.c.reach_nieuw,0), volg=metSplit.reduce((a,r)=>a+(r.c.reach_volgers||0),0);
  const vNieuw=metSplit.reduce((a,r)=>a+(r.c.views_nieuw||0),0), vVolg=metSplit.reduce((a,r)=>a+(r.c.views_volgers||0),0);
  const posts7=IG.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>Date.now()-7*864e5);
  return {vandaag,w,vw,nu,
    bereikDag:w.dagen?(w.reach||0)/w.dagen:null, bereikDagV:vw.dagen?(vw.reach||0)/vw.dagen:null,
    nieuwPct:nieuw+volg?nieuw/(nieuw+volg):null, viewsNieuwPct:vNieuw+vVolg?vNieuw/(vNieuw+vVolg):null,
    kwal:w.reach?((w.shares||0)+(w.saves||0))*1000/w.reach:null, kwalV:vw.reach?((vw.shares||0)+(vw.saves||0))*1000/vw.reach:null,
    follows:w.follows||0, unfollows:w.unfollows||0, posts7:posts7.length,
    // nieuwe volgers per 1.000 bereik (bereik = opgeteld per dag, net als bij 'Bereik per dag'; zelfde rekensom voor beide weken, dus eerlijk te vergelijken)
    volg1k:w.reach?(w.follows||0)*1000/w.reach:null, volg1kV:vw.reach?(vw.follows||0)*1000/vw.reach:null,
    volg1kNieuw:nieuw?metSplit.reduce((a,r)=>a+(r.c.follows||0),0)*1000/nieuw:null,   // alleen niet-volgers kunnen volger worden
    volg1kNieuwV:igPer1kNieuw(dagMin(vandaag,14),dagMin(vandaag,8)),   // zelfde voor de week ervoor (null als er toen nog geen opsplitsing was)
    laatstePost:IG.posts.find(p=>p.gepost_om)};
}

/* ---------- Sneek via Insta (GoatCounter-bronnen) ---------- */
function igBronGroep(b){const l=String(b).toLowerCase();
  if(/^(bio|story-|post-|reel-)/.test(l))return "link";
  if(/instagram|^ig$/.test(l))return "insta";
  if(/facebook|^fb$|fb\.me|messenger/.test(l))return "fb";
  return "rest"}
function igSneek(){
  const dagen=[];for(let i=29;i>=0;i--)dagen.push(dagUTC(Date.now()-i*864e5));
  const perDag=Object.fromEntries(dagen.map(d=>[d,{insta:0,link:0,fb:0}]));
  const tot={insta:0,link:0,fb:0,rest:0},links=new Map();
  (GC.bronnen||[]).forEach(r=>{const d=String(r.dag).slice(0,10);if(!(d in perDag))return;const g=igBronGroep(r.bron),n=+r.aantal||0;
    tot[g]+=n;if(g!=="rest")perDag[d][g]+=n;
    if(g==="link"){const k=String(r.bron).toLowerCase();const x=links.get(k)||{bron:k,n:0,eerst:d};x.n+=n;if(d<x.eerst)x.eerst=d;links.set(k,x)}});
  const alle=tot.insta+tot.link+tot.fb+tot.rest, meta=tot.insta+tot.link+tot.fb;
  const d7=dagen.slice(-7).reduce((a,d)=>a+perDag[d].insta+perDag[d].link+perDag[d].fb,0);
  return {dagen:dagen.map(d=>({d,parts:[{v:perDag[d].insta+perDag[d].link,c:"hy"},{v:perDag[d].fb,c:"lb"}]})),tot,alle,meta,d7,
    links:[...links.values()].sort((a,b)=>b.eerst.localeCompare(a.eerst)||b.n-a.n)};
}
// nieuwe eigen link: ?ref=story-2909 (tweede op dezelfde dag: -b, -c, ...)
function igNieuweLink(soort){
  if(soort==="bio")return "https://www.haagsesneek.nl/?ref=bio";
  const d=vandaagAms(),basis=soort+"-"+d.slice(8,10)+d.slice(5,7);
  const bekend=new Set((GC.bronnen||[]).map(r=>String(r.bron).toLowerCase()).concat(JSON.parse(store.get("hc_ig_links")||"[]")));
  let ref=basis,i=1;while(bekend.has(ref)){ref=basis+"-"+String.fromCharCode(97+i);i++}
  return "https://www.haagsesneek.nl/?ref="+ref;
}

/* ---------- Wat werkt ---------- */
function igWatWerkt(kies){
  const jaarGeleden=Date.now()-365*864e5;
  const posts=IG.posts.filter(p=>p.bereik!=null&&p.gepost_om&&Date.parse(p.gepost_om)>jaarGeleden);
  const alleMed=med(posts.map(p=>p.bereik));
  const groepen=new Map();const voeg=(g,p)=>{if(!groepen.has(g))groepen.set(g,[]);groepen.get(g).push(p)};
  let volgorde=null,nietGelabeld=0;
  posts.forEach(p=>{
    if(kies==="soort")voeg(soortNaam(p),p);
    else if(kies==="onderwerp"){const l=labelsVan(p,"onderwerp");if(l.length)l.forEach(x=>voeg(x,p));else voeg("(geen onderwerp)",p)}
    else if(kies==="dag")voeg(DAGEN_LANG[(p.weekdag||1)-1],p);
    else if(kies==="tijd")voeg(dagdeel(p.uur??12),p);
    else if(kies==="muziek"){const l=labelsVan(p,"muziek");if(!l.length){nietGelabeld++;return}
      voeg(l[0]==="(geen)"?"Zonder eigen muziek":"Met eigen muziek",p);if(l[0]!=="(geen)")voeg("♪ "+l[0],p)}
  });
  if(kies==="dag")volgorde=DAGEN_LANG;if(kies==="tijd")volgorde=DAGDELEN;
  let rijen=[...groepen].map(([naam,ps])=>({naam,n:ps.length,med:med(ps.map(p=>p.bereik)),
    kw:med(ps.filter(p=>p.kwaliteit!=null).map(p=>+p.kwaliteit)),
    nv:ps.reduce((a,p)=>a+(p.nieuwe_volgers||0),0)}));
  rijen.forEach(r=>r.idx=alleMed?r.med/alleMed:null);
  if(volgorde)rijen.sort((a,b)=>volgorde.indexOf(a.naam)-volgorde.indexOf(b.naam));
  else rijen.sort((a,b)=>(b.n>=5)-(a.n>=5)||b.med-a.med);
  return {rijen,n:posts.length,alleMed,nietGelabeld,alleKw:med(posts.filter(p=>p.kwaliteit!=null).map(p=>+p.kwaliteit))};
}

/* ---------- Muziek: plays van dat nummer na de post ---------- */
// Sleutel om dezelfde titel uit verschillende bronnen samen te voegen:
// hoofdletters, spaties, accenten, leestekens en "(Original Mix)" tellen niet mee; versies (Chilled/Spiced, Remix) wel.
function igTitelKey(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[([]?\s*(original|extended|radio|club) (mix|edit|version)\s*[)\]]?/g," ").replace(/[^a-z0-9]+/g,"")}
// YouTube-titel opschonen: "Marreman Rojas - Nummer (Official Video)" → "Nummer"
function igYtTitel(t){return String(t||"").replace(/^\s*(marreman( rojas)?|beuk)\s*[-–—:|]\s*/i,"")
  .replace(/\s*[([][^)\]]*(official|video|audio|visuali[sz]er|lyric|clip)[^)\]]*[)\]]/gi,"").replace(/\s*\|.*$/,"").trim()}
// Alle nummers uit alle muziekdata. Bij dubbele titels wint de eerste bron in deze volgorde
// (al gebruikte labels eerst, zodat bestaande keuzes precies blijven kloppen).
function igTrackBronnen(){
  const lijst=[];const zet=(titel,bron)=>{titel=String(titel||"").trim();if(titel)lijst.push({titel,bron})};
  (IG.posts||[]).forEach(p=>labelsVan(p,"muziek").forEach(l=>{if(l!=="(geen)"&&l!=="(eigen muziek)")zet(l,"label")}));
  (SCL.tracks||[]).forEach(x=>zet(x.title,"SoundCloud"));
  (SP.snaps||[]).forEach(x=>zet(x.song,"Spotify"));
  (LABEL.tracks||[]).forEach(x=>zet(x.t+(/^((original|extended|radio|club)\s*)?(mix|edit|version)?$/i.test(String(x.v||"").trim())?"":" ("+String(x.v).trim()+")"),"DJ·World"));
  (SC||[]).forEach(r=>zet(r.track,"SoundCloud-rapport"));
  const own=YT.own||[];(YT.videos||[]).forEach(v=>{if(!own.length||own.includes(v.channel_id))zet(igYtTitel(v.title),"YouTube")});
  const per=new Map();
  lijst.forEach(({titel,bron})=>{const k=igTitelKey(titel);if(!k)return;
    let o=per.get(k);if(!o){o={titel,bronnen:new Set()};per.set(k,o)}if(bron!=="label")o.bronnen.add(bron)});
  return per;
}
function igTrackTitels(){
  return [...igTrackBronnen().values()].map(o=>o.titel).sort((a,b)=>a.localeCompare(b,"nl"));
}
// Effect van een post op de plays/weergaven van dat nummer.
// "Normaal" = gemiddeld per dag in de (max.) 14 dagen vóór de post. Daarna vensters van 7, 14 en 30 dagen vanaf de postdag.
// Het venster groeit vanzelf mee: elke nacht komt er een meting bij. Metingen per dag bestaan pas sinds eind sep 2026.
const IG_VENSTERS=[7,14,30];
function igReeks(snaps,ids,veld){   // stand op dag d = som van de laatste meting ≤ d per id (null als een id nog geen meting had)
  const per=new Map();snaps.forEach(x=>{if(!ids.has(x.video_id??x.track_id))return;const id=x.video_id??x.track_id;if(!per.has(id))per.set(id,[]);per.get(id).push(x)});
  per.forEach(r=>r.sort((a,b)=>a.snap_date<b.snap_date?-1:1));
  const eerste=[...per.values()].reduce((m,r)=>!m||r[0].snap_date>m?r[0].snap_date:m,null);   // vanaf hier hebben alle ids een meting
  return {eerste,op:d=>{if(!per.size||!eerste||d<eerste)return null;let t=0;
    for(const r of per.values()){let v=null;for(const x of r){if(x.snap_date<=d)v=+x[veld];else break}if(v==null)return null;t+=v}return t}};
}
function igEffectBron(reeks,postDag){
  const vandaag=vandaagAms(),dag0=dagMin(postDag,1),v0=reeks.op(dag0);
  if(v0==null)return null;
  // normaal: tot 14 dagen terug, zo ver als er metingen zijn (minstens 3 dagen)
  let voorDagen=Math.min(14,Math.round((Date.parse(dag0)-Date.parse(reeks.eerste))/864e5)),voorPerDag=null;
  if(voorDagen>=3){const vB=reeks.op(dagMin(dag0,voorDagen));if(vB!=null)voorPerDag=(v0-vB)/voorDagen}else voorDagen=0;
  const vensters=[];
  for(const w of IG_VENSTERS){const eind=dagMin(postDag,-(w-1));
    if(eind<=vandaag){const v=reeks.op(eind);if(v==null)break;const na=v-v0;
      vensters.push({dagen:w,na,perDag:na/w,x:voorPerDag>0?(na/w)/voorPerDag:null,klaar:true})}
    else{const gedaan=Math.round((Date.parse(vandaag)-Date.parse(postDag))/864e5)+1,v=reeks.op(vandaag);
      if(v!=null&&gedaan>=1)vensters.push({dagen:w,na:v-v0,perDag:(v-v0)/gedaan,x:voorPerDag>0?((v-v0)/gedaan)/voorPerDag:null,klaar:false,gedaan});
      break}}
  return vensters.length?{voorPerDag,voorDagen,vensters}:null;
}
function igPlaysEffect(titel,postDag){
  const t=titel.trim().toLowerCase(),uit={bronnen:[]};
  const tk=igTitelKey(titel),tr=(SCL.tracks||[]).filter(x=>x.title&&igTitelKey(x.title)===tk);
  if(tr.length){const e=igEffectBron(igReeks(SCL.snaps||[],new Set(tr.map(x=>x.track_id)),"plays"),postDag);
    if(e)uit.bronnen.push({bron:"SoundCloud",eenheid:"plays",url:tr[0].permalink_url,...e})}
  const yv=t.length>=4?(YT.videos||[]).filter(v=>v.title&&v.title.toLowerCase().includes(t)):[];
  if(yv.length){const e=igEffectBron(igReeks(YT.snaps||[],new Set(yv.map(v=>v.video_id)),"views"),postDag);
    if(e)uit.bronnen.push({bron:"YouTube",eenheid:"weergaven",...e})}
  if(!uit.bronnen.length)return null;
  // voor de kansen-kaart: SoundCloud (of YouTube) na 7 dagen
  const h=uit.bronnen[0],w7=h.vensters.find(v=>v.dagen===7&&v.klaar);
  uit.x7=w7?w7.x:null;uit.na7=w7?w7.na:null;uit.voorPerDag=h.voorPerDag;
  return uit;
}
const nf1i=new Intl.NumberFormat("nl-NL",{maximumFractionDigits:1});
function igEffectHTML(eff){
  return eff.bronnen.map(b=>{
    const norm=b.voorPerDag!=null?`normaal ${nf1i.format(b.voorPerDag)} ${b.eenheid} per dag (${b.voorDagen} dagen ervoor)`:"nog geen meting van vóór de post, dus geen vergelijking";
    const delen=b.vensters.map(v=>{const x=v.x!=null&&(v.klaar||v.gedaan>=3)?` <b class="${v.x>=1.2?"up":v.x<=0.8?"down":""}">×${nf1i.format(v.x)}</b>`:"";
      return v.klaar?`${v.dagen} d ${plus(v.na)}${x}`:`${v.dagen} d loopt (dag ${v.gedaan}): ${plus(v.na)}${x}`});
    return `<span class="igeff" title="×2 = twee keer zoveel ${b.eenheid} per dag als normaal · ${norm}">♪ ${b.bron}: ${delen.join(" · ")}<span class="ignorm"> · ${b.voorPerDag!=null?"normaal "+nf1i.format(b.voorPerDag)+"/dag":"nog geen 'normaal'"}</span></span>`}).join("");
}

/* ---------- tekenen ---------- */
function igKolommen(el,data,aria,onder){   // gestapelde kolommen: data=[{d,parts:[{v,c}],o}]; onder={naam,c} = strook eronder met één getal per dag (bijv. nieuwe volgers)
  const W=Math.max(300,Math.round(el.clientWidth||1000)),ml=40,mr=6,mt=10,mb=26,iw=W-ml-mr,ih=(W<600?180:220)-mt-mb;
  const og=onder?24:0,oh=onder?(W<600?40:52):0,H=mt+ih+og+oh+mb;   // og = ruimte voor het kopje van de strook, oh = hoogte strook
  const sch=schaal(Math.max(...data.map(d=>d.parts.reduce((a,p)=>a+p.v,0))),3),top=sch.top,bw=iw/data.length;
  const y=v=>mt+ih-v/top*ih;
  const oTop=onder?Math.max(1,...data.map(d=>d.o||0)):1,ob=mt+ih+og+oh,met=bw>=20,oa=oh-(met?13:0);   // ob = onderkant strook, oa = hoogte hoogste staaf (met = ruimte voor getallen)
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`;
  sch.lijnen.forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml-6}" y="${y(t)+4}" text-anchor="end">${nf0.format(t)}</text>`});
  if(onder)s+=`<text x="${ml}" y="${mt+ih+og-6}" text-anchor="start" class="strook">${onder.naam}</text><line class="base" x1="${ml}" x2="${W-mr}" y1="${ob}" y2="${ob}"/>${met?"":`<text x="${ml-6}" y="${ob-oa+4}" text-anchor="end">${nf0.format(oTop)}</text>`}`;
  data.forEach((d,i)=>{let acc=0;const x=ml+i*bw+bw*.15;
    const vis=d.parts.filter(p=>p.v>0);
    vis.forEach((p,j)=>{const h=p.v/top*ih;const yt=y(acc+p.v);
      s+=j===vis.length-1?`<path d="${roundTop(x,yt,bw*.7,h,3)}" fill="var(--${p.c})"/>`:`<rect x="${x}" y="${yt}" width="${bw*.7}" height="${h}" fill="var(--${p.c})"/>`;acc+=p.v});
    let getal=nf0.format(acc);
    if(onder&&d.o!=null){getal+=` · +${nf0.format(d.o)}`;
      if(d.o>0){const h=d.o/oTop*oa;s+=`<path d="${roundTop(x,ob-h,bw*.7,h,2)}" fill="var(--${onder.c})"/>`;
        if(met)s+=`<text x="${ml+i*bw+bw/2}" y="${ob-h-3}" text-anchor="middle" class="strookgetal">${nf0.format(d.o)}</text>`}}
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${ob-mt}"${staafGetal(ml+i*bw+bw/2,y(acc),getal)}><title>${d.tip}</title></rect>`;
    if((data.length-1-i)%7===0)s+=`<text x="${ml+i*bw+bw/2}" y="${H-8}" text-anchor="middle">${dLabel(d.d)}</text>`});
  el.innerHTML=s+"</svg>";
}
function igStat(k,v,s){return `<div class="ytstat"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`}
function igVs(a,b,pctMode){if(a==null||b==null||!b)return "";const d=a/b-1;
  return ` · vorige week ${pctMode?nf0.format(b):nf0.format(b)}${d>0.05?' <span class="up">↑ '+pct(d)+"</span>":d<-0.05?' <span class="down">↓ '+pct(-d)+"</span>":""}`}

const igNf1=new Intl.NumberFormat("nl-NL",{minimumFractionDigits:1,maximumFractionDigits:1});
function igVs1(a,b){if(a==null||b==null||!b)return "";const d=a/b-1;   // als igVs, maar met 1 cijfer achter de komma
  return ` · vorige week ${igNf1.format(b)}${d>0.05?' <span class="up">↑ '+pct(d)+"</span>":d<-0.05?' <span class="down">↓ '+pct(-d)+"</span>":""}`}

function renderInsta(){
  if(!$("igStats"))return;
  $("igAlarm").innerHTML=igAlarmHTML();igBadge();   // waarschuwing als de koppeling met Meta stuk is
  const leeg=IG.err||!IG.acc;
  $("igBlok").hidden=!!leeg;$("igNog").hidden=!leeg;
  if(leeg){$("igNogTekst").innerHTML=IG.err?(/ig_post_stats|relation|schema cache/i.test(IG.err)
      ?"De Insta-tabellen zijn nog niet compleet. Draai <code>supabase/09_insta.sql</code> en <code>09b_insta_extra.sql</code>."
      :"Insta-cijfâhs ophale lukte nie: "+esc(IG.err)):"Nog geen metingen. Wacht tot vannacht of draai <code>select public.ig_refresh(7, 20);</code> in Supabase.";return}
  const c=igCompute();

  // 1. tegels
  $("igSub").innerHTML=`@${esc(IG.acc.gebruikersnaam||"the_hague_beachlife")} · elke nacht vanzelf bijgewerkt, en als je het dashboard opent (hooguit 1x per 10 min). Dagen zijn Meta-dagen (Amerikaanse tijd).`;
  if($("igStatus"))$("igStatus").innerHTML=igStatusHTML();
  $("igStats").innerHTML=[
    igStat("Volgâhs",nf0.format(IG.acc.volgers||0),`${plus(c.follows-c.unfollows)} netto laatste 7 dagen (+${nf0.format(c.follows)} erbè, −${nf0.format(c.unfollows)} eraf)`),
    igStat("Bereik per dag",c.bereikDag==null?"—":nf0.format(c.bereikDag),"gemiddeld, laatste 7 dagen"+igVs(c.bereikDag,c.bereikDagV)+(c.nu.reach?` · vandaag tot nu ${nf0.format(c.nu.reach)}`:"")),
    igStat("Volgâhs per 1.000 bereik",c.volg1k==null?"—":igNf1.format(c.volg1k),"nieuwe volgâhs, laatste 7 dagen"+igVs1(c.volg1k,c.volg1kV)+(c.volg1kNieuw!=null?` · ${igNf1.format(c.volg1kNieuw)} per 1.000 nieuwe mensen`:"")),
    igStat("Nieuwe mensen",c.nieuwPct==null?"—":pct(c.nieuwPct),c.nieuwPct==null?"komt na de eerste nacht met 09b":"van je bereik volgt je (nog) nie"+(c.viewsNieuwPct!=null?` · ${pct(c.viewsNieuwPct)} van de weergaven`:"")),
    igStat("Gedeeld + bewaard",c.kwal==null?"—":nf0.format(c.kwal),`per 1.000 bereik, laatste 7 dagen${igVs(c.kwal,c.kwalV)} · delen/bewaren weegt zwaar bij Insta`),
    igStat("Posts",nf0.format(c.posts7),"laatste 7 dagen"+(c.laatstePost?` · laatste ${dLabel(dagNL(c.laatstePost.gepost_om))}`:""))
  ].join("");

  // 2. bereik per dag, volgers vs nieuw
  const dagen=[];for(let i=30;i>=1;i--)dagen.push(dagMin(c.vandaag,i-1));
  const per=new Map(IG.dag.map(r=>[r.dag,r.c]));
  igKolommen($("igChart"),dagen.map(d=>{const x=per.get(d)||{};const split=x.reach_nieuw!=null;
    const parts=split?[{v:x.reach_volgers||0,c:"groen"},{v:x.reach_nieuw||0,c:"hy"}]:[{v:x.reach||0,c:"muted"}];
    return {d,parts,o:x.follows!=null?x.follows:null,tip:`${dLabel(d,1)}${d===c.vandaag?" (tot nu)":""}: bereik ${nf0.format(x.reach||0)}`+(split?` · volgers ${nf0.format(x.reach_volgers)} · nieuw ${nf0.format(x.reach_nieuw)}`:"")+(x.follows!=null?` · +${x.follows} / −${x.unfollows||0} volgâhs`+(x.reach?` (${igNf1.format(x.follows*1000/x.reach)} per 1.000 bereik)`:""):"")}}),"Bereik per dag",{naam:"Nieuwe volgâhs per dag",c:"good"});

  // 3. wat werkt
  document.querySelectorAll("#igKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igKies));
  const ww=igWatWerkt(igKies);
  const maxIdx=Math.max(1,...ww.rijen.map(r=>r.idx||0));
  $("igWwSub").innerHTML=`${nf0.format(ww.n)} posts van het laatste jaar met cijfâhs. <b>Bereik</b> = mediaan (de middelste post, dus één uitschietâh telt niet te zwaar). <b>vs normaal</b> = t.o.v. je middelste post (${ww.alleMed==null?"—":nf0.format(ww.alleMed)}). <b>Kwaliteit</b> = gedeeld + bewaard per 1.000 bereik (normaal ${ww.alleKw==null?"—":nf0.format(ww.alleKw)}).`
    +(igKies==="muziek"?` Nog ${nf0.format(ww.nietGelabeld)} posts zonder muziek-label: label ze hieronder.`:"")
    +(igKies==="onderwerp"?" Onderwerpen komen uit je hashtags; een post kan in meer groepen zitten.":"");
  $("igWw").innerHTML=ww.rijen.length?`<thead><tr><th>Groep</th><th class="n">Posts</th><th class="n">Bereik</th><th>vs normaal</th><th class="n">Kwaliteit</th><th class="n">Volgâhs erbè</th><th>Zekerheid</th></tr></thead><tbody>`+
    ww.rijen.map(r=>{const idx=r.idx==null?"—":(r.idx>=1?"+":"−")+nf0.format(Math.abs(r.idx-1)*100)+"%";
      return `<tr><td>${esc(r.naam)}</td><td class="n">${nf0.format(r.n)}</td><td class="n">${r.med==null?"—":nf0.format(r.med)}</td>
      <td><span class="igidx"><span class="igidxbar"><i style="width:${Math.min(100,(r.idx||0)/maxIdx*100)}%;background:var(--${(r.idx||0)>=1?"groen":"muted"})"></i></span>${idx}</span></td>
      <td class="n">${r.kw==null?"—":nf0.format(r.kw)}</td><td class="n">${nf0.format(r.nv)}</td><td>${zeker(r.n)}</td></tr>`}).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${igKies==="muziek"?"Nog geen posts met een muziek-label. Kies hieronder per post welk nummâh eronder zat.":"Nog geen posts met cijfâhs."}</td></tr></tbody>`;

  // 4. toppâhs (laatste 90 dagen of allâh tijde)
  renderIgTop();
  if(typeof renderIgSamen==="function")renderIgSamen();   // 5. samenwerkingen (samenwerking.js)

  renderIgStories();
  renderIgSneek();
  renderIgMuziek();
}

/* ---------- toppâhs: top 10 op bereik, laatste 90 dagen of allâh tijde ---------- */
function renderIgTop(){
  if(!$("igTop"))return;
  const alles=igTopPeriode==="alles",opKw=igTopOp==="kwaliteit";
  const metCijfers=IG.posts.filter(p=>p.bereik!=null);
  const periode=alles?metCijfers:metCijfers.filter(p=>Date.parse(p.gepost_om)>Date.now()-90*864e5);
  // op kwaliteit: posts met heel weinig bereik tellen niet mee (1x bewaard bij 40 bereik = al 25, dat zegt niks)
  const drempel=opKw?Math.max(100,Math.round((med(periode.map(p=>p.bereik))||0)/2)):0;
  const lijst=(opKw?periode.filter(p=>p.kwaliteit!=null&&p.bereik>=drempel).sort((a,b)=>b.kwaliteit-a.kwaliteit||b.bereik-a.bereik)
                   :[...periode].sort((a,b)=>b.bereik-a.bereik||(a.gepost_om<b.gepost_om?-1:1))).slice(0,10);   // gelijk bereik: oudste eerst
  document.querySelectorAll("#igTopKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igTopPeriode));
  document.querySelectorAll("#igTopOp button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igTopOp));
  if($("igTopSub")){
    const oudste=metCijfers.reduce((m,p)=>!m||p.gepost_om<m?p.gepost_om:m,null);
    const zonder=IG.posts.length-metCijfers.length;
    const op=opKw?`op kwaliteit (gedeeld + bewaard per 1.000 bereik). Alleen posts met minstens ${nf0.format(drempel)} bereik tellen mee, anders kan een post die bijna niemand zag bovenaan komen`:"op bereik";
    $("igTopSub").innerHTML=alles
      ?`Je 10 beste posts ooit, ${op}. Gekeken naâh ${nf0.format(metCijfers.length)} posts met cijfâhs${oudste?`, de oudste van ${dLabel(dagNL(oudste),1)}`:""}.`
        +(zonder?(zonder===1?" 1 post heb (nog) geen cijfâhs en telt nie mee.":` ${nf0.format(zonder)} posts hebbe (nog) geen cijfâhs en telle nie mee.`):"")
        +" Het archief vult zich elke nacht verder aan, dus oude toppâhs kunne d'r nog bij komme."
      :`Beste posts van de laatste 90 dagen, ${op}. Klik om de post te openen.`;
  }
  const kop=(t,k)=>`<th class="n${igTopOp===k?" gesorteerd":""}">${t}${igTopOp===k?" ↓":""}</th>`;
  $("igTop").innerHTML=lijst.length?`<thead><tr><th class="n">#</th><th>Post</th>${kop("Bereik","bereik")}${kop("Kwaliteit","kwaliteit")}<th class="n">Volgâhs erbè</th><th class="n">Profielbezoek</th></tr></thead><tbody>`+
    lijst.map((p,i)=>`<tr><td class="n">${i+1}</td><td><div class="igtoprij"><a class="igthumb klein" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</a><div style="min-width:0"><a href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${dLabel(dagNL(p.gepost_om),alles)} · ${soortNaam(p)}</a> <span class="igcap">${esc((p.bijschrift||"").replace(/^Oh oh #thehague,?\s*/i,"").slice(0,70))}</span></div></div></td>
      <td class="n">${nf0.format(p.bereik)}</td><td class="n">${p.kwaliteit==null?"—":igNf1.format(p.kwaliteit)}</td><td class="n">${p.nieuwe_volgers==null?"—":nf0.format(p.nieuwe_volgers)}</td><td class="n">${p.profielbezoeken==null?"—":nf0.format(p.profielbezoeken)}</td></tr>`).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${alles?"Nog geen posts met cijfâhs.":"Nog geen posts met cijfâhs in de laatste 90 dagen."}</td></tr></tbody>`;
}

function renderIgStories(){
  document.querySelectorAll("#igStoryKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igStoryPeriode));
  const dagen=igStoryPeriode==="alles"?null:+igStoryPeriode;
  const st=IG.stories.filter(s=>!dagen||Date.parse(s.gepost_om)>Date.now()-dagen*864e5);
  const eerste=IG.stories.reduce((m,s)=>!m||s.gepost_om<m?s.gepost_om:m,null);
  if($("igStorySub"))$("igStorySub").innerHTML=`${dagen?`Laatste ${dagen} dagen`:"Allâh stories"}, per dag in de volgorde waarin je ze plaatste: zo zie je waar mensen afhaken. `
    +`Stories blijven hier bewaard, ook als ze na 24 uur van Insta verdwijnen (cijfers = laatste meting, hooguit een uur voor het einde)${eerste?`; de eerste is van ${dLabel(dagNL(eerste),1)}`:""}.`;
  if(!st.length){$("igStories").innerHTML=`<p class="sub">Nog geen stories gemeten${dagen?` in de laatste ${dagen} dagen`:""}. Stories worden elk uur opgehaald zolang ze online staan (24 uur).</p>`;return}
  const titels=igTrackTitels(),opties=igMuziekOpties(titels);
  // per dag in volgorde van posten: zo zie je waar mensen afhaken
  const perDag=new Map();[...st].reverse().forEach(s=>{const d=dagNL(s.gepost_om);if(!perDag.has(d))perDag.set(d,[]);perDag.get(d).push(s)});
  let h=`<div class="tablewrap"><table class="igstorytab"><thead><tr><th>Story</th><th class="n">Bereik</th><th class="n">Weergaven</th><th class="n">Tikte weg</th><th class="n">Reacties</th><th>Muziek</th></tr></thead><tbody>`;
  [...perDag].reverse().forEach(([d,rij])=>{
    const eersteBereik=rij[0].cijfers&&rij[0].cijfers.reach;
    rij.forEach((s,i)=>{const x=s.cijfers||{};const weg=igStoryWeg(s);
      const vast=eersteBereik&&x.reach!=null&&i?` <span class="sub">(${pct(x.reach/eersteBereik)} van de 1e)</span>`:"";
      const verlopen=Date.parse(s.gepost_om)<Date.now()-864e5;
      h+=`<tr data-id="${esc(s.media_id)}"><td>${verlopen?`${dLabel(d)} ${tijdAms(s.gepost_om)}`:`<a href="${esc(s.permalink||"#")}" target="_blank" rel="noopener">${dLabel(d)} ${tijdAms(s.gepost_om)}</a>`} · ${i+1}/${rij.length}</td>
      <td class="n">${x.reach==null?(s.fout?'<span class="sub" title="'+esc(s.fout)+'">nog geen</span>':"—"):nf0.format(x.reach)+vast}</td><td class="n">${x.views==null?"—":nf0.format(x.views)}</td>
      <td class="n">${weg==null?"—":pct(weg)}</td><td class="n">${x.replies==null?"—":nf0.format(x.replies)}</td>
      <td>${igMuziekSelect(labelsVan(s,"muziek")[0]||"",opties,titels,"Muziek onder deze story")}</td></tr>`})});
  const leeg=st.filter(s=>!labelsVan(s,"muziek").length).length;
  $("igStories").innerHTML=h+`</tbody></table></div><p class="sub" style="margin:10px 0 0"><b>Tikte weg</b> = deel van de weergaven waarbij iemand de stories wegtikte (hoe lager, hoe betâh). <b>Muziek</b>: kies wat eronder zat${leeg?` (nog ${nf0.format(leeg)} zonder keuze in deze lijst)`:""}; "Geen eigen muziek" telt ook mee.</p>`+igStoryMuziekHTML();
}
function igStoryWeg(s){const x=s.cijfers||{};return x.nav_weg!=null&&(x.views||x.reach)?x.nav_weg/(x.views||x.reach):null}
// eigen muziek onder stories: houdt het mensen vast? (alle bewaarde stories met cijfers en een keuze)
function igStoryMuziekHTML(){
  const g=IG.stories.filter(s=>s.cijfers&&s.cijfers.reach!=null&&labelsVan(s,"muziek").length);
  const met=g.filter(s=>labelsVan(s,"muziek")[0]!=="(geen)"),zonder=g.filter(s=>labelsVan(s,"muziek")[0]==="(geen)");
  const blok=(naam,a)=>{const w=med(a.map(igStoryWeg).filter(v=>v!=null));
    return `<b>${naam}</b>: ${a.length} ${a.length===1?"story":"stories"}, middelste bereik ${nf0.format(med(a.map(s=>s.cijfers.reach))||0)}${w==null?"":`, tikte weg ${pct(w)}`}`};
  if(met.length<3||zonder.length<3)return `<p class="sub" style="margin:6px 0 0">♪ Vanaf 3 stories mét en 3 zonder eigen muziek zie je hier of je eigen muziek mensen langer vasthoudt (nu ${met.length} mét, ${zonder.length} zonder).</p>`;
  const nummers=new Map();met.forEach(s=>{const t=labelsVan(s,"muziek")[0];nummers.set(t,(nummers.get(t)||0)+1)});
  const top=[...nummers].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t,n])=>`${esc(t)} (${n}x)`).join(", ");
  return `<p class="sub igstorymz" style="margin:6px 0 0">♪ ${blok("Mét eigen muziek",met)} · ${blok("Zonder",zonder)}${top?`. Meest gebruikt: ${top}`:""}. ${zeker(Math.min(met.length,zonder.length))}</p>`;
}

function renderIgSneek(){
  const g=igSneek();
  const linkN=g.tot.link, bio=g.links.filter(l=>l.bron==="bio").reduce((a,l)=>a+l.n,0);
  $("igSnStats").innerHTML=[
    igStat("Via Insta",nf0.format(g.tot.insta+g.tot.link),"Sneek-bezoekâhs, laatste 30 dagen"+(g.alle?` · ${pct((g.tot.insta+g.tot.link)/g.alle)} van alle bezoek`:"")),
    igStat("Via Meta totaal",nf0.format(g.meta),`Insta + Facebook (je stories/posts gaan automatisch mee) · laatste 7 dagen ${nf0.format(g.d7)}`),
    igStat("Eigen links",nf0.format(linkN),`bezoekâhs met <code>?ref=</code>, 30 dagen${bio?` · waarvan bio ${nf0.format(bio)}`:""}`)
  ].join("");
  igKolommen($("igSnChart"),g.dagen.map(d=>({...d,tip:`${dLabel(d.d,1)}: Insta ${nf0.format(d.parts[0].v)} · Facebook ${nf0.format(d.parts[1].v)}`})),"Sneek-bezoekers via Insta per dag");
  $("igSnLinks").innerHTML=g.links.length?`<thead><tr><th>Link</th><th>Eerste bezoek</th><th class="n">Bezoekâhs</th></tr></thead><tbody>`+
    g.links.slice(0,12).map(l=>`<tr><td><code>?ref=${esc(l.bron)}</code></td><td>${dLabel(l.eerst,1)}</td><td class="n">${nf0.format(l.n)}</td></tr>`).join("")+"</tbody>"
    :'<tbody><tr><td class="sub">Nog geen bezoek via een eigen link. Maak er hierboven een en zet hem in je story of bio.</td></tr></tbody>';
}

// Wachtkamâh: nieuwe posts (vanaf IG_WACHT_VANAF) zonder muziek-keuze. Ze gaan eruit zodra je iets kiest (ook "Geen eigen muziek").
const IG_WACHT_VANAF="2026-09-22";
function igWachtend(){return IG.posts.filter(p=>p.gepost_om&&dagNL(p.gepost_om)>=IG_WACHT_VANAF&&!labelsVan(p,"muziek").length)}
function igBadge(){const b=document.querySelector('nav.hoofdmenu button[data-s="insta"]');if(!b)return;
  const k=igKoppeling(),n=igWachtend().length;let s=b.querySelector(".badge");
  if(!n&&!(k&&k.nivo==="kapot")){if(s)s.remove();return}
  if(!s){s=document.createElement("span");s.className="badge";b.appendChild(s)}
  if(k&&k.nivo==="kapot"){s.textContent="!";s.title="Insta-koppeling is stuk: maak een nieuwe sleutel";return}   // gaat voor de wachtkamer
  s.textContent=n;s.title=n+" nieuwe post"+(n>1?"s wachten":" wacht")+" op muziek";}
function igMuziekOpties(titels){
  const recent=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>titels.includes(t)).slice(0,3);
  return `<option value="">— nog niet gekozen —</option><option value="(geen)">Geen eigen muziek</option>`+
    (recent.length?`<optgroup label="Laatst gekozen">${recent.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`:"")+
    `<optgroup label="Alle nummâhs (SoundCloud, Spotify, DJ·World, YouTube)">${titels.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`;
}
function igMuziekSelect(m,opties,titels,aria){
  return `<select class="igsel" aria-label="${aria}">${opties.replace(`value="${esc(m)}"`,`value="${esc(m)}" selected`)}${m&&m!=="(geen)"&&!titels.includes(m)?`<option value="${esc(m)}" selected>${esc(m)}</option>`:""}</select>`}
function igPostRij(p,opties,titels){
  const m=labelsVan(p,"muziek")[0]||"",ond=labelsVan(p,"onderwerp");
  const eff=m&&m!=="(geen)"&&m!=="(eigen muziek)"?igPlaysEffect(m,dagNL(p.gepost_om)):null;
  const effTxt=eff?igEffectHTML(eff):"";
  return `<div class="igpost" data-id="${esc(p.media_id)}">
      <a class="igthumb" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}<span>${soortNaam(p)}</span></a>
      <div class="iginfo"><span><b>${dLabel(dagNL(p.gepost_om),1)}</b> · ${p.bereik==null?"nog geen cijfâhs":"bereik "+nf0.format(p.bereik)+(p.kwaliteit!=null?" · kwaliteit "+nf0.format(p.kwaliteit):"")}</span>
        <span class="igcap">${esc((p.bijschrift||"").replace(/^Oh oh #thehague,?\s*/i,"").slice(0,90))}</span>
        <span class="igchips">${ond.map(o=>`<span class="chip mute">${esc(o)}</span>`).join("")}${effTxt}</span></div>
      <select class="igsel" aria-label="Muziek onder deze post">${opties.replace(`value="${esc(m)}"`,`value="${esc(m)}" selected`)}${m&&m!=="(geen)"&&!titels.includes(m)?`<option value="${esc(m)}" selected>${esc(m)}</option>`:""}</select>
    </div>`;
}
function renderIgMuziek(){
  const titels=igTrackTitels(),opties=igMuziekOpties(titels);
  // 1. wachtkamâh (nieuwste eerst)
  const wacht=igWachtend();
  $("igWacht").hidden=!wacht.length;
  if(wacht.length){
    $("igWachtSub").innerHTML=`${wacht.length} nieuwe post${wacht.length>1?"s wachten":" wacht"} tot je kiest welke muziek eronder zat. Kies "Geen eigen muziek" als er iets anders onder zat; dan telt hij mee bij de vergelijking.`;
    $("igWachtLijst").innerHTML=wacht.map(p=>igPostRij(p,opties,titels)).join("");
  }
  igBadge();
  // 2. archief (zonder de wachtende posts)
  const wachtId=new Set(wacht.map(p=>p.media_id));
  let lijst=IG.posts.filter(p=>p.gepost_om&&!wachtId.has(p.media_id));
  if(igAlleenLeeg)lijst=lijst.filter(p=>!labelsVan(p,"muziek").length);
  if(igSorteer==="bereik")lijst=[...lijst].sort((a,b)=>(b.bereik??-1)-(a.bereik??-1)||(a.gepost_om<b.gepost_om?1:-1));
  document.querySelectorAll("#igSorteer button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igSorteer));
  const zonder=IG.posts.filter(p=>!labelsVan(p,"muziek").length&&!wachtId.has(p.media_id)).length;
  $("igLabelSub").innerHTML=`Meta vertelt niet welk geluid onder een post zit, dus dat kies je hier zelf. Nog ${nf0.format(zonder)} oudere posts zonder keuze.`+
    (igSorteer==="bereik"?" Gesorteerd op bereik: je grootste posts eerst, daar zit de meeste potentie.":" Tip: sorteer op <b>Meeste bereik</b> en zet <b>Alleen zonder keuze</b> aan, dan werk je de belangrijkste eerst af.");
  $("igLabels").innerHTML=lijst.slice(0,igLabelAantal).map(p=>igPostRij(p,opties,titels)).join("")||'<p class="sub">Alle posts hebben een keuze. Top, âhwe!</p>';
  $("igMeer").hidden=lijst.length<=igLabelAantal;
}

async function igZetMuziek(id,nieuw){
  const p=IG.posts.find(x=>x.media_id===id)||IG.stories.find(x=>x.media_id===id);if(!p)return;
  const oud=labelsVan(p,"muziek")[0]||"";
  const {data,error}=nieuw?await sb.rpc("ig_label_zet",{p_media_id:id,p_soort:"muziek",p_label:nieuw,p_aan:true})
                           :await sb.rpc("ig_label_zet",{p_media_id:id,p_soort:"muziek",p_label:oud,p_aan:false});
  if(error){showMsg("Opslaan lukte nie: "+error.message);renderIgMuziek();return}
  p.labels=data||[];
  if(nieuw&&nieuw!=="(geen)"){const r=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>t!==nieuw);r.unshift(nieuw);store.set("hc_ig_nummers",JSON.stringify(r.slice(0,5)))}
  renderInsta();
}

/* ---------- knoppen ---------- */
document.addEventListener("change",e=>{const s=e.target.closest(".igsel");if(s)igZetMuziek(s.closest("[data-id]").dataset.id,s.value)});
document.addEventListener("click",async e=>{
  const k=e.target.closest("#igKies button");if(k){igKies=k.dataset.v;renderInsta();return}
  const tp=e.target.closest("#igTopKies button");if(tp){igTopPeriode=tp.dataset.v;renderIgTop();return}
  const to=e.target.closest("#igTopOp button");if(to){igTopOp=to.dataset.v;renderIgTop();return}
  const sp=e.target.closest("#igStoryKies button");if(sp){igStoryPeriode=sp.dataset.v;renderIgStories();return}
  const so=e.target.closest("#igSorteer button");if(so){igSorteer=so.dataset.v;igLabelAantal=20;renderIgMuziek();return}
  if(e.target.closest("#igMeer")){igLabelAantal+=20;renderIgMuziek();return}
  if(e.target.closest("#igAlleenLeeg")){igAlleenLeeg=!igAlleenLeeg;e.target.setAttribute("aria-pressed",igAlleenLeeg);igLabelAantal=20;renderIgMuziek();return}
  const l=e.target.closest("[data-iglink]");if(l){
    const url=igNieuweLink(l.dataset.iglink);$("igLinkUit").value=url;$("igLinkUit").hidden=false;
    const ref=url.split("ref=")[1];if(ref!=="bio"){const r=JSON.parse(store.get("hc_ig_links")||"[]");r.push(ref);store.set("hc_ig_links",JSON.stringify(r.slice(-50)))}
    try{await navigator.clipboard.writeText(url);showMsg("Link gekopieerd: "+url+" — plak hem in je link-sticker.",true)}
    catch(err){$("igLinkUit").select();showMsg("Kopiëren lukte nie vanzelf: selecteer de link en kopieer hem zelf.",false)}
    return}
  if(e.target.closest("#igRefresh")){const b=$("igRefresh");b.disabled=true;b.textContent="Effe geduld…";
    const {data,error}=await sb.rpc("ig_live",{min_minuten:5});
    if(error){LIVE.ig={fout:error.message||String(error)};renderInsta();showMsg("Insta verversen lukte nie: "+error.message)}
    else{LIVE.ig=data;await Promise.all([loadIG(),loadGC()]);renderInsta();
      showMsg(data&&data.ververst?(data.fout?"Deels bijgewerkt: "+data.fout:"Insta bijgewerkt, âhwe!"):"Net al bijgewerkt (om "+tijdAms(data&&data.om)+"), probeer het over een paar minuten nog eens.",!(data&&data.fout))}
    b.disabled=false;b.textContent="Nâh ververse"}
});
let igRsz;addEventListener("resize",()=>{clearTimeout(igRsz);igRsz=setTimeout(()=>{if(sectie==="insta")renderInsta()},150)});

/* ---------- Status van de laatste ophaalronde (ig_live) ----------
   ig_live doet zo'n 8 stappen (profiel, bereik vandaag, volgers, posts, stories, ...). Mislukt er één,
   dan geeft hij 'fout' terug, ook al is de rest gelukt. Hier maken we onderscheid:
   ok = alles gelukt · deels = een deel gelukt · fout = niks gelukt · bezig = loopt nog. */
const IG_STAPNAAM={profiel:"volgâhs-stand",vandaag:"bereik van vandaag",volgers:"nieuwe volgâhs",posts:"posts",
  post:"cijfâhs van nieuwe posts",stories:"stories",labels:"muziek-labels"};
function igStapVan(f){return String(f).trim().split(/[: ]/)[0]}          // "stories: ..." -> "stories", "post 123: ..." -> "post"
function igStapNamen(fouten){return [...new Set(fouten.map(f=>IG_STAPNAAM[igStapVan(f)]||"iets"))].join(" en ")}
function igWanneer(ts){return dagNL(ts)===vandaagAms()?tijdAms(ts):igTijd(ts)}   // vandaag: alleen de tijd
function igLiveStand(){
  if(LIVE.bezig)return {soort:"bezig",kort:"effe bèwerke…",fouten:[]};
  const L=LIVE.ig;
  if(L&&!("ververst" in L)&&L.fout)   // de vraag aan Supabase ging zelf al mis
    return {soort:"fout",kort:/ig_live/.test(L.fout)?"live staat nog uit (draai 09b_insta_extra.sql)":"ophalen lukte nie",fouten:[L.fout]};
  if(L&&(L.ververst||L.fout)){         // deze sessie is er echt opgehaald (of het ging meteen mis)
    const fouten=L.fouten&&L.fouten.length?L.fouten:(L.fout?[L.fout]:[]),om=L.om?igWanneer(L.om):"";
    if(!fouten.length)return {soort:"ok",kort:"bègewerkt "+om,fouten};
    if(!L.ververst||!(L.stappen||[]).length)return {soort:"fout",kort:"ophalen lukte nie"+(om?" ("+om+")":""),fouten};
    return {soort:"deels",kort:`deels bègewerkt ${om} · ${igStapNamen(fouten)} lukte nie`,fouten};
  }
  // nog niet opgehaald deze sessie, of "net al bijgewerkt": laatste ronde uit de database (die bewaart alleen de eerste fout)
  const v=IG.status&&IG.status.ververst;
  if(v&&v.om)return v.fout?{soort:"deels",kort:`laatste ronde ${igWanneer(v.om)} · ${igStapNamen([v.fout])} lukte nie`,fouten:[v.fout]}
                          :{soort:"ok",kort:"bègewerkt "+igWanneer(v.om),fouten:[]};
  return {soort:"geen",kort:"",fouten:[]};
}
// statusregel onderaan de Insta-tegel en bovenaan de Insta-pagina; bij een fout uitklapbaar met de echte reden
function igStatusHTML(){
  const s=igLiveStand();if(s.soort==="geen")return "";
  const kop=`<span class="igst-i" aria-hidden="true">${{ok:"✓",deels:"⚠",fout:"✕",bezig:"…"}[s.soort]}</span> ${esc(s.kort)}`;
  if(!s.fouten.length)return `<div class="igstatus ${s.soort}">${kop}</div>`;
  const uitleg=(s.soort==="deels"?"De rest is wél bègewerkt. Meestal gaat het de volgende ronde vanzelf goed (als je het dashboard opent, hooguit 1x per 10 min, of met \"Nâh ververse\" op de Insta-pagina).":"Probeer \"Nâh ververse\" op de Insta-pagina.")
    +(s.fouten.some(f=>IG_SLEUTELFOUT.test(f))?" Dit lijkt op een sleutelfout: volg de rode melding bovenaan.":"");
  return `<details class="igstatus ${s.soort}"><summary>${kop}</summary>
    <ul>${s.fouten.map(f=>`<li><code>${esc(f)}</code></li>`).join("")}</ul><p>${uitleg}</p></details>`;
}
// Meta-dag begint om middernacht in Los Angeles; bij ons meestal 09:00, maar rond de klokwissel een week 08:00
function igMetaStart(dag){
  const g=Date.parse(dag+"T08:00:00Z");   // 00:00 of 01:00 in LA, afhankelijk van zomer-/wintertijd daar
  const h=+new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",hour:"numeric",hourCycle:"h23"}).format(new Date(g));
  return g-h*36e5;
}
// regel "Bereik vandaag": getal van vandaag, of uitleg waarom het er (nog) niet is, plus gistâh ter vergelijking
function igBereikRij(c){
  const start=igMetaStart(c.vandaag),sinds=tijdAms(start),uren=(Date.now()-start)/36e5;
  const stapFout=igLiveStand().fouten.some(f=>igStapVan(f)==="vandaag");
  const g=igSom(dagMin(c.vandaag,1),dagMin(c.vandaag,1));
  let s;
  if(c.nu.reach!=null)s=`tot nu · Meta-dag begon om ${sinds}`+(stapFout?` · <span class="igst-w">⚠ nieuwste stand ophalen lukte nie</span>`:"");
  else if(stapFout)s=`<span class="igst-w">⚠ ophalen lukte nie</span> (Meta-dag begon om ${sinds}) · reden onderaan`;
  else if(uren<3)s=`Meta-dag begon om ${sinds}, cijfâhs volgen`;
  else s="nog geen meting van vandaag";
  if(g.reach!=null)s+=`<br>gistâh: ${nf0.format(g.reach)}`;
  return tegelRij("Bereik vandaag",c.nu.reach==null?"—":nf0.format(c.nu.reach),s);
}

/* ---------- tegel op het Ovâhzicht ---------- */
// Nieuwe volgers per 1.000 niet-volgers die je zagen: vooral of het stijgt of daalt t.o.v. de week ervoor
function igTrendRij(c){
  const nu=c.volg1kNieuw,voor=c.volg1kNieuwV,k="Volgâhs uit nieuw bereik";
  if(nu==null)return tegelRij(k,"—","nieuwe volgâhs per 1.000 niet-volgers die je zagen · komt zodra er 3 dagen met opsplitsing zijn");
  const uitleg=`${igNf1.format(nu)} nieuwe volgâhs per 1.000 niet-volgers die je zagen (laatste 7 dagen)`;
  if(voor==null)return tegelRij(k,igNf1.format(nu),"nieuwe volgâhs per 1.000 niet-volgers die je zagen (laatste 7 dagen) · stijging of daling zie je zodra de week ervoor ook gemeten is");
  const d=voor?nu/voor-1:(nu>0?1:0);   // vorige week 0: elke nieuwe volger is een stijging
  const pijl=d>0.05?`<span class="up">↑ ${voor?pct(d):""}</span>`:d<-0.05?`<span class="down">↓ ${pct(-d)}</span>`:`<span class="sub">≈ gelijk</span>`;
  return tegelRij(k,pijl,`${uitleg}, vorige week ${igNf1.format(voor)}`);
}
function instaTegel(){
  if(IG.err||!IG.acc)return `<article class="tegel binnenkort">
    <div class="tkop"><h2>Insta</h2><span class="tag">@the_hague_beachlife</span></div>
    <p class="kd">Nog geen cijfâhs</p><p class="s">${IG.err?"Ophalen lukte nie: "+esc(IG.err):"Wacht tot vannacht, dan staan ze erin."}</p>
    <button class="btn" type="button" data-ga="insta">Kèk bè Insta</button></article>`;
  const c=igCompute();
  return `<article class="tegel">
    <div class="tkop"><h2>Insta</h2><span class="tag">@${esc(IG.acc.gebruikersnaam||"the_hague_beachlife")}</span></div>
    <p class="tlbl">Volgâhs</p>
    <div class="tgroot">${nf0.format(IG.acc.volgers||0)}</div>
    <p class="s">${plus(c.follows-c.unfollows)} netto laatste 7 dagen</p>
    <div class="trijen">
      ${igBereikRij(c)}
      ${tegelRij("Gemiddeld bereik per dag",c.bereikDag==null?"—":nf0.format(c.bereikDag),"laatste 7 dagen"+igVs(c.bereikDag,c.bereikDagV))}
      ${tegelRij("Nieuwe mensen",c.nieuwPct==null?"—":pct(c.nieuwPct),"van je bereik volgt je (nog) nie")}
      ${igTrendRij(c)}
      ${(n=>n?tegelRij("Wachtkamâh",nf0.format(n),`nieuwe post${n>1?"s":""} zonder muziek-keuze`):"")(igWachtend().length)}
      ${igStatusHTML()}
    </div>
    <button class="btn yellow" type="button" data-ga="insta">Kèk bè Insta</button>
  </article>`;
}
