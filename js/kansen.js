// kansen.js — "Kansâh": waar zit ruimte om te groeien? Muziek, Insta en Sneek samen.
// Elke regel hieronder bekijkt de cijfers en maakt ALLEEN een kaart als de data er aanleiding voor geeft.
// Een kaart: {id, bron, big, h (kop), p (uitleg), a (wat kun je doen), impact 0-100, n (aantal metingen, voor zekerheid),
//             meet:{naam, waarde, fmt, beter:"hoger"|"lager"} (voor voortgang), trend (tekst: vs vorige week),
//             stil:true = kaart alleen om te blijven meten (je bent ermee bezig, maar de cijfers geven er nu geen aanleiding meer voor)}
//
// Sinds 03-10 (20_kansen_geschiedenis.sql): elke "Mee bezig" is een POGING in kans_poging:
//   gestart_om + vaste looptijd per kans (KANS_LOOPTIJD) = rapport_op. Afmelden = Gedaan of Gestopt (gestopt_om + afloop).
//   Bij elk openen bewaart de app per lopende poging de meetwaarde van vandaag (kans_meting).
//   Is rapport_op voorbij, dan rekent de app het rapport uit (kansRapportMaak) en bewaart het in kans_poging.rapport.
//   Nieuw rapport = pop-up bij openen + melding op Ovâhzicht + badge op Kansâh, tot je het gelezen hebt (gelezen_om).
// kans_status (10_kansen.sql) wordt alleen nog gebruikt voor "Nie voor mij" (verborgen).
// Zonder de tabellen (SQL nog nie gedraaid) bewaart de app alles tijdelijk in deze browser (localStorage).

let KANS={status:new Map(),err:null,lokaal:false};          // kans_status: alleen nog 'verborgen'
let KP={rijen:[],met:new Map(),lokaal:false,err:null};     // kans_poging + kans_meting (met: poging_id → Map(dag → waarde))
let kansFilter="alles", kansToonVerborgen=false, kansTab="nu";
let khBron="alles", khStatus="alles", khOpen=null;         // tab Geschiedenis: filters + welk rapport open staat

/* ---------- looptijd: vast per kans (dagen vanaf "Mee bezig" tot het rapport) ----------
   Insta 2-3 weken: genoeg posts om iets te zien. Sneek 1 week: bezoek reageert snel op een story.
   Muziek 4-8 weken: plays en afrekeningen bewegen traag. */
const KANS_LOOPTIJD=[
  ["muziek-spotify-grens",28],["muziek-sc-momentum",14],["muziek-sc-nieuw",14],["muziek-abonnees",56],["muziek-top3",56],
  ["muziek-land",28],["muziek-label-vs-sc",56],["muziek-downloads",56],["muziek-spotify-ontbreekt",28],["muziek-te-boeken",28],
  ["insta-onderwerp",14],["insta-meer-reels",21],["insta-tijd",14],["insta-nieuw-naar-volger",14],["insta-bewaren",14],
  ["insta-eigen-muziek",21],["insta-label-muziek",7],["insta-naar-plays",14],["insta-stories-afhaken",7],
  ["sneek-bio-link",7],["sneek-story-links",7],["sneek-beste-story",7],["sneek-insta-zakt",7],["sneek-speel-ratio",14],["sneek-delen",14]];
function kansDagen(id){const r=KANS_LOOPTIJD.find(([p])=>id===p||id.startsWith(p+"-"));return r?r[1]:14}
const kSlug=id=>String(id).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
// loopt er een poging voor deze kans (nog geen rapport)? Dan blijft de regel meten, ook als de kaart nie meer nodig is.
function kVolgt(ruw){const s=kSlug(ruw);return KP.rijen.some(p=>p.sleutel===s&&!p.rapport)}
const kBezig=s=>KP.rijen.find(p=>p.sleutel===s&&!p.gestopt_om)||null;                 // nu mee bezig
const kWacht=s=>KP.rijen.filter(p=>p.sleutel===s&&p.gestopt_om&&!p.rapport);          // afgemeld, rapport volgt
const kVorige=s=>KP.rijen.filter(p=>p.sleutel===s&&p.rapport).sort((a,b)=>a.rapport_op<b.rapport_op?1:-1)[0]||null;

/* ---------- datums ---------- */
function kDag(d,n){const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
const kDagen=(a,b)=>Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/864e5);
const kD=ts=>dKort(dagNL(ts));                                            // "za 3 okt"

/* ---------- laden en bewaren ---------- */
const KP_LOK="hc_kans_pogingen";
function kpLokaalBewaar(){store.set(KP_LOK,JSON.stringify(KP.rijen.map(p=>({...p,metingen:Object.fromEntries(KP.met.get(p.id)||[])}))))}
async function loadKansen(){
  KM_CURVE_CACHE=null;kmLaden();   // ig_media_dag (meetplan per taak), loopt parallel; KM_LAADT wacht erop in kansNaLaden
  try{
    const {data,error}=await sb.from("kans_status").select("sleutel,status,waarde_toen,tekst_toen,gezet_om");
    if(error)throw error;
    KANS={status:new Map(data.map(r=>[r.sleutel,r])),err:null,lokaal:false};
  }catch(e){   // tabel bestaat nog niet: tijdelijk in deze browser bewaren
    let lok=[];try{lok=JSON.parse(store.get("hc_kansen")||"[]")}catch(x){}
    KANS={status:new Map(lok.map(r=>[r.sleutel,r])),err:e.message||String(e),lokaal:true};
  }
  try{
    const [p,m]=await Promise.all([
      sb.from("kans_poging").select("*").order("gestart_om").range(0,4999),
      sb.from("kans_meting").select("poging_id,dag,waarde").range(0,19999)]);
    if(p.error)throw p.error;if(m.error)throw m.error;
    KP={rijen:p.data,met:new Map(),lokaal:false,err:null};
    m.data.forEach(r=>{if(!KP.met.has(r.poging_id))KP.met.set(r.poging_id,new Map());KP.met.get(r.poging_id).set(String(r.dag).slice(0,10),+r.waarde)});
  }catch(e){
    let lok=[];try{lok=JSON.parse(store.get(KP_LOK)||"[]")}catch(x){}
    KP={rijen:lok.map(({metingen,...p})=>p),met:new Map(lok.map(p=>[p.id,new Map(Object.entries(p.metingen||{}))])),lokaal:true,err:e.message||String(e)};
  }
}
async function kpNieuw(rij){
  if(KP.lokaal){const p={id:Date.now()+Math.floor(Math.random()*1000),rapport:null,rapport_klaar_om:null,gelezen_om:null,gestopt_om:null,afloop:null,...rij};KP.rijen.push(p);kpLokaalBewaar();return p}
  const {data,error}=await sb.from("kans_poging").insert(rij).select().single();
  if(error)throw error;KP.rijen.push(data);return data;
}
async function kpWijzig(p,velden){
  Object.assign(p,velden);
  if(KP.lokaal){kpLokaalBewaar();return}
  const {error}=await sb.from("kans_poging").update(velden).eq("id",p.id);if(error)throw error;
}
// zelf toegevoegd of weggehaald per poging: {plus:[media_id], min:[media_id], nummers:[track_id]}
const KP_EXTRA_LOK="hc_kans_extra";
function kpExtra(p){if(p.extra&&typeof p.extra==="object")return p.extra;try{return JSON.parse(store.get(KP_EXTRA_LOK)||"{}")[p.id]||{}}catch(e){return {}}}
async function kpExtraZet(p,extra){
  const lokaal=()=>{let a={};try{a=JSON.parse(store.get(KP_EXTRA_LOK)||"{}")}catch(e){}a[p.id]=extra;store.set(KP_EXTRA_LOK,JSON.stringify(a));p.extra=extra};
  if(KP.lokaal||!("extra" in p)){lokaal();if(!KP.lokaal)showMsg("Bewaard in deze browser. Draai 21_kansen_extra.sql om het overal te zien.");return}
  try{await kpWijzig(p,{extra})}catch(e){lokaal();showMsg("Bewaren in Supabase lukte nie ("+(e.message||e)+"), nu alleen in deze browser.")}
}
async function kpWis(p){
  KP.rijen=KP.rijen.filter(x=>x!==p);KP.met.delete(p.id);
  if(KP.lokaal){kpLokaalBewaar();return}
  const {error}=await sb.from("kans_poging").delete().eq("id",p.id);if(error)throw error;   // metingen gaan vanzelf mee (on delete cascade)
}
async function kpMeet(lijst){   // [{poging_id, dag, waarde}]
  if(!lijst.length)return;
  lijst.forEach(r=>{if(!KP.met.has(r.poging_id))KP.met.set(r.poging_id,new Map());KP.met.get(r.poging_id).set(r.dag,r.waarde)});
  if(KP.lokaal){kpLokaalBewaar();return}
  const {error}=await sb.from("kans_meting").upsert(lijst,{onConflict:"poging_id,dag"});if(error)throw error;
}
async function kansVerberg(id,aan){
  if(aan)KANS.status.set(id,{sleutel:id,status:"verborgen",gezet_om:new Date().toISOString()});else KANS.status.delete(id);
  if(KANS.lokaal){store.set("hc_kansen",JSON.stringify([...KANS.status.values()]));return}
  const {error}=aan?await sb.from("kans_status").upsert({sleutel:id,status:"verborgen",tekst_toen:null,waarde_toen:null}):await sb.from("kans_status").delete().eq("sleutel",id);
  if(error)showMsg("Bewaren lukte nie: "+error.message);
}
const kVerborgen=id=>(KANS.status.get(id)||{}).status==="verborgen";

/* ---------- hulpjes ---------- */
const kMed=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
const nf1k=new Intl.NumberFormat("nl-NL",{maximumFractionDigits:1});
const kPlus=v=>(v>0?"+":v<0?"−":"")+nf0.format(Math.abs(v));
function kVs(nu,voor,eenheid=""){if(nu==null||voor==null)return null;const d=voor?nu/voor-1:null;
  return `${nf0.format(nu)}${eenheid} deze week, vorige week ${nf0.format(voor)}${eenheid}`+(d==null?"":d>0.05?` <span class="up">↑ ${pct(d)}</span>`:d<-0.05?` <span class="down">↓ ${pct(-d)}</span>`:" (gelijk)")}
const kTekst=h=>String(h||"").replace(/<button[^>]*>.*?<\/button>/g,"").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').trim();
const kFmt=p=>p&&p.meet_fmt==="eur"?eur:(v=>nf1k.format(v));

/* ---------- MUZIEK ---------- */
function kansenMuziek(d){
  const out=[];
  // 1. Spotify 1.000-grens: welk nummer is het dichtst bij geld?
  if(SP.snaps&&SP.snaps.length){const s=spCompute();
    const kand=s.list.filter(t=>t.below).sort((a,b)=>b.y12-a.y12);
    const sid=t=>"muziek-spotify-grens-"+tKey(t.title);
    const doe=[kand[0],...s.list.filter(t=>t!==kand[0]&&kVolgt(sid(t)))].filter(Boolean);   // dichtstbij + nummers waar je mee bezig bent
    doe.forEach(t=>{const nog=1000-t.y12,mnd=t.perMonth>0&&nog>0?nog/t.perMonth:null;
      out.push({id:sid(t),stil:t!==kand[0],bron:"muziek",impact:nog<300?75:nog<600?60:45,n:s.dates.length>1?10:5,
        big:nog>0?"nog "+nf0.format(nog):"gehaald ✓",h:`streams tot <b>${esc(t.title)}</b> Spotify-geld oplevert`,
        p:`Spotify betaalt alleen voor nummers met minstens 1.000 streams in 12 maanden. ${esc(t.title)} staat op ${nf0.format(t.y12)}${t.y12exact?"":" (schatting)"}.`+
          (mnd!=null?` In dit tempo (${nf0.format(t.perMonth)} per maand) duurt dat nog ${mnd>24?"meer dan 2 jaar":nf0.format(Math.ceil(mnd))+" maanden"}.`:"")+
          (kand[1]?` Daarna: ${esc(kand[1].title)} (${nf0.format(kand[1].y12)}).`:""),
        a:`<b>Doe:</b> promoot 4 weken alleen ${esc(t.title)}: zet hem onder je Insta-posts, in je story met Spotify-link en vraag vrienden hem in een playlist te zetten. Eén nummer over de grens levert meer op dan tien nummers eronder.`,
        meet:{naam:"streams in 12 mnd",waarde:t.y12,beter:"hoger"}})})}
  // 2. SoundCloud: wie groeit er nu het hardst? (momentum)
  if(SCL.snaps&&SCL.snaps.length){const s=sclCompute();
    if(s.multiDay){const g=[...s.list].filter(t=>t.grow>0).sort((a,b)=>b.grow-a.grow);const mg=kMed(s.list.map(t=>t.grow||0));
      const t0=g[0],ok=t0&&t0.grow>=5&&t0.grow>=2*Math.max(1,mg);
      [ok?t0:null,...s.list.filter(x=>!(ok&&x===t0)&&kVolgt("muziek-sc-momentum-"+x.id))].filter(Boolean).forEach(t=>{
        out.push({id:"muziek-sc-momentum-"+t.id,stil:!(ok&&t===t0),bron:"muziek",impact:55,n:Math.min(10,s.dates.length),
          big:"+"+nf0.format(t.grow),h:`plays in 7 dagen voor <b>${esc(t.title)}</b>, je snelste groeiâh op SoundCloud`,
          p:`Het middelste nummer kreeg er ${nf0.format(mg||0)} bij. ${g[1]?`Daarna: ${esc(g[1].title)} (+${nf0.format(g[1].grow)}).`:""} Wat al loopt, is het makkelijkst verder te duwen.`,
          a:`<b>Doe:</b> gebruik ${esc(t.title)} deze week onder een Insta-post of reel en zet in je story een link naar <a href="${esc(t.url||"#")}" target="_blank" rel="noopener">SoundCloud</a>. Kies in de Insta-tab bij die post het nummer, dan zie je hier het effect.`,
          meet:{naam:"plays erbij per week",waarde:t.grow,beter:"hoger"}})});
      // 3. nieuwe release die beter loopt dan normaal
      const perDag=s.list.filter(t=>t.perDay!=null&&t.age>45).map(t=>t.perDay),norm=kMed(perDag);
      const nieuw=s.list.filter(t=>t.age!=null&&t.age<=45&&t.perDay!=null&&norm&&t.perDay>=1.5*norm).sort((a,b)=>b.perDay-a.perDay)[0];
      [nieuw,...s.list.filter(x=>x!==nieuw&&x.perDay!=null&&kVolgt("muziek-sc-nieuw-"+x.id))].filter(Boolean).forEach(nieuw=>out.push({id:"muziek-sc-nieuw-"+nieuw.id,stil:nieuw.age>45||!norm||nieuw.perDay<1.5*norm,bron:"muziek",impact:45,n:8,
        big:norm?nf1k.format(nieuw.perDay/norm)+"×":nf0.format(nieuw.perDay)+"/dag",h:`zo snel als normaal: <b>${esc(nieuw.title)}</b> (${nieuw.age} dagen oud)`,
        p:`${nf0.format(nieuw.plays)} plays, ${nf0.format(nieuw.perDay)} per dag. Je oudere nummers doen gemiddeld ${nf0.format(norm||0)} per dag.`,
        a:`<b>Doe:</b> dit is je kans op een nieuwe toppâh. Zet hem op Spotify-playlists die je kent, maak er een reel mee en overweeg een extended mix voor DJ's.`,
        meet:{naam:"plays per dag",waarde:Math.round(nieuw.perDay),beter:"hoger"}}))}}
  // 4. SoundCloud-afrekening: abonnees
  const T=Object.fromEntries(d.types.map(t=>[t.type,t]));const sub=T.SUB_STREAM,ad=T.AD_STREAM;
  if(sub&&d.scUSD>0&&sub.units){const share=sub.usd/d.scUSD,subPer=ex(sub.usd)/sub.units*1000,adPer=ad&&ad.units?ex(ad.usd)/ad.units*1000:0;
    out.push({id:"muziek-abonnees",bron:"muziek",impact:share>0.8?40:25,n:sub.units>=500?10:5,
      big:pct(share),h:"van je SoundCloud-geld komt van betalende abonnees",
      p:`${nf0.format(sub.units)} abonnee-streams leverden ${eur(ex(sub.usd))} op, ${eur(subPer)} per 1.000${adPer?`, tegen ${eur(adPer)} bij gratis luisteraars (${nf0.format(subPer/adPer)}× zo veel)`:""}.`,
      a:"<b>Doe:</b> bouw aan een vaste luisterkring op SoundCloud (volgers, reposts, DJ-sets met je eigen tracks). Stuur fans vanuit Insta liever naar SoundCloud dan naar Spotify: daar is een fan meer waard.",
      meet:{naam:"% van abonnees",waarde:Math.round(share*100),beter:"hoger"}})}
  // 5. afhankelijk van een paar nummers
  const tt=[...d.tracks].sort((a,b)=>b.total-a.total);
  if(tt.length>=5&&d.total>0){const top3=tt.slice(0,3).reduce((a,t)=>a+t.total,0),sh=top3/d.total;
    if(sh>=0.5||kVolgt("muziek-top3"))out.push({id:"muziek-top3",stil:sh<0.5,bron:"muziek",impact:30,n:10,big:pct(sh),h:"van al je muziekgeld komt uit je top 3",
      p:`${tt.slice(0,3).map(t=>esc(t.track)).join(", ")}. De andere ${tt.length-3} nummers delen de rest.`,
      a:"<b>Doe:</b> zoek wat deze drie gemeen hebben (tempo, sfeer, releasemaand, promotie) en maak daar je volgende release op. Oude toppâhs opnieuw promoten kost weinig.",
      meet:{naam:"% uit top 3",waarde:Math.round(sh*100),beter:"lager"}})}
  // 6. landen: waar betaalt een stream het meest?
  const lnd=d.countries.filter(c=>c.units>=100&&c.c);
  if(lnd.length>=3){const gem=d.countries.reduce((a,c)=>a+c.v,0)/Math.max(1,d.countries.reduce((a,c)=>a+c.units,0))*1000;
    const beste=lnd.map(c=>({...c,per:c.v/c.units*1000})).filter(c=>c.c!==d.countries[0].c).sort((a,b)=>b.per-a.per)[0];
    if(beste&&gem&&beste.per>=1.3*gem)out.push({id:"muziek-land-"+beste.c,bron:"muziek",impact:25,n:beste.units>=500?10:6,
      big:eur(beste.per),h:`per 1.000 streams in ${esc(cName(beste.c))}, ${kX(beste.per/gem)} je gemiddelde`,
      p:`Je meeste geld komt uit ${esc(cName(d.countries[0].c))}, maar een stream uit ${esc(cName(beste.c))} is meer waard (${nf0.format(beste.units)} streams gemeten).`,
      a:`<b>Doe:</b> gebruik Engelse bijschriften en tags die daar werken, en zoek SoundCloud-reposters of playlists uit ${esc(cName(beste.c))}.`})}
  // 7. label vs zelf uitbrengen
  const lbSc=LABEL.tracks.reduce((a,x)=>a+(x.sc||0),0),lbStrNet=LABEL.tracks.reduce((a,x)=>a+(x.gross>0?x.net*x.streams/x.gross:0),0);
  const scAll=SC.reduce((a,r)=>a+r.usd,0)*state.rate,scUnits=SC.reduce((a,r)=>a+r.units,0);
  if(lbSc>0&&scUnits>0&&lbStrNet>0){const lbPer=lbStrNet/lbSc*1000,scPer=scAll/scUnits*1000;
    if(scPer>=2*lbPer)out.push({id:"muziek-label-vs-sc",bron:"muziek",impact:35,n:10,big:nf0.format(scPer/lbPer)+"×",h:"zoveel meer per stream als je zelf via SoundCloud uitbrengt",
      p:`Via het label ${eur(lbPer)} per 1.000 streams (jouw netto), via SoundCloud-distributie ${eur(scPer)}.`,
      a:"<b>Doe:</b> breng nummers die je zelf kunt pushen via SoundCloud uit. Het label loont alleen als het echt nieuwe luisteraars brengt."})}
  // 8. downloads
  const lbDc=LABEL.tracks.reduce((a,x)=>a+(x.dc||0),0),lbDl=LABEL.tracks.reduce((a,x)=>a+x.downloads,0),lbStr=LABEL.tracks.reduce((a,x)=>a+x.streams,0);
  if(lbDc>0&&lbDl>=lbStr*0.5)out.push({id:"muziek-downloads",bron:"muziek",impact:30,n:lbDc>=5?8:4,big:nf0.format(lbDc)+" downloads",
    h:`brachten ${eur(lbDl)} bruto op${lbDl>lbStr?`, meer dan alle label-streams samen (${eur(lbStr)})`:""}`,
    p:`Dat is ${eur(lbDl/lbDc)} per download.`,
    a:"<b>Doe:</b> DJ's kopen tracks. Een extended mix of DJ-tool van je clubbigste nummer kan via downloads meer opleveren dan duizenden streams."});
  // 9. Spotify ontbreekt in de afrekening
  if(SC.length&&!SC.some(r=>r.partner==="SPOTIFY")&&SP.snaps&&SP.snaps.length)out.push({id:"muziek-spotify-ontbreekt",bron:"muziek",impact:20,n:10,
    big:"€ 0",h:"Spotify-geld in je SoundCloud-afrekening",
    p:"Er staan wel Spotify-streams in je export, maar nog nooit een Spotify-regel in de afrekening. Dat klopt zolang geen nummer de 1.000-grens haalt.",
    a:"<b>Doe:</b> niks extra: zodra een nummer de grens haalt, verschijnt Spotify hier. Zie de kaart over de 1.000-grens."});
  // 10. geld dat nog moet komen
  if(LABEL.generated&&(LABEL.toBook>0||kVolgt("muziek-te-boeken")))out.push({id:"muziek-te-boeken",stil:!(LABEL.toBook>0),bron:"muziek",impact:15,n:10,big:eur(LABEL.toBook),h:"staat bij DJ·World nog te boeken",
    p:`Al uitbetaald: ${eur(LABEL.paidOut)} (overzicht van ${LABEL.generated}).`,a:"<b>Doe:</b> check bij het volgende overzicht of dit is uitbetaald.",
    meet:{naam:"nog te boeken",waarde:LABEL.toBook,beter:"lager",fmt:eur}});
  return out;
}

/* ---------- INSTA ---------- */
function kansenInsta(){
  const out=[];if(!IG.acc||IG.err)return out;
  const c=igCompute();
  // 1. beste onderwerp
  const on=igWatWerkt("onderwerp").rijen.filter(r=>r.naam!=="(geen onderwerp)"&&r.n>=8&&r.idx);
  const best=[...on].sort((a,b)=>b.idx-a.idx)[0];
  const okB=best&&best.idx>=1.15,topNaam=okB?best.naam:null;
  const alleOn=igWatWerkt("onderwerp").rijen.filter(r=>r.naam!=="(geen onderwerp)");
  [okB?best:null,...alleOn.filter(x=>!(okB&&x.naam===best.naam)&&kVolgt("insta-onderwerp-"+x.naam))].filter(Boolean).forEach(best=>{
    const recent=IG.posts.filter(p=>Date.parse(p.gepost_om)>Date.now()-30*864e5&&labelsVan(p,"onderwerp").includes(best.naam)).length;
    out.push({id:"insta-onderwerp-"+best.naam,stil:best.naam!==topNaam,bron:"insta",impact:Math.min(70,35+((best.idx||1)-1)*100),n:best.n,
      big:best.idx?(best.idx>=1?"+":"−")+nf0.format(Math.abs(best.idx-1)*100)+"%":"?",h:`bereik bij posts over <b>${esc(best.naam)}</b>`,
      p:`${best.n} posts, middelste bereik ${nf0.format(best.med||0)}. De laatste 30 dagen postte je er ${recent} over.`,
      a:`<b>Doe:</b> plan deze week 2 posts over ${esc(best.naam)}${best.kw!=null?` (ze worden ook ${best.kw>=(igWatWerkt("soort").alleKw||0)?"vaak":"soms"} gedeeld/bewaard)`:""}.`,
      meet:{naam:`posts over ${best.naam} in 30 dagen`,waarde:recent,beter:"hoger"}})});
  const slecht=[...on].sort((a,b)=>a.idx-b.idx)[0];
  if(slecht&&slecht!==best&&slecht.idx<=0.8&&slecht.n>=10)out.push({id:"insta-onderwerp-minder-"+slecht.naam,bron:"insta",impact:20,n:slecht.n,
    big:"−"+nf0.format((1-slecht.idx)*100)+"%",h:`bereik bij posts over <b>${esc(slecht.naam)}</b>`,
    p:`${slecht.n} posts, middelste bereik ${nf0.format(slecht.med)}.`,
    a:`<b>Doe:</b> niet stoppen als je 't mooi vindt, maar combineer ${esc(slecht.naam)} met een sterker onderwerp${best?` zoals ${esc(best.naam)}`:""}, of zet het in een carrousel.`});
  // 2. soort: reels
  const so=igWatWerkt("soort","alle").rijen, reel=so.find(r=>r.naam==="Reel");   // hier juist reels tegen de rest (andere kansen: alleen foto's & carrousels)
  const p90=IG.posts.filter(p=>Date.parse(p.gepost_om)>Date.now()-90*864e5), reelAandeel=p90.length?p90.filter(p=>soortNaam(p)==="Reel").length/p90.length:0;
  const okR=reel&&reel.n>=5&&reel.idx>=1.2&&reelAandeel<0.3;
  if(okR||(reel&&kVolgt("insta-meer-reels")))out.push({id:"insta-meer-reels",stil:!okR,bron:"insta",impact:Math.min(70,40+((reel.idx||1)-1)*60),n:reel.n,
    big:(reel.idx>=1?"+":"−")+nf0.format(Math.abs((reel.idx||1)-1)*100)+"%",h:"bereik bij reels, maar maar "+pct(reelAandeel)+" van je posts is een reel",
    p:`${reel.n} reels, middelste bereik ${nf0.format(reel.med||0)}.`,
    a:"<b>Doe:</b> maak van je beste foto-reeks deze week een reel van 7–10 sec met je eigen muziek eronder. Twee vliegen in één klap.",
    meet:{naam:"% reels (90 dagen)",waarde:Math.round(reelAandeel*100),beter:"hoger"}});
  // 3. tijdstip
  const td=igWatWerkt("tijd").rijen.filter(r=>r.n>=8&&r.idx),meest=[...td].sort((a,b)=>b.n-a.n)[0],bt=[...td].sort((a,b)=>b.idx-a.idx)[0];
  if(bt&&meest&&bt!==meest&&bt.idx>=meest.idx*1.15)out.push({id:"insta-tijd-"+bt.naam,bron:"insta",impact:30,n:bt.n,
    big:"+"+nf0.format((bt.idx/meest.idx-1)*100)+"%",h:`bereik als je post in de <b>${esc(bt.naam.toLowerCase())}</b>`,
    p:`Je post het vaakst in de ${esc(meest.naam.toLowerCase())} (${meest.n}x, middelste bereik ${nf0.format(meest.med)}), in de ${esc(bt.naam.toLowerCase())} is dat ${nf0.format(bt.med)} (${bt.n}x).`,
    a:`<b>Doe:</b> plan je volgende 3 posts in de ${esc(bt.naam.toLowerCase())}. Het plaatje maken mag wanneer je wilt, alleen het posten verschuift.`});
  // 4. nieuwe mensen worden geen volgers
  const split=IG.dag.filter(r=>r.c.reach_nieuw!=null&&r.dag<c.vandaag).slice(-7);
  const rn=split.reduce((a,r)=>a+r.c.reach_nieuw,0),fw=split.reduce((a,r)=>a+(r.c.follows||0),0);
  if(split.length>=3&&rn>0){const conv=fw/rn*1000;
    const okN=c.nieuwPct>=0.5&&conv<5;
    if(okN||kVolgt("insta-nieuw-naar-volger"))out.push({id:"insta-nieuw-naar-volger",stil:!okN,bron:"insta",impact:50,n:split.length*2,
      big:nf1k.format(conv),h:"nieuwe volgâhs per 1.000 nieuwe mensen die je bereikt",
      p:`Je bereikte ${nf0.format(rn)} mensen die je niet volgen (${pct(c.nieuwPct)} van je bereik), daarvan gingen er ${fw} volgen.`,
      a:"<b>Doe:</b> geef nieuwe mensen een reden: eindig bijschriften met één zin als \"Elke dag Scheveningen, volg voor morgen\", en zet 3 toppâhs vast bovenaan je profiel.",
      meet:{naam:"volgâhs per 1.000 nieuw",waarde:Math.round(conv*10)/10,beter:"hoger"}})}
  // 5. delen vs bewaren
  const okBw=c.w.shares>=20&&(c.w.saves||0)<c.w.shares*0.2;
  if(okBw||kVolgt("insta-bewaren"))out.push({id:"insta-bewaren",stil:!okBw,bron:"insta",impact:25,n:7,
    big:nf0.format(c.w.shares||0)+" : "+nf0.format(c.w.saves||0),h:"gedeeld tegen bewaard, laatste 7 dagen",
    p:"Mensen delen je posts graag (top!), maar bewaren weinig. Bewaren is voor Insta een sterk signaal dat een post waardevol is.",
    a:"<b>Doe:</b> maak af en toe een bewaar-post: \"5 beste zonsondergang-plekken in Scheveningen\" of een carrousel met tijden en plekken. Daar komen mensen op terug.",
    meet:{naam:"bewaard per week",waarde:c.w.saves||0,beter:"hoger"}});
  // 6. eigen muziek: kost het bereik?
  const mz=igWatWerkt("muziek"),met=mz.rijen.find(r=>r.naam==="Met eigen muziek"),zonder=mz.rijen.find(r=>r.naam==="Zonder eigen muziek");
  const gelabeld=IG.posts.filter(p=>labelsVan(p,"muziek").length).length;
  if(met&&zonder&&met.n>=5&&zonder.n>=5){const r=met.med/zonder.med;
    out.push({id:"insta-eigen-muziek",bron:"insta",impact:40,n:Math.min(met.n,zonder.n),
      big:(r>=1?"+":"−")+nf0.format(Math.abs(r-1)*100)+"%",h:"bereik mét je eigen muziek eronder, vergeleken met zonder",
      p:`${met.n} posts met (middelste bereik ${nf0.format(met.med)}), ${zonder.n} zonder (${nf0.format(zonder.med)}).`,
      a:r>=0.9?"<b>Doe:</b> je eigen muziek kost je geen bereik, dus blijf 'm gebruiken: gratis promotie voor Marreman Rojas. Wissel af met je snelste groeiâh op SoundCloud."
              :"<b>Doe:</b> eigen muziek kost wat bereik. Gebruik trending audio voor posts die groot moeten worden, en je eigen muziek voor reels en stories voor je vaste volgâhs."})}
  const okL=!(met&&zonder&&met.n>=5&&zonder.n>=5)&&gelabeld<15;
  if(okL||kVolgt("insta-label-muziek"))out.push({id:"insta-label-muziek",stil:!okL,bron:"insta",impact:30,n:10,big:nf0.format(gelabeld),h:"posts waarbij je hebt aangegeven welke muziek eronder zat",
    p:"Pas vanaf ongeveer 5 posts mét en 5 zonder eigen muziek kan het dashboard zeggen of je eigen muziek bereik kost, en wat het oplevert aan plays.",
    a:'<b>Doe:</b> label in de tab Insta je laatste 20 posts (2 minuten werk, één keuze per post). <button class="btn" type="button" data-ga="insta">Naâh Insta</button>',
    meet:{naam:"gelabelde posts",waarde:gelabeld,beter:"hoger"}});
  // 7. wat doet een Insta-post voor je plays?
  const eff=IG.posts.map(p=>{const m=labelsVan(p,"muziek")[0];return igIsNummer(m)?igPlaysEffect(m,dagNL(p.gepost_om)):null}).filter(e=>e&&e.x7!=null);
  if(eff.length>=3){const x=kMed(eff.map(e=>e.x7)),na=kMed(eff.map(e=>e.na7));
    out.push({id:"insta-naar-plays",bron:"insta",impact:x>=1.3?40:x>=1?25:20,n:eff.length*2,big:"×"+nf1k.format(x),h:"zoveel plays per dag krijgt een nummâh in de week na een Insta-post ermee, vergeleken met de 2 weken ervoor",
      p:`Middelste post: ${kPlus(na)} plays in 7 dagen (${eff.length} posts gemeten). Metingen per dag bestaan sinds eind september, dus dit wordt elke week preciezer.`,
      a:x>=1.2?"<b>Doe:</b> het werkt: plaats vaker een post met je eigen muziek en zet er dezelfde dag een SoundCloud-link in je story bij."
              :"<b>Doe:</b> de muziek onder een post levert nog weinig extra plays op. Noem het nummer in je bijschrift (\"♪ Umoya – Marreman Rojas\") en zet een SoundCloud-link in je story.",
      meet:{naam:"× plays na een post",waarde:Math.round(x*10)/10,beter:"hoger"}})}
  // 8. stories: waar haken ze af?
  const perDag=new Map();IG.stories.forEach(s=>{if(!s.cijfers||s.cijfers.reach==null)return;const d=dagNL(s.gepost_om);if(!perDag.has(d))perDag.set(d,[]);perDag.get(d).push(s)});
  const reeks=[...perDag.values()].filter(r=>r.length>=3);
  if(reeks.length>=2){const behoud=reeks.map(r=>{r.sort((a,b)=>a.gepost_om<b.gepost_om?-1:1);return r[r.length-1].cijfers.reach/r[0].cijfers.reach});const b=kMed(behoud);
    if(b<0.6)out.push({id:"insta-stories-afhaken",bron:"insta",impact:25,n:reeks.length*3,big:pct(1-b),h:"van de kijkers is weg voor je laatste story van de dag",
      p:`Gemeten over ${reeks.length} dagen met 3 of meer stories.`,a:"<b>Doe:</b> zet je belangrijkste story (bijvoorbeeld de Sneek-link) als eerste of tweede, niet als laatste."})}
  return out;
}

/* ---------- SNEEK ---------- */
function kansenSneek(){
  const out=[];if(GC.err||!GC.dag.length)return out;
  const g=gcCompute(),s=igSneek();
  const links=s.links, bio=links.some(l=>l.bron==="bio")||(GC.bronnen||[]).some(r=>String(r.bron).toLowerCase()==="bio");
  // 1. bio-link meten
  const bioN=links.filter(l=>l.bron==="bio").reduce((a,l)=>a+l.n,0);
  if(!bio||kVolgt("sneek-bio-link"))out.push({id:"sneek-bio-link",stil:bio,bron:"sneek",impact:35,n:10,big:bio?nf0.format(bioN):"?",meet:{naam:"bezoekâhs via bio (30 d)",waarde:bioN,beter:"hoger"},h:"hoeveel mensen via je Insta-bio naâh Sneek gaan",
    p:"Meta telt klikken op je bio-link niet. Met een eigen link ziet GoatCounter het wél.",
    a:'<b>Doe:</b> zet in Insta → Profiel bewerken → Links: <code>https://www.haagsesneek.nl/?ref=bio</code>. Deze kaart verdwijnt vanzelf zodra het eerste bio-bezoek binnen is.'});
  // 2. stories meten
  const storyLinks=links.filter(l=>/^story-/.test(l.bron));
  const laatsteStory=storyLinks.map(l=>l.eerst).sort().pop();
  const okS=s.tot.insta>0&&(!laatsteStory||Date.parse(laatsteStory)<Date.now()-14*864e5);
  if(okS||kVolgt("sneek-story-links"))out.push({id:"sneek-story-links",stil:!okS,bron:"sneek",impact:40,n:10,
    big:nf0.format(s.tot.insta),h:"Sneek-bezoekâhs uit Insta in 30 dagen, maar van geen enkele story weet je wat ie opleverde",
    p:laatsteStory?`Je laatste story met eigen link was op ${dLabel(laatsteStory,1)}.`:"Je hebt nog geen story met een eigen link gebruikt.",
    a:`<b>Doe:</b> zet bij je volgende Sneek-story deze link in je link-sticker: <code>${esc(igNieuweLink("story"))}</code> <button class="btn" type="button" data-iglink="story">Kopieer link</button>`,
    meet:{naam:"bezoekâhs via eigen links (30 d)",waarde:s.tot.link,beter:"hoger"}});
  // 3. beste story tot nu
  if(storyLinks.length>=2){const b=[...storyLinks].sort((a,c)=>c.n-a.n)[0],m=kMed(storyLinks.map(l=>l.n));
    if(b.n>=1.5*m)out.push({id:"sneek-beste-story-"+b.bron,bron:"sneek",impact:30,n:storyLinks.length*2,big:nf0.format(b.n),h:`bezoekâhs uit story <code>${esc(b.bron)}</code> (${dLabel(b.eerst)}), je beste tot nu`,
      p:`De middelste story met link bracht ${nf0.format(m)}.`,a:"<b>Doe:</b> kijk wat die story anders deed (tijdstip, tekst, plaatje, score laten zien?) en doe dat nog eens."})}
  // 4. Insta-bezoek zakt in
  const d=s.dagen,w1=d.slice(-7).reduce((a,x)=>a+x.parts[0].v+x.parts[1].v,0),w0=d.slice(-14,-7).reduce((a,x)=>a+x.parts[0].v+x.parts[1].v,0);
  const okZ=w0>=10&&w1<w0*0.7;
  if(okZ||kVolgt("sneek-insta-zakt"))out.push({id:"sneek-insta-zakt",stil:!okZ,bron:"sneek",impact:45,n:10,big:w0?(w1<w0?"−":"+")+pct(Math.abs(1-w1/w0)):nf0.format(w1),h:"Sneek-bezoekâhs via Insta/Facebook vergeleken met vorige week",
    p:`Deze week ${nf0.format(w1)}, vorige week ${nf0.format(w0)}.`,trend:kVs(w1,w0),
    a:"<b>Doe:</b> tijd voor een nieuwe Sneek-story: laat de toppâh van de lèst zien (\"Wie pakt @… z'n plek?\") met een eigen link.",
    meet:{naam:"bezoekâhs via Meta per week",waarde:w1,beter:"hoger"}});
  // 5. bezoekers spelen niet
  if(g.b30>=30||(g.b30>0&&kVolgt("sneek-speel-ratio"))){const r=Math.min(1,g.p30/g.b30);
    if((g.b30>=30&&r<0.6)||kVolgt("sneek-speel-ratio"))out.push({id:"sneek-speel-ratio",stil:!(g.b30>=30&&r<0.6),bron:"sneek",impact:40,n:g.b30>=100?10:6,big:pct(1-r),h:"van de Sneek-bezoekâhs start geen potje",
      p:`${nf0.format(g.b30)} bezoekâhs, ${nf0.format(g.p30)} speelden (30 dagen). Wie niet speelt, komt ook niet op de lèst.`,
      a:"<b>Doe:</b> maak de startknop groter en de eerste seconde spannender (bijv. meteen spelen met één tik, uitleg pas daarna). Kijk op de telefoon hoe het beginscherm eruitziet.",
      meet:{naam:"% dat speelt",waarde:Math.round(r*100),beter:"hoger"}})}
  // 6. weinig scores gedeeld
  if(g.p30>=20||(g.p30>0&&kVolgt("sneek-delen"))){const r=g.g30/g.p30;
    if((g.p30>=20&&r<0.1)||kVolgt("sneek-delen"))out.push({id:"sneek-delen",stil:!(g.p30>=20&&r<0.1),bron:"sneek",impact:35,n:g.p30>=100?10:6,big:pct(r),h:"van de spelâhs deelt z'n scoâh",
      p:`${nf0.format(g.g30)} keer gedeeld op ${nf0.format(g.p30)} spelâhs (30 dagen). Elke gedeelde scoâh is gratis reclame.`,
      a:"<b>Doe:</b> geef een reden om te delen: \"Tag je maat die dit nie haalt\", of noem gedeelde toppâhs elke week in je story.",
      meet:{naam:"% dat deelt",waarde:Math.round(r*100),beter:"hoger"}})}
  return out;
}

/* ---------- alles samen ---------- */
function kansenAlle(d){
  const lijst=[];
  const veilig=(f,...a)=>{try{return f(...a)}catch(e){console.warn("kans-regel faalde",e);return []}};
  lijst.push(...veilig(kansenMuziek,d||compute()),...veilig(kansenInsta),...veilig(kansenSneek));
  const gezien=new Set();
  return lijst.filter(k=>{k.id=kSlug(k.id);if(gezien.has(k.id))return false;gezien.add(k.id);return true}).map(k=>{
    k.zeker=k.n>=10?1:k.n>=5?0.7:0.4;k.score=k.impact*k.zeker;k.dagen=kansDagen(k.id);
    k.bezig=kBezig(k.id);k.wacht=kWacht(k.id);k.vorige=kVorige(k.id);k.verborgen=kVerborgen(k.id);
    if(k.meet&&!isFinite(k.meet.waarde))k.meet=null;
    return k}).sort((a,b)=>b.score-a.score);
}
const BRON={muziek:["Muziek","sc"],insta:["Insta","hy"],sneek:["Sneek","groen"]};
const bronChip=b=>{const [n,c]=BRON[b]||[b,"muted"];return `<span class="chip kbron" style="--c:var(--${c})">${n}</span>`};
function kansGrootte(k){return k.score>=45?'<span class="chip good">grote kans</span>':k.score>=25?'<span class="chip warn">middel</span>':'<span class="chip mute">klein</span>'}
function kansZeker(k){return k.zeker>=1?"":k.zeker>=0.7?' <span class="chip mute">nog voorzichtig</span>':' <span class="chip mute">weinig data</span>'}

// welke kaarten waar: mee bezig (pogingen zonder afmelding), afgemeld (wacht op rapport), open, weggezet
function kansGroepen(alle,bron){
  const f=b=>bron==="alles"||b===bron;
  const kaart=p=>alle.find(k=>k.id===p.sleutel)||null;
  const bezig=KP.rijen.filter(p=>!p.gestopt_om&&f(p.bron)).sort((a,b)=>a.rapport_op<b.rapport_op?-1:1).map(p=>({p,k:kaart(p)}));
  const wacht=KP.rijen.filter(p=>p.gestopt_om&&!p.rapport&&f(p.bron)).sort((a,b)=>a.rapport_op<b.rapport_op?-1:1).map(p=>({p,k:kaart(p)}));
  const vrij=alle.filter(k=>!k.stil&&f(k.bron)&&!k.bezig&&!k.wacht.length);
  return {bezig,wacht,open:vrij.filter(k=>!k.verborgen),verborgen:vrij.filter(k=>k.verborgen)};
}

/* ---------- stukjes van een kaart ---------- */
function kLaatste(p){const m=KP.met.get(p.id);if(!m||!m.size)return null;return m.get([...m.keys()].sort().pop())}
function kRicht(voor,na,beter){if(voor==null||na==null)return null;const d=voor===0?(na===0?0:Math.sign(na)):(na-voor)/Math.abs(voor);return beter==="lager"?-d:d}
// balkje: hoe ver ben je in de looptijd, en wanneer komt het rapport
function kLoop(p){
  if(kmPlan(p.sleutel)&&!p.rapport)return kmLoop(p);
  const t0=Date.parse(p.gestart_om),t1=Date.parse(p.rapport_op),f=Math.max(0,Math.min(1,(Date.now()-t0)/Math.max(1,t1-t0)));
  const dag=Math.max(1,Math.min(p.looptijd_dagen,Math.floor((Date.now()-t0)/864e5)+1)),nog=Math.max(0,Math.ceil((t1-Date.now())/864e5));
  const voor=p.gestopt_om?`${p.afloop==="gestopt"?"Gestopt":"Gedaan"} op ${kD(p.gestopt_om)} · `:p.rapport?"":`Dag ${dag} van ${p.looptijd_dagen} · `;
  const rap=p.rapport?`rapport is klaar ✓ <button class="lnk" type="button" data-khopen="${p.id}">bekijk</button>${p.gestopt_om?"":" · meld je af met Gedaan of Gestopt"}`
    :`rapport op <b>${kD(p.rapport_op)}</b> ${nog?`(nog ${nog} dag${nog>1?"en":""})`:"(vandaag)"}`;
  return `<div class="kloop"><div class="kloopt">${voor}${rap}</div><div class="kbalk" role="progressbar" aria-label="Looptijd" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f*100)}"><i style="width:${(f*100).toFixed(1)}%"></i></div></div>`;
}
// looptijd van een taak met meetplan: doen (tot je afmeldt) → meten (tot de laatste post ± 95% van z'n eindstand heeft)
function kmLoop(p){
  if(!p.gestopt_om){const plan=kmPlan(p.sleutel),dl=kmDeadline(p,plan),st=kmStand(p),n=st?st.taak.length:0,a=plan.doen&&plan.doen.aantal;
    const t0=Date.parse(p.gestart_om),t1=dl?Date.parse(dl):t0,f=dl?Math.max(0,Math.min(1,(Date.now()-t0)/Math.max(1,t1-t0))):0,nog=dl?Math.max(0,kDagen(vandaagAms(),dagNL(t1))):0;
    return `<div class="kloop"><div class="kloopt"><b>Doen:</b> ${kmDoenTekst(plan,dl)}${dl?nog?` (nog ${nog} dag${nog===1?"":"en"})`:" (vandaag)":""} · ${a?`<b>${n} van ${a}</b> gedaan${n>=a?" ✓":""}`:`${n} ${esc(plan.wat)} tot nu`}</div>
      <div class="kbalk" role="progressbar" aria-label="Tijd tot de deadline" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f*100)}"><i style="width:${(f*100).toFixed(1)}%"></i></div>
      <div class="kloopt">Meld je af met Gedaan of Gestopt als je klaar bent; doe je dat nie, dan sluit de taak vanzelf op de deadline. Daarna meet het dashboard door tot je laatste post z'n eindstand heeft.</div></div>`}
  const t0=Date.parse(p.gestopt_om),t1=Date.parse(p.rapport_op),f=Math.max(0,Math.min(1,(Date.now()-t0)/Math.max(1,t1-t0))),nog=Math.max(0,kDagen(vandaagAms(),dagNL(t1)));
  const st=kmStand(p),a=st&&st.doenAantal,n=st?st.taak.length:0,auto=st&&st.deadline&&Math.abs(Date.parse(st.deadline)-t0)<2000;
  return `<div class="kloop"><div class="kloopt">${auto?"Deadline voorbij":p.afloop==="gestopt"?"Gestopt":"Gedaan"} op ${kD(p.gestopt_om)}${a?` (${n} van ${a} ${n>=a?"✓":"gedaan"})`:""} · <b>meting loopt</b> · rapport op <b>${kD(p.rapport_op)}</b> ${nog?`(nog ${nog} dag${nog>1?"en":""})`:"(vandaag)"}</div><div class="kbalk" role="progressbar" aria-label="Meting" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f*100)}"><i style="width:${(f*100).toFixed(1)}%"></i></div></div>`;
}
function kMeetRegel(p,nu){
  if(!p.meet_naam||p.waarde_start==null)return "";
  if(nu==null)nu=kLaatste(p);if(nu==null)return "";
  const f=kFmt(p),oud=+p.waarde_start,r=kRicht(oud,nu,p.meet_beter);
  return `<div class="kvoort">Sinds ${kD(p.gestart_om)}: ${esc(p.meet_naam)} ${f(oud)} → <b>${f(nu)}</b> ${!r?"(nog gelijk)":r>0?'<span class="up">betâh ↑</span>':'<span class="down">nog nie betâh</span>'}</div>`;
}
function kVorigeRegel(p){const O=KANS_OORDEEL[p.rapport.oordeel]||KANS_OORDEEL.onbekend;
  return `<div class="kvoort">Vorige keer (${kD(p.gestart_om)}): <span class="chip ${O.c}">${O.t}</span> <button class="lnk" type="button" data-khopen="${p.id}">rapport</button></div>`}

// open kans: nog nie mee bezig
function kansKaart(k){
  const rap=dKort(kDag(vandaagAms(),k.dagen));
  return `<article class="ins kans${k.verborgen?" k-verborgen":""}" data-kans="${esc(k.id)}">
    <div class="kkop">${bronChip(k.bron)}${kansGrootte(k)}${kansZeker(k)}</div>
    <span class="big">${k.big}</span><h3>${k.h}</h3><p>${k.p}</p><div class="act">${k.a}</div>
    ${k.trend?`<div class="kvoort">Trend: ${k.trend}</div>`:""}${k.vorige?kVorigeRegel(k.vorige):""}
    ${kmPlan(k.id)?kmOpenRegel(k):`<div class="kloopt">Looptijd <b>${k.dagen} dagen</b>: begin je nu, dan krijg je op ${rap} een rapport.</div>`}
    ${(b=>b?`<div class="kloopt kbezet">Je bent al bezig met een ${BRON[k.bron][0]}-challenge: <b>${esc(kTekst(b.kop)).slice(0,70)}</b>. Meld die eerst af (Gedaan of Gestopt), dan kun je deze starten. Waarom: 1 challenge per onderdeel tegelijk, zodat je weet waar een effect vandaan komt.</div>`:"")(kBezigBron(k.bron))}
    <div class="kknop">
      <button class="btn" type="button" data-kz="start"${kBezigBron(k.bron)?" disabled":""}>Mee bezig</button>
      <button class="btn kweg" type="button" data-kz="verborgen">${k.verborgen?"Toch tonen":"Nie voor mij"}</button></div>
  </article>`;
}
function kmOpenRegel(k){
  let s=null;try{s=kmStand({sleutel:k.id,gestart_om:new Date().toISOString(),gestopt_om:null})}catch(e){}
  const M=s&&s.M;
  const plan=kmPlan(k.id),dl=kmDeadline({sleutel:k.id,gestart_om:new Date().toISOString()},plan);
  return `<div class="kloopt"><b>Doen:</b> ${kmDoenTekst(plan,dl)}. <b>Meten:</b> daarna tot je laatste post z'n eindstand heeft (± ${s?s.klaarNaFeed:5} dagen, reel ± ${s?s.klaarNaReel:10}), dan het rapport.${s&&s.alleMed!=null?` Verwachting: <b>${M.fmt(s.alleMed*s.factor)}</b> ${M.kort}${M.curve?" per post":""}${s.factor!==1?` (${kX(s.factor)} je normaal)`:""}.`:""}</div>`;
}
// mee bezig: looptijd + voortgang + afmelden
function kansBezigKaart({p,k}){
  const oeps=Date.now()-Date.parse(p.gestart_om)<864e5;
  return `<article class="ins kans k-bezig" data-kp="${p.id}">
    <div class="kkop">${bronChip(p.bron)}<span class="chip warn">mee bezig</span>${k&&k.stil?'<span class="chip mute" title="De cijfâhs geven nu geen aanleiding meer voor deze kaart (misschien al gelukt, misschien veranderd). Het dashboard blijft wel meten tot het rapport.">staat nu nie meer bij je kansâh</span>':""}</div>
    <span class="big">${k?k.big:p.big||""}</span><h3>${k?k.h:p.kop||esc(p.sleutel)}</h3>${k&&!k.stil?`<p>${k.p}</p>`:""}<div class="act">${k?k.a:p.actie||""}</div>
    ${kLoop(p)}${kmPlan(p.sleutel)?kmHTML(kmStand(p)):kTeltMeeHTML(p)}${kMeetRegel(p,k&&k.meet?k.meet.waarde:null)}
    <div class="kknop">
      <button class="btn" type="button" data-kz="gedaan">Gedaan ✓</button>
      <button class="btn" type="button" data-kz="gestopt">Gestopt</button>
      ${oeps?'<button class="btn kweg" type="button" data-kz="oeps" title="Wist deze poging helemaal (kan alleen de eerste 24 uur)">Per ongeluk</button>':""}</div>
  </article>`;
}
// afgemeld: wacht op het rapport
function kansWachtKaart({p,k}){
  return `<article class="ins kans k-wacht" data-kp="${p.id}">
    <div class="kkop">${bronChip(p.bron)}${p.afloop==="gestopt"?'<span class="chip mute">gestopt</span>':'<span class="chip good">gedaan ✓</span>'}</div>
    <h3>${k?k.h:p.kop||esc(p.sleutel)}</h3>${kLoop(p)}${kmPlan(p.sleutel)?kmHTML(kmStand(p)):kTeltMeeHTML(p)}${kMeetRegel(p,k&&k.meet?k.meet.waarde:null)}
  </article>`;
}
function kansNuHTML(alle,bron){
  const g=kansGroepen(alle,bron);let h="";
  if(g.bezig.length)h+=`<h3 class="kgroep">Mee bezig (${g.bezig.length})</h3><div class="insights">${g.bezig.map(kansBezigKaart).join("")}</div><h3 class="kgroep">Open kansâh (${g.open.length})</h3>`;
  h+=`<div class="insights">${g.open.map(kansKaart).join("")||'<p class="sub">Geen open kansen in deze selectie. Knap, âhwe!</p>'}</div>`;
  if(g.wacht.length)h+=`<h3 class="kgroep">Afgemeld, rapport volgt (${g.wacht.length})</h3><div class="insights">${g.wacht.map(kansWachtKaart).join("")}</div>`;
  if(g.verborgen.length){if(kansToonVerborgen)h+=`<h3 class="kgroep">Nie voor mij (${g.verborgen.length})</h3><div class="insights">${g.verborgen.map(kansKaart).join("")}</div>`;
    h+=`<p class="sub" style="margin-top:12px"><button class="btn" type="button" id="kToonVerborgen">${kansToonVerborgen?"Verberg":"Toon"} ${g.verborgen.length} weggezette kans${g.verborgen.length>1?"en":""}</button></p>`}
  return h;
}

/* ---------- het rapport ----------
   Periode "mee bezig" = de looptijd vanaf de dag van "Mee bezig"; vergeleken met even veel dagen ervóór.
   Oordeel: eerst het doel-cijfer van de kans (start → einde looptijd); heeft de kans er geen, dan het eerste
   uitkomst-cijfer van dat onderdeel (Insta: netto volgâhs per dag, Muziek: SoundCloud-plays per dag, Sneek: bezoekâhs per dag).
   Minder dan 10% verschil = geen duidelijk effect. */
const KANS_OORDEEL={
  werkte:{t:"Werkte ✓",c:"good"},deels:{t:"Deels",c:"warn"},geen:{t:"Geen duidelijk effect",c:"mute"},
  slechter:{t:"Ging achteruit",c:"niks"},onbekend:{t:"Te weinig data",c:"mute"}};
function kVenster(p){const L=p.looptijd_dagen,s=dagNL(p.gestart_om);return {L,van:s,tot:kDag(s,L-1),vvan:kDag(s,-L),vtot:kDag(s,-1)}}
// stand van alle nummers/video's samen op dag d (laatste meting t/m d per nummer)
function kStand(snaps,idv,veld,d){const per=new Map();
  (snaps||[]).forEach(s=>{if(s.snap_date>d||s[veld]==null)return;const o=per.get(s[idv]);if(!o||s.snap_date>o.d)per.set(s[idv],{d:s.snap_date,v:+s[veld]})});
  if(!per.size)return null;let t=0,dag="";per.forEach(o=>{t+=o.v;if(o.d>dag)dag=o.d});return {t,dag}}
function kUitkomsten(bron,v){
  const min=Math.max(2,Math.ceil(v.L/2)),u=[];
  const per=(naam,f,beter="hoger",fmt="1")=>{let voor=null,na=null;try{voor=f(v.vvan,v.vtot);na=f(v.van,v.tot)}catch(e){}
    u.push({naam,voor:voor!=null&&isFinite(voor)?voor:null,na:na!=null&&isFinite(na)?na:null,beter,fmt})};
  if(bron==="insta"&&!IG.err&&IG.dag.length){
    const rij=(a,b)=>IG.dag.filter(r=>r.dag>=a&&r.dag<=b);
    const gem=(a,b,g)=>{const x=rij(a,b).map(g).filter(y=>y!=null&&isFinite(y));return x.length>=min?x.reduce((s,y)=>s+y,0)/x.length:null};
    per("Netto nieuwe volgâhs per dag",(a,b)=>gem(a,b,r=>r.c.follows!=null?r.c.follows-(r.c.unfollows||0):null));
    per("Bereik per dag",(a,b)=>gem(a,b,r=>r.c.reach),"hoger","0");
    per("Volgâhs per 1.000 nieuwe mensen",(a,b)=>igPer1kNieuw(a,b,min));
    per("Gedeeld + bewaard per 1.000 bereik",(a,b)=>{const x=rij(a,b).filter(r=>r.c.reach);return x.length>=min?x.reduce((s,r)=>s+(r.c.shares||0)+(r.c.saves||0),0)*1000/x.reduce((s,r)=>s+r.c.reach,0):null});
    per("Posts gemaakt",(a,b)=>IG.posts.filter(p=>p.gepost_om&&dagNL(p.gepost_om)>=a&&dagNL(p.gepost_om)<=b).length,null,"0");
  }
  if(bron==="muziek"){
    const groei=(snaps,idv,veld)=>(a,b)=>{const x=kStand(snaps,idv,veld,kDag(a,-1)),y=kStand(snaps,idv,veld,b);
      if(!x||!y||x.dag<kDag(a,-4)||y.dag<kDag(b,-3)||y.dag<=x.dag)return null;return (y.t-x.t)/kDagen(x.dag,y.dag)};
    if(!SCL.err&&SCL.snaps.length)per("SoundCloud-plays erbij per dag",groei(SCL.snaps,"track_id","plays"));
    if(!YT.err&&YT.snaps.length)per("YouTube-weergaven erbij per dag",groei(YT.snaps,"video_id","views"));
  }
  if(bron==="sneek"){
    const gc=(a,b)=>{const dagen=new Set(),s={b:0,p:0};GC.dag.forEach(r=>{const d=String(r.dag).slice(0,10);if(d<a||d>b)return;dagen.add(d);const n=+r.aantal||0;
      if(!r.event)s.b+=n;else if(r.pad==="potje-gestart")s.p+=n});return dagen.size>=min?{...s,n:dagen.size}:null};
    if(!GC.err&&GC.dag.length){
      per("Bezoekâhs per dag",(a,b)=>{const s=gc(a,b);return s?s.b/s.n:null});
      per("Bezoekâhs via Insta/Facebook per dag",(a,b)=>{const s=gc(a,b);if(!s)return null;
        return (GC.bronnen||[]).filter(r=>{const d=String(r.dag).slice(0,10);return d>=a&&d<=b&&igBronGroep(r.bron)!=="rest"}).reduce((t,r)=>t+(+r.aantal||0),0)/s.n});
      per("% dat een potje speelt",(a,b)=>{const s=gc(a,b);return s&&s.b?Math.min(1,s.p/s.b)*100:null},"hoger","pct");
    }
    if(!SNEEK.err)per("Nieuwe spelâhs per dag",(a,b)=>SNEEK.rows.filter(x=>{const d=dagNL(x.eerst);return d>=a&&d<=b}).length/(kDagen(a,b)+1));
  }
  return u;
}
function kansRapportMaak(p){
  if(kmPlan(p.sleutel)){const st=kmStand(p);if(st)return kmRapportMaak(p,st)}
  const v=kVenster(p),rapDag=dagNL(p.rapport_op),start=v.van;
  const m=[...(KP.met.get(p.id)||new Map())].sort((a,b)=>a[0]<b[0]?-1:1);
  let meet=null;
  if(p.meet_naam){
    const st=p.waarde_start!=null?+p.waarde_start:(m[0]?m[0][1]:null);
    const na=m.filter(([d])=>d>start),binnen=na.filter(([d])=>d<=rapDag);
    const e=binnen.length?binnen[binnen.length-1]:(na.find(([d])=>d<=kDag(rapDag,7))||null);   // te laat geopend? dan de eerste meting erna (max 7 dagen)
    meet={naam:p.meet_naam,beter:p.meet_beter||"hoger",fmt:p.meet_fmt||null,start:st,eind:e?e[1]:null,eind_dag:e?e[0]:null,
      reeks:m.filter(([d])=>d<=(e?e[0]:rapDag)).slice(-60)};
  }
  const uitkomsten=kUitkomsten(p.bron,v);
  const rm=meet?kRicht(meet.start,meet.eind,meet.beter):null;
  const hoofd=uitkomsten.find(x=>x.beter&&x.voor!=null&&x.na!=null)||null;
  const ru=hoofd?kRicht(hoofd.voor,hoofd.na,hoofd.beter):null;
  let oordeel="onbekend",grond=null;
  if(rm!=null){grond="meet";oordeel=rm>=0.1?(ru!=null&&ru<=-0.1?"deels":"werkte"):rm<=-0.1?"slechter":"geen"}
  else if(ru!=null){grond="uitkomst";oordeel=ru>=0.1?"werkte":ru<=-0.1?"slechter":"geen"}
  let nummers=null;const ms=/^muziek-sc-(momentum|nieuw)-(.+)$/.exec(p.sleutel);
  if(ms){const ids=[(SCL.tracks.find(x=>kSlug(String(x.track_id))===ms[2])||{}).track_id,...(kpExtra(p).nummers||[])].filter(Boolean);
    nummers=ids.map(id=>{const t=SCL.tracks.find(x=>x.track_id===id),a=kStand(SCL.snaps.filter(x=>x.track_id===id),"track_id","plays",kDag(v.van,-1)),b=kStand(SCL.snaps.filter(x=>x.track_id===id),"track_id","plays",v.tot);
      return {titel:t?t.title:id,erbij:a&&b?b.t-a.t:null,handmatig:id!==ids[0]}})}
  return {v:1,oordeel,grond,hoofd:hoofd?hoofd.naam:null,nummers,
    periode:{van:v.van,tot:v.tot,voor_van:v.vvan,voor_tot:v.vtot,dagen:v.L},meet,uitkomsten,gemaakt:new Date().toISOString()};
}
// rapport voor een taak met meetplan: de taak-posts t.o.v. je normaal en t.o.v. de verwachting, plus je account in die periode
function kmRapportMaak(p,st){
  const o=kmOordeel(st),van=dagNL(p.gestart_om),tot=dagNL(p.rapport_op),L=Math.max(1,kDagen(van,tot)+1);
  const v={L,van,tot,vvan:kDag(van,-L),vtot:kDag(van,-1)};
  const uitkomsten=kUitkomsten(p.bron,v);
  return {v:2,oordeel:o.oordeel,verw:o.verw,grond:"plan",hoofd:null,
    plan:{maat:st.maat,wat:st.plan.wat,deadline:st.deadline,doenAantal:st.doenAantal||null,factor:st.factor,factorBron:st.factorBron,alleMed:st.alleMed,E:st.E,curveBron:st.curveBron,klaarNaFeed:st.klaarNaFeed,klaarNaReel:st.klaarNaReel,taakStart:p.gestart_om,
      taak:st.taak.map(r=>({...r,plaatje:null,bijschrift:kEersteRegel(r.bijschrift)})),nietMee:(st.nietMee||[]).map(x=>({...x,bijschrift:kEersteRegel(x.bijschrift)}))},
    periode:{van,tot,voor_van:v.vvan,voor_tot:v.vtot,dagen:L},meet:null,uitkomsten,gemaakt:new Date().toISOString()};
}
// bewaard rapport weer als "stand" tekenen (zelfde HTML als tijdens de meting)
function kmUitRapport(r){const P=r.plan;return {...P,M:KM_MAAT[P.maat],plan:{wat:P.wat},taak:P.taak.map(t=>({...t,plaatje:(IG.posts.find(x=>x.media_id===t.id)||{}).plaatje||null}))}}
const kWaarde=(x,fmt)=>x==null?"—":fmt==="0"?nf0.format(x):fmt==="pct"?nf0.format(x)+"%":nf1k.format(x);
function kVerschil(voor,na,beter){
  if(voor==null||na==null)return '<span class="sub">nog geen data</span>';
  if(!beter)return (na-voor>0?"+":na<voor?"−":"")+nf1k.format(Math.abs(na-voor));
  if(voor===0&&na===0)return "gelijk";
  const r=kRicht(voor,na,beter),t=voor===0?(na>0?"+":"−")+nf1k.format(Math.abs(na)):(na>=voor?"+":"−")+nf0.format(Math.abs(na/voor-1)*100)+"%";
  return r>=0.1?`<span class="up">${t} ↑</span>`:r<=-0.1?`<span class="down">${t} ↓</span>`:`${t}`;
}
// klein lijntje van de dagmetingen
function kSpark(reeks){
  if(!reeks||reeks.length<2)return "";
  const W=150,H=36,v=reeks.map(r=>+r[1]),mn=Math.min(...v),mx=Math.max(...v),sp=mx-mn||1;
  const pt=v.map((y,i)=>[4+i*(W-8)/(v.length-1),H-5-(y-mn)/sp*(H-10)]);
  return `<svg class="kspark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Verloop van ${reeks.length} metingen"><path d="M${pt.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join("L")}" fill="none" stroke="var(--hy)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pt[pt.length-1][0].toFixed(1)}" cy="${pt[pt.length-1][1].toFixed(1)}" r="3.2" fill="var(--hy)"/></svg>`;
}
function kOordeelUitleg(r,p){
  if(r.plan){const P=r.plan,M=KM_MAAT[P.maat],n=P.taak.length,w=esc(P.wat);
    if(!n)return `Geen ${w} gevonden tussen de start en het afmelden, dus nix te meten. Werd je post nie herkend? Label hem in de Insta-tab.`;
    const xs=`${n===1?"Je post deed":`Je ${n} ${w} deden (middelste)`} <b>${kX(P.E||0)}</b> je normaal (${M.naam})`;
    const vw=r.verw==="boven"?"Dat is méér dan verwacht":r.verw==="onder"?"Dat is minder dan verwacht":"Dat is zoals verwacht";
    const vt=`${vw} (${kX(P.factor)}).`;
    return r.oordeel==="werkte"?`${xs}. ${vt} Blijven doen, âhwe!`:r.oordeel==="slechter"?`${xs}: onder je normaal. ${vt}`:r.oordeel==="geen"?`${xs}: ongeveer je normaal. ${vt}`:`${xs}. Te weinig data voor een oordeel.`+(n<3?"":"")}
  const L=r.periode.dagen,m=r.meet,h=r.uitkomsten.find(x=>x.naam===r.hoofd);
  const mt=m&&m.eind!=null?`${esc(m.naam)} ging van ${kFmt(p)(m.start)} naâh ${kFmt(p)(m.eind)}`:"";
  const ht=h?`${h.naam.toLowerCase()} ${kWaarde(h.voor,h.fmt)} → ${kWaarde(h.na,h.fmt)} (${L} dagen ervóór vs ${L} dagen mee bezig)`:"";
  switch(r.oordeel){
    case "werkte":return r.grond==="meet"?`Je doel-cijfâh ging de goeie kant op: ${mt}. Blijven doen, âhwe!`:`Geen eigen doel-cijfâh bij deze kans, maar je ${ht} ging vooruit.`;
    case "deels":return `Je doel-cijfâh ging vooruit (${mt}), maar je ${ht} ging achteruit. Kèk of het een het ander kost.`;
    case "geen":return r.grond==="meet"?`${mt}: minder dan 10% verschil. Probeer het langer, of pak het anders aan.`:`Je ${ht}: minder dan 10% verschil.`;
    case "slechter":return r.grond==="meet"?`${mt}: de verkeerde kant op. Misschien lag het aan iets anders, maar dit was geen succes.`:`Je ${ht} ging achteruit.`;
    default:return "Te weinig metingen om iets te zeggen (bijvoorbeeld omdat je het dashboard in die tijd weinig opende, of omdat de cijfâhs van vóór je start nog nie bijgehouden werden).";
  }
}
function kansRapportHTML(p){
  const r=p.rapport;if(!r)return "";
  const O=KANS_OORDEEL[r.oordeel]||KANS_OORDEEL.onbekend,f=kFmt(p),L=r.periode.dagen;
  const af=p.gestopt_om?`${p.afloop==="gestopt"?"gestopt":"gedaan"} op <b>${kD(p.gestopt_om)}</b> (na ${Math.max(1,kDagen(dagNL(p.gestart_om),dagNL(p.gestopt_om)))} dag${kDagen(dagNL(p.gestart_om),dagNL(p.gestopt_om))>1?"en":""})`:"nog nie afgemeld";
  let h=`<div class="krap">
    <div class="kkop">${bronChip(p.bron)}<span class="chip ${O.c}">${O.t}</span>${r.verw?`<span class="chip mute">${KM_VERW[r.verw]}</span>`:""}${p.afloop==="gestopt"?'<span class="chip mute">gestopt</span>':p.afloop?'<span class="chip good">gedaan ✓</span>':'<span class="chip warn">nog mee bezig</span>'}</div>
    <h3>${p.kop||esc(p.sleutel)}</h3>
    <p class="kwanneer">Mee bezig vanaf <b>${kD(p.gestart_om)}</b> · ${af} · ${r.plan?`rapport op ${kD(p.rapport_op)}`:`rapport na ${L} dagen`}</p>
    <p class="kuitleg">${kOordeelUitleg(r,p)}</p>`;
  if(r.plan&&r.plan.doenAantal){const n=r.plan.taak.length,a=r.plan.doenAantal;h+=`<p class="kwanneer"><b>Taak:</b> ${n} van ${a} ${esc(r.plan.wat)} ${n>=a?"gedaan ✓":"gedaan"}${r.plan.deadline?` (deadline ${kD(r.plan.deadline)})`:""}</p>`}
  if(r.plan)h+=kmHTML(kmUitRapport(r),{rapport:true})+(r.plan.taak.length&&r.plan.taak.length<3?'<p class="sub">Let op: gemeten op maar '+r.plan.taak.length+' post'+(r.plan.taak.length>1?"s":"")+', dus voorzichtig met conclusies.</p>':"");
  const m=r.meet;
  if(m)h+=`<div class="kmeet"><div><span class="k">Doel-cijfâh: ${esc(m.naam)}</span>
      <span class="v">${m.start!=null?f(m.start):"—"} → ${m.eind!=null?f(m.eind):"—"}</span>
      <span class="s">${m.eind!=null&&m.start!=null?kVerschil(m.start,m.eind,m.beter)+" · ":""}${m.eind_dag?"gemeten op "+dKort(m.eind_dag):"geen meting aan het eind"} · ${m.beter==="lager"?"lagâh":"hogâh"} is betâh</span></div>${kSpark(m.reeks)}</div>`;
  if(r.uitkomsten.length)h+=`<div class="tablewrap"><table class="ktab"><thead><tr><th>Cijfâh</th><th class="n"><span class="pc">${L} d </span>ervóór</th><th class="n"><span class="pc">${L} d ${r.plan?"":"mee "}</span>${r.plan?"sinds start":"bezig"}</th><th class="n">Verschil</th></tr></thead><tbody>
    ${r.uitkomsten.map(x=>`<tr${x.naam===r.hoofd?' class="hoofd"':""}><td>${esc(x.naam)}</td><td class="n">${kWaarde(x.voor,x.fmt)}</td><td class="n">${kWaarde(x.na,x.fmt)}</td><td class="n">${kVerschil(x.voor,x.na,x.beter)}</td></tr>`).join("")}
    </tbody></table></div><p class="sub kdata">${r.plan?"Je hele account, ter vergelijking. ":""}Ervóór: ${dKort(r.periode.voor_van)} t/m ${dKort(r.periode.voor_tot)} · ${r.plan?"sinds start":"mee bezig"}: ${dKort(r.periode.van)} t/m ${dKort(r.periode.tot)}</p>`;
  if(r.nummers&&r.nummers.length)h+=`<div class="ktelt"><p class="ktelkop">Nummâhs in de challenge (plays erbij in de periode)</p><ul>${r.nummers.map(n=>`<li><b>${esc(n.titel)}</b>${n.handmatig?" (zelf toegevoegd)":""} · ${n.erbij!=null?kPlus(n.erbij):"nog geen meting"}</li>`).join("")}</ul></div>`;
  if(p.actie)h+=`<details class="kwat"><summary>Wat je ging doen</summary><div class="act">${p.actie}</div></details>`;
  h+=`<p class="sub">Samenhang is geen bewijs: er gebeurt in ${L} dagen meer dan alleen deze actie.</p></div>`;
  return h;
}

/* ---------- Meetplan per taak (03-10, v2) ----------
   Voor Insta-kansen die over je POSTS gaan, meet het dashboard precies de posts die bij de taak horen:
   - welke posts: geplaatst vanaf de startdag t/m het afmelden, en passend bij de taak (onderwerp, reel, dagdeel, eigen muziek, of alles).
   - verwachting bij de start: je normaal (middelste bereik van vergelijkbare posts van vóór de start, per soort post)
     × wat dit soort post bij jou gemiddeld extra doet (zelfde som als "Wat werkt", maar alleen met posts van vóór de start).
   - wanneer zie je het: de groeicurve van je posts (uit ig_media_dag: hoeveel % van de eindstand een post na X dagen heeft).
     Rapport = als de laatste taak-post ± 95% van z'n eindstand heeft (feed ± 5 dagen, reel ± 10; met eigen data dynamisch).
   - tussendoor: per post het bereik nu, wat normaal is op die leeftijd, en de verwachte eindstand (bereik nu ÷ % van de curve).
   Andere kansen (muziek, Sneek, rest Insta) houden de vaste looptijd vanaf Mee bezig. */
let KM={dag:[],err:null},KM_LAADT=null;                      // ig_media_dag: {media_id, dag, reach, om}
function kmLaden(){KM_LAADT=kmLadenEcht();return KM_LAADT}
async function kmLadenEcht(){
  try{
    const since=new Date(Date.now()-75*864e5).toISOString().slice(0,10);
    const rijen=await igAlles(()=>sb.from("ig_media_dag").select("media_id,dag,reach:cijfers->reach,om:gemeten_om").gte("dag",since).order("dag"));
    KM={dag:rijen.filter(r=>r.reach!=null).map(r=>({id:r.media_id,dag:String(r.dag).slice(0,10),reach:+r.reach,om:r.om})),err:null};
  }catch(e){KM={dag:[],err:e.message||String(e)}}
}
// standaard-groeicurves (deel van de eindstand na X dagen), tot er genoeg eigen metingen zijn
const KM_CURVE_STD={
  feed:[[0,0],[0.25,.3],[0.5,.5],[1,.72],[2,.85],[3,.9],[4,.93],[5,.95],[7,.97],[10,.99],[14,1]],
  reel:[[0,0],[0.25,.2],[0.5,.35],[1,.55],[2,.7],[3,.78],[4,.83],[5,.87],[7,.92],[10,.97],[14,1]]};
const KM_KNOPEN=[0.5,1,2,3,4,5,7,10];
const kmGroep=p=>soortGroep(p)==="reel"?"reel":"feed";   // groeicurve: zelfde indeling als de rest (soortGroep in insta.js)
const kmLeeftijd=(p,t)=>((t??Date.now())-Date.parse(p.gepost_om))/864e5;
function kmInterp(c,a){if(a<=0)return 0;for(let i=1;i<c.length;i++)if(a<=c[i][0]){const [x0,y0]=c[i-1],[x1,y1]=c[i];return y0+(y1-y0)*(a-x0)/(x1-x0)}return 1}
// eigen curve: posts met metingen vanaf ≤ 1,5 dag én tot ≥ 10 dagen; per knoop de middelste waarde (min. 5 posts)
let KM_CURVE_CACHE=null;
function kmCurve(g){
  if(!KM_CURVE_CACHE){KM_CURVE_CACHE={};
    const per=new Map();KM.dag.forEach(r=>{if(!per.has(r.id))per.set(r.id,[]);per.get(r.id).push(r)});
    const posts=new Map(IG.posts.map(p=>[p.media_id,p]));
    for(const gg of ["feed","reel"]){
      const krommen=[];
      per.forEach((rij,id)=>{const p=posts.get(id);if(!p||!p.gepost_om||kmGroep(p)!==gg)return;
        const pt=rij.map(r=>[kmLeeftijd(p,Date.parse(r.om||r.dag+"T12:00:00Z")),r.reach]).filter(([a])=>a>0&&a<=16).sort((a,b)=>a[0]-b[0]);
        if(pt.length<4||pt[0][0]>1.5||pt[pt.length-1][0]<10)return;
        const eind=Math.max(...pt.map(x=>x[1]));if(!eind)return;
        const c=[[0,0],...pt.map(([a,v])=>[a,v/eind])];krommen.push(c)});
      if(krommen.length>=5){
        let vorige=0;const c=[[0,0],...KM_KNOPEN.map(k=>{const v=Math.max(vorige,Math.min(1,kMed(krommen.map(kr=>kmInterp(kr,k)))));vorige=v;return [k,v]}),[14,1]];
        KM_CURVE_CACHE[gg]={c,bron:`je eigen posts (${krommen.length})`};
      }else KM_CURVE_CACHE[gg]={c:KM_CURVE_STD[gg],bron:"standaard-curve (nog te weinig eigen metingen)"};
    }}
  return KM_CURVE_CACHE[g];
}
const kmDeel=(p,a)=>kmInterp(kmCurve(kmGroep(p)).c,a);
const kmKlaarNa=g=>{const c=kmCurve(g).c;const k=c.find(([a,v])=>v>=0.95);return Math.max(3,Math.ceil(k?k[0]:7))};   // dagen tot ± 95%

// 00:00 Haagse tijd op een dag (JJJJ-MM-DD) als tijdstip
function amsMiddernacht(dag){const t=Date.parse(dag+"T00:00:00Z");
  const muur=Date.parse(new Date(t).toLocaleString("sv-SE",{timeZone:"Europe/Amsterdam"}).replace(" ","T")+"Z");return t-(muur-t)}
// deadline van het "doen"-deel: "week" = zondag 23:59 van de startweek (start je in het weekend, dan de week erna); getal = zoveel dagen na de start
function kmDeadline(p,plan){
  plan=plan||kmPlan(p.sleutel);if(!plan||!plan.doen)return null;const t0=Date.parse(p.gestart_om);
  if(plan.doen.termijn==="week"){const d=dagNL(t0),wd=new Date(d+"T12:00:00Z").getUTCDay(),totMa=wd===0?1:8-wd;
    let dl=amsMiddernacht(kDag(d,totMa))-1000;if(dl-t0<2*864e5)dl=amsMiddernacht(kDag(d,totMa+7))-1000;return new Date(dl).toISOString()}
  return new Date(amsMiddernacht(kDag(dagNL(t0),plan.doen.termijn+1))-1000).toISOString();   // einde van de dag, zoveel dagen na de start
}
const kmDoenTekst=(plan,dl)=>esc(plan.doen.tekst?plan.doen.tekst:plan.doen.aantal?`${plan.doen.aantal} ${plan.doen.aantal===1?plan.wat.replace(/^posts\b/,"post").replace(/^reels$/,"reel"):plan.wat}`:plan.wat)+(dl?` vóór ${kD(dl)} ${tijdAms(dl)}`:"");
// welk plan hoort bij een kans? (null = gewone kans met vaste looptijd)
function kmPlan(sleutel){
  const sl=String(sleutel);let m;
  const mooi=naam=>{for(const x of IG.posts)for(const l of (x.labels||[]))if(kSlug(l.label)===naam)return l.label;return naam.replace(/-/g," ")};
  const metLabel=(soort,naam)=>p=>labelsVan(p,soort).some(l=>kSlug(l)===naam)||(soort==="onderwerp"&&String(p.bijschrift||"").toLowerCase().includes(naam.replace(/-/g," ")));
  // doen: {aantal, termijn} = wat de kaart vraagt ("plan deze week 2 posts" → 2 posts, deadline zondag 23:59 van de startweek)
  if((m=/^insta-onderwerp-minder-(.+)$/.exec(sl)))return {maat:"bereik",wat:`posts over ${mooi(m[1])}`,hoort:metLabel("onderwerp",m[1]),groep:metLabel("onderwerp",m[1]),doen:{aantal:null,termijn:"week",tekst:`${mooi(m[1])} combineren met een sterker onderwerp`},nie:`nie over ${mooi(m[1])}`};
  if((m=/^insta-onderwerp-(.+)$/.exec(sl)))return {maat:"bereik",wat:`posts over ${mooi(m[1])}`,hoort:metLabel("onderwerp",m[1]),groep:metLabel("onderwerp",m[1]),doen:{aantal:2,termijn:"week"},nie:`nie over ${mooi(m[1])}`};
  if(sl==="insta-meer-reels")return {maat:"bereik",wat:"reels",hoort:p=>soortNaam(p)==="Reel",groep:p=>soortNaam(p)==="Reel",perSoort:false,doen:{aantal:1,termijn:"week"},nie:"geen reel"};
  if((m=/^insta-tijd-(.+)$/.exec(sl)))return {maat:"bereik",wat:"posts in dat dagdeel",hoort:p=>kSlug(dagdeel(p.uur??12))===m[1],groep:p=>kSlug(dagdeel(p.uur??12))===m[1],doen:{aantal:3,termijn:14},nie:"ander dagdeel"};
  if(sl==="insta-eigen-muziek"){const mz=p=>{const l=labelsVan(p,"muziek");return l.length&&!igGeenEigen(l[0])};return {maat:"bereik",wat:"posts met je eigen muziek",hoort:mz,groep:mz,doen:{aantal:null,termijn:14,tekst:"posts met je eigen muziek eronder"},nie:"geen eigen muziek gekozen"}}
  if(sl==="insta-nieuw-naar-volger")return {maat:"volgers",wat:"al je posts",hoort:()=>true,doel:1.25,doen:{aantal:null,termijn:7,tekst:"elke post eindigen met een volg-zin + 3 toppâhs vastzetten"}};
  if(sl==="insta-bewaren")return {maat:"bewaard",wat:"al je posts",hoort:()=>true,doel:1.25,doen:{aantal:null,termijn:14,tekst:"een bewaar-post maken (tips, plekken, tijden)"}};
  return null;
}
const KM_MAAT={
  bereik:{naam:"bereik per post",kort:"bereik",f:p=>p.bereik,fmt:v=>nf0.format(v),curve:true},
  volgers:{naam:"nieuwe volgâhs per 1.000 bereik",kort:"volgâhs/1.000",f:p=>p.bereik>=100&&p.nieuwe_volgers!=null?p.nieuwe_volgers*1000/p.bereik:null,fmt:v=>nf1k.format(v)},
  bewaard:{naam:"bewaard per 1.000 bereik",kort:"bewaard/1.000",f:p=>p.bereik>=100&&p.bewaard!=null?p.bewaard*1000/p.bereik:null,fmt:v=>nf1k.format(v)}};

// alles uitrekenen voor een poging: posts, normaal, verwachting, stand nu, wanneer klaar
function kmStand(p){
  const plan=kmPlan(p.sleutel);if(!plan||IG.err||!IG.posts.length)return null;
  const M=KM_MAAT[plan.maat];
  const deadline=kmDeadline(p,plan),startDag=dagNL(p.gestart_om),eindTs=p.gestopt_om?Date.parse(p.gestopt_om):Math.min(Date.now(),deadline?Date.parse(deadline):Infinity);
  const ex=kpExtra(p),plus=new Set(ex.plus||[]),min=new Set(ex.min||[]);
  const auto=IG.posts.filter(x=>x.gepost_om&&dagNL(x.gepost_om)>=startDag&&Date.parse(x.gepost_om)<=eindTs&&plan.hoort(x));
  const taak=[...auto.filter(x=>!min.has(x.media_id)),...IG.posts.filter(x=>plus.has(x.media_id)&&!auto.includes(x))].sort((a,b)=>a.gepost_om<b.gepost_om?-1:1);
  // om zelf toe te voegen: posts van een week vóór de start t/m nu die er nog nie in zitten
  const kiesbaar=IG.posts.filter(x=>x.gepost_om&&dagNL(x.gepost_om)>=kDag(startDag,-7)&&!taak.includes(x)).sort((a,b)=>a.gepost_om<b.gepost_om?1:-1).slice(0,25)
    .map(x=>({id:x.media_id,ts:x.gepost_om,soort:soortNaam(x),bijschrift:x.bijschrift}));
  // nie meegeteld: posts in de periode die nie bij de taak passen, en posts ná afmelden/deadline (max 7 dagen erna)
  const nietMee=IG.posts.filter(x=>x.gepost_om&&dagNL(x.gepost_om)>=startDag&&Date.parse(x.gepost_om)<=Math.min(Date.now(),eindTs+7*864e5)&&!taak.includes(x))
    .sort((a,b)=>a.gepost_om<b.gepost_om?-1:1)
    .map(x=>({id:x.media_id,ts:x.gepost_om,soort:soortNaam(x),link:x.permalink,bijschrift:x.bijschrift,
      reden:min.has(x.media_id)?"zelf weggehaald":Date.parse(x.gepost_om)>eindTs?(p.gestopt_om&&deadline&&Math.abs(Date.parse(p.gestopt_om)-Date.parse(deadline))<2000?"na de deadline":p.gestopt_om?"na je afmelding":"na de deadline"):(plan.nie||"past nie bij de taak")}));
  // verwijderd/gearchiveerd op Insta (22_verwijderde_posts.sql): telt nooit mee en staat ook nie in "Nie meegeteld" (chat 24).
  // Uitzondering: had je hem zelf toegevoegd, dan blijft hij zichtbaar, zodat je ziet waarom je teller lager is.
  (IG.weg||[]).filter(x=>x.gepost_om&&plus.has(x.media_id))
    .forEach(x=>nietMee.push({id:x.media_id,ts:x.gepost_om,soort:soortNaam(x),link:x.permalink,bijschrift:x.bijschrift,weg:true,
      reden:igWegReden(x)+(plus.has(x.media_id)?" · was zelf toegevoegd":"")}));
  nietMee.sort((a,b)=>a.ts<b.ts?-1:1);
  // basis = posts van vóór de start (120 dagen, anders 365), zonder de taak-posts
  const voor=d=>IG.posts.filter(x=>x.gepost_om&&dagNL(x.gepost_om)<startDag&&Date.parse(x.gepost_om)>Date.parse(p.gestart_om)-d*864e5&&M.f(x)!=null);
  let basis=voor(120);if(basis.length<15)basis=voor(365);
  const medVan=l=>kMed(l.map(M.f).filter(v=>v!=null));
  // normaal per groep (deel B): een post wordt alleen met z'n eigen soort vergeleken (foto/carrousel of reel),
  // met posts van vóór de start; te weinig in 120 dagen → 365 dagen → allâh tijde (igNormaal in insta.js, min. 5 posts)
  const normG={};
  const normaalVan=g=>normG[g]||(normG[g]=igNormaal(g,M.f,{voor:amsMiddernacht(startDag)}));
  const alleMed=normaalVan("foto").waarde;   // "je normaal" = je foto's & carrousels (je hoofdsoort)
  const normaalVoor=x=>plan.perSoort===false?alleMed:normaalVan(soortGroep(x)).waarde;   // meer-reels: reels juist tegen je foto's
  // verwachting: hoeveel doet dit soort post bij jou extra, binnen z'n eigen groep (alleen data van vóór de start)
  let factor=1,factorN=0,factorBron="";
  if(plan.groep&&alleMed){const g=basis.filter(plan.groep);factorN=g.length;
    const rel=plan.perSoort===false?g.map(x=>M.f(x)/alleMed):g.map(x=>{const n=normaalVan(soortGroep(x)).waarde;return n?M.f(x)/n:null}).filter(v=>v!=null);
    if(rel.length>=3){factor=Math.max(0.5,Math.min(3,kMed(rel)));
      factorBron=`${rel.length} eerdere ${plan.wat}: middelste ${kX(kMed(rel))} ${plan.perSoort===false?`je normaal van foto's & carrousels (${M.fmt(alleMed)})`:"het normaal van hun eigen soort (reels met reels, foto's met foto's)"}`}
    else factorBron=`nog maar ${rel.length} eerdere ${plan.wat}: verwachting = je normaal`}
  else if(plan.doel){factor=plan.doel;factorBron=`doel: ${pct(plan.doel-1)} betâh dan je normaal`}
  const nu=Date.now();
  const rij=taak.map(x=>{
    const a=kmLeeftijd(x,nu),normaal=normaalVoor(x),waarde=M.f(x),klaarNa=M.curve?kmKlaarNa(kmGroep(x)):2;
    const deel=M.curve?kmDeel(x,a):1,klaar=a>=klaarNa;
    const eind=waarde==null?null:M.curve?(klaar||deel>=0.95?waarde:a>=0.5?waarde/deel:null):(a>=1?waarde:null);
    const gr=soortGroep(x),ng=normaalVan(gr);
    return {id:x.media_id,ts:x.gepost_om,soort:soortNaam(x),groep:gr,normaalN:ng.n,normaalGenoeg:plan.perSoort===false||ng.genoeg,link:x.permalink,plaatje:x.plaatje,bijschrift:x.bijschrift,handmatig:plus.has(x.media_id),
      leeftijd:a,waarde,normaal,normaalNu:normaal!=null&&M.curve?normaal*deel:normaal,verwacht:normaal!=null?normaal*factor:null,
      eind,x:eind!=null&&normaal?eind/normaal:null,klaar,klaarOp:new Date(Date.parse(x.gepost_om)+klaarNa*864e5).toISOString(),deel}});
  const laatsteKlaar=rij.length?rij.map(r=>r.klaarOp).sort().pop():null;
  const rapportOp=p.gestopt_om?(laatsteKlaar&&laatsteKlaar>p.gestopt_om?laatsteKlaar:new Date(Date.parse(p.gestopt_om)+(rij.length?0:864e5)).toISOString()):null;
  const xs=rij.map(r=>r.x).filter(v=>v!=null),E=xs.length?kMed(xs):null;
  return {plan,maat:plan.maat,M,taak:rij,nietMee,kiesbaar,pid:p.id,taakStart:p.gestart_om,deadline,doenAantal:plan.doen&&plan.doen.aantal,factor,factorN,factorBron,alleMed,E,rapportOp,
    curveBron:M.curve?kmCurve(rij[0]?kmGroep(IG.posts.find(x=>x.media_id===rij[0].id)):"feed").bron:null,klaarNaFeed:kmKlaarNa("feed"),klaarNaReel:kmKlaarNa("reel")};
}
function kmOordeel(s){
  if(!s||!s.taak.length)return {oordeel:"onbekend",verw:null};
  if(s.E==null)return {oordeel:"onbekend",verw:null};
  const oordeel=s.E>=1.1?"werkte":s.E<=0.9?"slechter":"geen";
  const r=s.E/s.factor,verw=r>=1.1?"boven":r<=0.9?"onder":"zoals";
  return {oordeel,verw};
}
const kX=v=>new Intl.NumberFormat("nl-NL",{minimumFractionDigits:1,maximumFractionDigits:1}).format(v)+"×";
const KM_VERW={boven:"boven verwachting",zoals:"zoals verwacht",onder:"onder verwachting"};
// HTML: verwachting + per post de stand (voor Mee bezig, meting loopt, pop-up en rapport)
function kmHTML(s,{rapport=false}={}){
  if(!s)return "";const M=s.M;
  let h=`<div class="kmverw"><span class="k">Verwachting bij de start</span>
    <span class="v">${s.alleMed!=null?`${M.fmt(s.alleMed*s.factor)} <small>${M.kort}${M.curve?" per post":""}</small>`:"—"}</span>
    <span class="s">${s.factor!==1?`${kX(s.factor)} je normaal (${M.fmt(s.alleMed||0)}) · `:""}${esc(s.factorBron)}${M.curve?` · eindstand zie je ± ${s.klaarNaFeed} dagen na een post (reel ± ${s.klaarNaReel}) · ${esc(s.curveBron||"")}`:""}</span></div>`;
  const knop=!rapport&&s.pid!=null;
  const kies=knop&&(s.kiesbaar||[]).length?`<label class="kmkies">Post toevoegen <select data-kmkies data-kpid="${s.pid}"><option value="">kies een post…</option>${s.kiesbaar.map(x=>`<option value="${esc(x.id)}">${dKort(dagNL(x.ts))} ${tijdAms(x.ts)} · ${esc(x.soort)} · ${esc(kEersteRegel(x.bijschrift).slice(0,40))}</option>`).join("")}</select></label>`:"";
  const nie=((s.nietMee||[]).length?`<details class="kmnie"${knop?" open":""}><summary>Nie meegeteld (${s.nietMee.length})</summary><ul>${s.nietMee.map(x=>`<li><a href="${esc(x.link||"#")}" target="_blank" rel="noopener">${dKort(dagNL(x.ts))} · ${esc(x.soort)}</a> <span class="sub">${esc(kEersteRegel(x.bijschrift))}</span> <span class="chip mute">${esc(x.reden)}</span>${knop&&!x.weg?` <button class="lnk" type="button" data-kmplus="${esc(x.id)}" data-kpid="${s.pid}">Tel mee</button>`:""}</li>`).join("")}</ul></details>`:"")+kies;
  if(!s.taak.length)return h+`<p class="sub kmleeg">Nog geen ${esc(s.plan.wat)} gevonden sinds ${kD(s.taakStart||new Date().toISOString())}. Label je post in de Insta-tab als hij nie herkend wordt (labels komen er ook elke nacht vanzelf bij).</p>`+nie;
  h+=`<p class="ktelkop">Telt mee in de challenge: <b>${s.taak.length} ${s.taak.length===1?"post":"posts"}</b>${s.doenAantal?` (doel ${s.doenAantal})`:""}</p>`;
  h+=`<div class="kmposts">${s.taak.map(r=>{
    const pr=r.verwacht?Math.min(1.5,(r.eind??r.waarde??0)/r.verwacht):0;
    return `<div class="kmpost">
      <a class="kmthumb" href="${esc(r.link||"#")}" target="_blank" rel="noopener">${r.plaatje?`<img src="${esc(r.plaatje)}" alt="" loading="lazy">`:""}</a>
      <div class="kmtekst"><span><b>${dKort(dagNL(r.ts))} ${tijdAms(r.ts)} · ${esc(r.soort)}</b>${r.bijschrift?` <span class="kmbs">${esc(kEersteRegel(r.bijschrift))}</span>`:""}</span><span> <span class="sub">· ${r.klaar?"klaar":`dag ${Math.max(1,Math.ceil(r.leeftijd))}, ± ${pct(Math.min(1,r.deel))} van de eindstand`}</span>${r.handmatig?' <span class="chip kbron" style="--c:var(--hy)">zelf toegevoegd</span>':""}${r.groep==="reel"?` <span class="chip mute">reel · ${r.normaal!=null?`vs normaal reels ${M.fmt(r.normaal)}`:`te weinig eerdere reels (${r.normaalN||0}) om te vergelijken`}</span>`:""}${knop?` <button class="lnk kmuit" type="button" data-kmmin="${esc(r.id)}" data-kpid="${s.pid}">Haal eruit</button>`:""}</span>
        <span class="kmcijf">${M.kort} nu <b>${r.waarde!=null?M.fmt(r.waarde):"—"}</b>${M.curve&&!r.klaar&&r.normaalNu!=null?` · normaal op deze leeftijd ${M.fmt(r.normaalNu)}`:""}</span>
        <span class="kmcijf">${r.klaar?"eindstand":"verwachte eindstand"} <b>${r.eind!=null?M.fmt(r.eind):"nog te vroeg"}</b>${r.x!=null?` = <b class="${r.x>=1.1?"up":r.x<=0.9?"down":""}">${kX(r.x)}</b> ${r.groep==="reel"&&s.plan.perSoort!==false?"normaal van je reels":"je normaal"}`:""} · verwacht ${r.verwacht!=null?M.fmt(r.verwacht):"—"}</span>
        <div class="kbalk kmbalk" title="t.o.v. de verwachting"><i style="width:${(Math.min(1,pr/1.5)*100).toFixed(1)}%"></i><s style="left:${(100/1.5).toFixed(1)}%"></s></div></div>
    </div>`}).join("")}</div>`;
  h+=nie;
  if(s.E!=null){const o=kmOordeel(s);h+=`<p class="kmsom">${rapport?"Uitkomst":"Stand nu"}: je ${esc(s.plan.wat)} doen <b>${kX(s.E)}</b> je normaal${s.taak.length>1?" (middelste post)":""} · ${KM_VERW[o.verw]||""}</p>`}
  return h;
}

const kEersteRegel=t=>{const r=String(t||"").split(/\n/)[0].trim();return r.length>70?r.slice(0,68)+"…":r};
// "Telt mee": welke posts, nummers, links of bezoekers het dashboard voor deze kans meetelt (sinds de start)
function kTeltMeeHTML(p){
  let m;const sl=p.sleutel,van=dagNL(p.gestart_om),tot=vandaagAms(),items=[];let uitleg="";
  const blok=(kop,lijst,ul)=>`<div class="ktelt"><p class="ktelkop">${kop}</p>${lijst.length?`<ul>${lijst.map(x=>`<li>${x}</li>`).join("")}</ul>`:""}${ul?`<p class="sub">${ul}</p>`:""}</div>`;
  // stand van een nummer (SoundCloud/YouTube-snapshots) op de dag vóór de start en nu
  const groei=(snaps,idv,id,veld)=>{const r=(snaps||[]).filter(x=>x[idv]===id&&x[veld]!=null).sort((a,b)=>a.snap_date<b.snap_date?-1:1);if(!r.length)return null;
    const b=[...r].reverse().find(x=>x.snap_date<van)||r[0],e=r[r.length-1];return {erbij:+e[veld]-(+b[veld]),nu:+e[veld],sinds:b.snap_date}};
  if((m=/^muziek-spotify-grens-(.+)$/.exec(sl))){
    const t=SP.snaps&&SP.snaps.length?spCompute().list.find(x=>kSlug(tKey(x.title))===m[1]):null;
    if(t)items.push(`<b>${esc(t.title)}</b> · ${nf0.format(t.y12)} streams in 12 maanden${t.y12exact?"":" (schatting)"} · nog ${nf0.format(Math.max(0,1000-t.y12))} tot de grens`);
    uitleg="Spotify geeft geen dagcijfers: de stand komt uit je laatste Spotify-CSV.";
    return blok("Telt mee in de challenge: dit nummâh",items,uitleg)}
  if((m=/^muziek-sc-(momentum|nieuw)-(.+)$/.exec(sl))){
    const t=SCL.tracks.find(x=>kSlug(String(x.track_id))===m[2]);
    if(t){const g=groei(SCL.snaps,"track_id",t.track_id,"plays");
      items.push(`<a href="${esc(t.permalink_url||"#")}" target="_blank" rel="noopener"><b>${esc(t.title)}</b></a> op SoundCloud${g?` · <b>${kPlus(g.erbij)}</b> plays sinds ${dKort(g.sinds)} (nu ${nf0.format(g.nu)})`:""}`);
      const v=YT.videos.find(x=>tKey(x.title)===tKey(t.title)),gy=v?groei(YT.snaps,"video_id",v.video_id,"views"):null;
      if(gy)items.push(`<b>${esc(v.title)}</b> op YouTube · ${kPlus(gy.erbij)} weergaven sinds ${dKort(gy.sinds)}`)}
    const ig=IG.posts.filter(x=>x.gepost_om&&dagNL(x.gepost_om)>=van&&labelsVan(x,"muziek").some(l=>t&&tKey(l)===tKey(t.title)));
    ig.forEach(x=>items.push(`Insta-post <a href="${esc(x.permalink||"#")}" target="_blank" rel="noopener">${dKort(dagNL(x.gepost_om))} · ${esc(soortNaam(x))}</a> met dit nummâh eronder`));
    if(t&&!ig.length)uitleg="Nog geen Insta-post sinds de start met dit nummâh als muziek gekozen (kies het in de Insta-tab bij de post, dan telt hij hier mee).";
    const ex=kpExtra(p),nrs=(ex.nummers||[]).map(id=>SCL.tracks.find(x=>x.track_id===id)).filter(Boolean);
    nrs.forEach(x=>{const g=groei(SCL.snaps,"track_id",x.track_id,"plays");
      items.push(`<a href="${esc(x.permalink_url||"#")}" target="_blank" rel="noopener"><b>${esc(x.title)}</b></a> op SoundCloud <span class="chip kbron" style="--c:var(--hy)">zelf toegevoegd</span>${g?` · <b>${kPlus(g.erbij)}</b> plays sinds ${dKort(g.sinds)}`:""} <button class="lnk" type="button" data-kmnrmin="${esc(x.track_id)}" data-kpid="${p.id}">Haal eruit</button>`)});
    const rest=SCL.tracks.filter(x=>x!==t&&!nrs.includes(x)).sort((a,b)=>String(a.title).localeCompare(String(b.title)));
    const kies=!p.rapport&&rest.length?`<label class="kmkies">Nummâh toevoegen <select data-kmnr data-kpid="${p.id}"><option value="">kies een nummâh…</option>${rest.map(x=>`<option value="${esc(x.track_id)}">${esc(x.title)}</option>`).join("")}</select></label>`:"";
    return blok("Telt mee in de challenge",items,uitleg)+kies}
  if(sl==="muziek-top3"){const d=compute(),tt=[...d.tracks].sort((a,b)=>b.total-a.total).slice(0,3);
    return blok("Telt mee: je top 3 t.o.v. al je muziekgeld",tt.map(t=>`<b>${esc(t.track)}</b> · ${eur(t.total)}`),"Uit je SoundCloud-afrekeningen (CSV) en DJ·World; verandert pas bij een nieuwe upload.")}
  if(/^muziek-(abonnees|land|label-vs-sc|downloads|spotify-ontbreekt|te-boeken)/.test(sl)){
    const bron=/label|downloads|te-boeken/.test(sl)?"je DJ·World-overzicht (PDF)":"je SoundCloud-afrekeningen (CSV)";
    return blok(`Telt mee: alle nummâhs uit ${bron}`,[],"Deze cijfers veranderen alleen als je een nieuwe afrekening inlaadt.")}
  if(sl==="insta-label-muziek"){const x=IG.posts.filter(q=>q.gepost_om&&dagNL(q.gepost_om)>=van);
    return blok(`Telt mee: posts die je een muziek-keuze gaf (${IG.posts.filter(q=>labelsVan(q,"muziek").length).length} in totaal)`,
      x.slice(0,8).map(q=>`${dKort(dagNL(q.gepost_om))} · ${esc(soortNaam(q))} ${labelsVan(q,"muziek").length?`<span class="chip good">${esc(igMuziekNaam(labelsVan(q,"muziek")[0]))}</span>`:'<span class="chip mute">nog geen keuze</span>'}`),
      x.length?"Posts sinds de start; oudere posts labelen telt ook mee.":"Nog geen posts sinds de start; oudere posts labelen telt ook mee.")}
  if(sl==="insta-naar-plays"){const x=IG.posts.filter(q=>q.gepost_om&&dagNL(q.gepost_om)>=van&&labelsVan(q,"muziek").some(igIsNummer));
    return blok(`Telt mee: posts sinds ${dKort(van)} met een nummâh eronder`,x.map(q=>`<a href="${esc(q.permalink||"#")}" target="_blank" rel="noopener">${dKort(dagNL(q.gepost_om))} · ${esc(soortNaam(q))}</a> · ♪ ${esc(labelsVan(q,"muziek")[0])}`),x.length?"":"Nog geen. Kies in de Insta-tab welk nummâh eronder zat.")}
  if(sl==="insta-stories-afhaken"){const x=IG.stories.filter(q=>q.gepost_om&&dagNL(q.gepost_om)>=van);
    return blok(`Telt mee: je stories sinds ${dKort(van)} (${x.length})`,[],x.length?`Verdeeld over ${new Set(x.map(q=>dagNL(q.gepost_om))).size} dagen; dagen met 3 of meer stories tellen voor het afhaken.`:"Nog geen stories sinds de start.")}
  if(sl.startsWith("sneek-")){
    const br=(GC.bronnen||[]).filter(r=>String(r.dag).slice(0,10)>=van);
    const som=f=>br.filter(f).reduce((a,r)=>a+(+r.aantal||0),0);
    const gd=(GC.dag||[]).filter(r=>String(r.dag).slice(0,10)>=van),gs=f=>gd.filter(f).reduce((a,r)=>a+(+r.aantal||0),0);
    if(sl==="sneek-bio-link")return blok("Telt mee: bezoekâhs via je bio-link (?ref=bio)",[`<b>${nf0.format(som(r=>String(r.bron).toLowerCase()==="bio"))}</b> sinds ${dKort(van)}`],"");
    if(/^sneek-(story-links|beste-story)/.test(sl)){const per=new Map();br.filter(r=>/^story-/i.test(r.bron)).forEach(r=>{const k=String(r.bron).toLowerCase();per.set(k,(per.get(k)||0)+(+r.aantal||0))});
      return blok("Telt mee: je story-links (?ref=story-…) sinds de start",[...per].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<code>${esc(k)}</code> · <b>${nf0.format(n)}</b> bezoekâhs`),per.size?"":"Nog geen bezoek via een story-link sinds de start.")}
    if(sl==="sneek-insta-zakt")return blok("Telt mee: bezoekâhs via Insta en Facebook",[`<b>${nf0.format(som(r=>igBronGroep(r.bron)!=="rest"))}</b> sinds ${dKort(van)}`],"");
    const b=gs(r=>!r.event),pt=gs(r=>r.pad==="potje-gestart"),gg=gs(r=>r.pad==="score-gedeeld");
    return blok("Telt mee: alle Sneek-bezoekâhs sinds de start",[`${nf0.format(b)} bezoekâhs · ${nf0.format(pt)} speelden${b?` (${pct(Math.min(1,pt/b))})`:""} · ${nf0.format(gg)} scoâhs gedeeld`],"")}
  return "";
}

/* ---------- na het laden: oude stand overzetten, dagmeting, rapporten maken ---------- */
async function kansOudeStandOverzetten(){
  const oud=[...KANS.status.values()].filter(r=>r.status==="bezig"||r.status==="gedaan");if(!oud.length)return;
  const wissen=!(KP.lokaal&&!KANS.lokaal);   // pogingen nog nie in Supabase? dan de oude stand daar laten staan
  for(const r of oud){
    if(!KP.rijen.some(p=>p.sleutel===r.sleutel)){
      const L=kansDagen(r.sleutel),t=r.gezet_om||new Date().toISOString(),b=r.sleutel.split("-")[0];
      await kpNieuw({sleutel:r.sleutel,bron:BRON[b]?b:"insta",kop:esc(r.tekst_toen||r.sleutel),looptijd_dagen:L,gestart_om:t,
        rapport_op:new Date(Date.parse(t)+L*864e5).toISOString(),gestopt_om:r.status==="gedaan"?t:null,afloop:r.status==="gedaan"?"gedaan":null,
        waarde_start:r.waarde_toen!=null?+r.waarde_toen:null});
    }
    if(!wissen)continue;
    KANS.status.delete(r.sleutel);
    if(KANS.lokaal)store.set("hc_kansen",JSON.stringify([...KANS.status.values()]));
    else await sb.from("kans_status").delete().eq("sleutel",r.sleutel);
  }
}
async function kansNaLaden(){
  try{
    await kansOudeStandOverzetten();
    const alle=kansenAlle();kansLaatste=alle;
    const vandaag=vandaagAms(),meet=[];
    for(const p of KP.rijen.filter(p=>!p.rapport)){
      const k=alle.find(x=>x.id===p.sleutel);if(!k||!k.meet)continue;
      meet.push({poging_id:p.id,dag:vandaag,waarde:+k.meet.waarde});
      if(!p.meet_naam)await kpWijzig(p,{meet_naam:k.meet.naam,meet_beter:k.meet.beter,meet_fmt:k.meet.fmt===eur?"eur":null,waarde_start:p.waarde_start!=null?p.waarde_start:+k.meet.waarde});
    }
    await kpMeet(meet);
    if(KM_LAADT)await KM_LAADT;KM_CURVE_CACHE=null;
    for(const p of KP.rijen.filter(p=>!p.gestopt_om&&kmPlan(p.sleutel))){   // meetplan: deadline voorbij → taak sluit vanzelf (doel gehaald = gedaan, anders gestopt)
      const dl=kmDeadline(p);if(!dl||Date.parse(dl)>Date.now())continue;
      const st=kmStand(p),a=st&&st.doenAantal,n=st?st.taak.length:0;
      await kpWijzig(p,{gestopt_om:dl,afloop:!a||n>=a?"gedaan":"gestopt"});
    }
    for(const p of KP.rijen.filter(p=>!p.rapport&&p.gestopt_om&&kmPlan(p.sleutel))){   // meetplan: rapportdatum schuift mee met je posts
      const st=kmStand(p);if(st&&st.rapportOp&&Math.abs(Date.parse(st.rapportOp)-Date.parse(p.rapport_op))>6e4)await kpWijzig(p,{rapport_op:st.rapportOp});
    }
    for(const p of KP.rijen.filter(p=>!p.rapport&&Date.parse(p.rapport_op)<=Date.now()&&(p.gestopt_om||!kmPlan(p.sleutel))))
      await kpWijzig(p,{rapport:kansRapportMaak(p),rapport_klaar_om:new Date().toISOString()});
  }catch(e){console.warn("Kansâh na laden lukte nie",e)}
  kansBadge();
}

/* ---------- knoppen ---------- */
// 1 challenge per onderdeel tegelijk in de "doen"-fase (meten van een afgemelde mag doorlopen)
const kBezigBron=bron=>KP.rijen.find(p=>p.bron===bron&&!p.gestopt_om)||null;
async function kansStart(k){
  const al=kBezigBron(k.bron);if(al){showMsg(`Je bent al bezig met een ${BRON[k.bron][0]}-challenge. Meld die eerst af.`);return}
  const nu=new Date();
  const p=await kpNieuw({sleutel:k.id,bron:k.bron,kop:k.h,actie:k.a,big:k.big,looptijd_dagen:k.dagen,gestart_om:nu.toISOString(),
    rapport_op:new Date(nu.getTime()+k.dagen*864e5).toISOString(),
    meet_naam:k.meet?k.meet.naam:null,meet_beter:k.meet?k.meet.beter:null,meet_fmt:k.meet&&k.meet.fmt===eur?"eur":null,waarde_start:k.meet?+k.meet.waarde:null});
  if(k.meet)await kpMeet([{poging_id:p.id,dag:vandaagAms(),waarde:+k.meet.waarde}]);
  if(k.verborgen)await kansVerberg(k.id,false);
}

/* ---------- pagina Kansâh ---------- */
let kansLaatste=[];
function renderKansen(){
  if(!$("kansLijst"))return;
  document.querySelectorAll("#kansTabs [data-kt]").forEach(b=>b.setAttribute("aria-selected",b.dataset.kt===kansTab));
  $("kansNu").hidden=kansTab!=="nu";$("kansGesch").hidden=kansTab!=="geschiedenis";
  kansBadge();
  if(kansTab==="geschiedenis"){renderKansGeschiedenis();return}
  const alle=kansenAlle();kansLaatste=alle;
  const g=kansGroepen(alle,"alles");
  const telt=b=>kansGroepen(alle,b).open.length+kansGroepen(alle,b).bezig.length;
  document.querySelectorAll("#kansFilter button").forEach(b=>{b.setAttribute("aria-pressed",b.dataset.v===kansFilter);b.querySelector("span").textContent=telt(b.dataset.v)});
  const top=[...g.bezig.filter(x=>x.k&&!x.k.stil).map(x=>x.k),...g.open].sort((a,b)=>b.score-a.score).slice(0,3);
  $("kansTop").innerHTML=top.length?top.map((k,i)=>`<li><b>${i+1}.</b> ${k.a.replace(/<button[^>]*>.*?<\/button>/g,"").replace(/^<b>Doe:<\/b>\s*/,"")} <span class="sub">(${BRON[k.bron][0]}${k.bezig?", mee bezig":""})</span></li>`).join(""):"<li>Alles gedaan. Tijd voor een biertje op de Pier.</li>";
  const zicht=alle.filter(k=>!k.stil).length;
  $("kansSub").textContent=`${zicht} kansen gevonden in je muziek, Insta en Sneek, grootste eerst. Ze komen en gaan vanzelf met de cijfâhs.`+
    (KP.lokaal?" (Je keuzes worden nu alleen in deze browser bewaard: draai 20_kansen_geschiedenis.sql om ze overal te zien.)":"");
  $("kansLijst").innerHTML=kansNuHTML(alle,kansFilter);
}
// muziek-tab "Waâh zit nog wat?": dezelfde motor, alleen muziek (volgt de filters van de muziek-tab)
function renderInsights(d){
  const l=kansenAlle(d);kansLaatste=l;
  const g=kansGroepen(l,"muziek");
  $("insights").innerHTML=g.open.length+g.bezig.length+g.wacht.length?`<p class="sub" style="margin:0 0 12px">Grootste kans eerst. Alle kansen (ook Insta en Sneek) en de geschiedenis staan onder <button class="btn" type="button" data-ga="kansen">Kansâh</button></p>`+kansNuHTML(l,"muziek")
    :'<p class="sub">Nog niks te zien. Laad eerst je SoundCloud-CSV in.</p>';
}

/* ---------- tab Geschiedenis ---------- */
const kRapDatumVast=p=>!!p.gestopt_om||!kmPlan(p.sleutel);   // taak met meetplan die nog "doen" is: rapportdatum volgt pas na afmelden
function khStatusVan(p){return p.rapport?"rapport":p.gestopt_om?"wacht":"loopt"}
function renderKansGeschiedenis(){
  const el=$("kansGesch");if(!el)return;
  const alle=KP.rijen.filter(p=>khBron==="alles"||p.bron===khBron);
  const metRap=alle.filter(p=>p.rapport),bekend=metRap.filter(p=>p.rapport.oordeel!=="onbekend");
  const n=o=>bekend.filter(p=>p.rapport.oordeel===o).length;
  const loopt=alle.filter(p=>!p.rapport),volgende=loopt.filter(kRapDatumVast).map(p=>p.rapport_op).sort()[0];
  const af=alle.filter(p=>p.gestopt_om),gem=af.length?af.reduce((s,p)=>s+Math.max(0,Date.parse(p.gestopt_om)-Date.parse(p.gestart_om)),0)/af.length/864e5:null;
  const nieuw=metRap.filter(p=>!p.gelezen_om).length;
  const eerste=alle.map(p=>p.gestart_om).sort()[0];
  const tegels=[
    ["Gestart",nf0.format(alle.length),eerste?"sinds "+kD(eerste):"nog niks gestart"],
    ["Loopt nu",nf0.format(loopt.length),volgende?"volgende rapport "+kD(volgende):"geen lopende kansen"],
    ["Rapporten",nf0.format(metRap.length),metRap.length?(nieuw?`<b class="up">${nieuw} nieuw</b>`:"allemaal gelezen"):"nog geen"],
    ["Werkte",bekend.length?`${n("werkte")} van ${bekend.length}`:"—",bekend.length?`${pct(n("werkte")/bekend.length)}${n("deels")?` · ${n("deels")} deels`:""}${n("slechter")?` · ${n("slechter")} achteruit`:""}`:"nog geen rapport met genoeg data"],
    ["Afgemeld",`${alle.filter(p=>p.afloop==="gedaan").length} · ${alle.filter(p=>p.afloop==="gestopt").length}`,"gedaan · gestopt"+(gem!=null?(gem<1?" · gemiddeld binnen een dag":` · gemiddeld na ${nf1k.format(gem)} dagen`):"")]];
  // per onderdeel (alleen bij Alles)
  const perBron=khBron!=="alles"?"":Object.keys(BRON).map(b=>{const x=KP.rijen.filter(p=>p.bron===b),r=x.filter(p=>p.rapport&&p.rapport.oordeel!=="onbekend");
    return x.length?`<tr><td>${bronChip(b)}</td><td class="n">${x.length}</td><td class="n">${x.filter(p=>!p.rapport).length}</td><td class="n">${r.length?`${r.filter(p=>p.rapport.oordeel==="werkte").length} van ${r.length}`:"—"}</td></tr>`:""}).join("");
  const lijst=alle.filter(p=>khStatus==="alles"||(khStatus==="loopt"?!p.rapport:khStatus==="rapport"?!!p.rapport:false))
    .sort((a,b)=>{const ra=a.rapport&&!a.gelezen_om?0:a.rapport?2:1,rb=b.rapport&&!b.gelezen_om?0:b.rapport?2:1;
      if(ra!==rb)return ra-rb;return ra===1?(a.rapport_op<b.rapport_op?-1:1):(a.rapport_op<b.rapport_op?1:-1)});
  const telS=s=>alle.filter(p=>s==="alles"||(s==="loopt"?!p.rapport:!!p.rapport)).length;
  el.innerHTML=`
  <div class="card">
    <div class="cardhead"><div><h2>Hoe deden je kansâh het?</h2><p class="sub">Elke keer dat je op <b>Mee bezig</b> klikt, begint een poging met een vaste looptijd. Daarna krijg je een rapport: werkte het, vergeleken met even lang ervóór?</p></div>
      <div class="seg" id="khBron" role="group" aria-label="Onderdeel">
        ${[["alles","Alles"],["muziek",'<i class="dot sc"></i>Muziek'],["insta",'<i class="dot hy"></i>Insta'],["sneek",'<i class="dot groen"></i>Sneek']].map(([v,t])=>`<button type="button" data-v="${v}" aria-pressed="${khBron===v}">${t}</button>`).join("")}
      </div></div>
    <div class="ytstats">${tegels.map(([k,v,s])=>`<div class="ytstat"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join("")}</div>
    ${perBron?`<div class="tablewrap khbron"><table class="ktab"><thead><tr><th>Onderdeel</th><th class="n">Gestart</th><th class="n">Loopt</th><th class="n">Werkte</th></tr></thead><tbody>${perBron}</tbody></table></div>`:""}
  </div>
  <div class="card">
    <div class="cardhead"><div><h2>Allâh pogingen</h2><p class="sub">Nieuwe rapporten bovenaan, dan wat nog loopt, dan oudere rapporten. Tik op een regel voor het hele rapport.</p></div>
      <div class="seg" id="khStatus" role="group" aria-label="Welke">
        ${[["alles","Alles"],["loopt","Loopt nog"],["rapport","Met rapport"]].map(([v,t])=>`<button type="button" data-v="${v}" aria-pressed="${khStatus===v}">${t} <span>${telS(v)}</span></button>`).join("")}
      </div></div>
    <div class="khlijst">${lijst.map(khRij).join("")||`<p class="sub">${KP.rijen.length?"Niks in deze selectie.":"Nog geen geschiedenis. Zet bij <b>Nu</b> een kans op <b>Mee bezig</b>, dan begint het hier."}</p>`}</div>
    ${KP.lokaal?'<p class="sub">Let op: de geschiedenis staat nu alleen in deze browser. Draai <code>20_kansen_geschiedenis.sql</code> om hem in Supabase te bewaren.</p>':""}
  </div>`;
}
function khRij(p){
  const s=khStatusVan(p),O=p.rapport?(KANS_OORDEEL[p.rapport.oordeel]||KANS_OORDEEL.onbekend):null;
  const chip=O?`<span class="chip ${O.c}">${O.t}</span>`:s==="wacht"?`<span class="chip mute">${p.afloop==="gestopt"?"gestopt":"gedaan ✓"} · rapport volgt</span>`:'<span class="chip warn">loopt</span>';
  const m=p.rapport&&p.rapport.meet,f=kFmt(p);
  const meet=m&&m.start!=null&&m.eind!=null?`${esc(m.naam)}: ${f(m.start)} → <b>${f(m.eind)}</b>`:!p.rapport&&p.meet_naam&&p.waarde_start!=null&&kLaatste(p)!=null?`${esc(p.meet_naam)}: ${f(+p.waarde_start)} → <b>${f(kLaatste(p))}</b>`:"";
  const plan=kmPlan(p.sleutel);
  const wanneer=`${kD(p.gestart_om)}${p.gestopt_om?` → ${kD(p.gestopt_om)}`:""}`+(plan?"":` · ${p.looptijd_dagen} dagen`)+(p.rapport?"":plan&&!p.gestopt_om?" · doen":` · rapport ${kD(p.rapport_op)}`);
  const lijn=p.rapport?(p.rapport.meet&&p.rapport.meet.reeks):[...(KP.met.get(p.id)||new Map())].sort((a,b)=>a[0]<b[0]?-1:1);
  return `<details class="khrij${p.rapport&&!p.gelezen_om?" nieuw":""}" data-kh="${p.id}"${khOpen==p.id?" open":""}>
    <summary><span class="khkop">${bronChip(p.bron)}${chip}${p.rapport&&!p.gelezen_om?'<span class="chip kbron" style="--c:var(--hy)">nieuw</span>':""}</span>
      <span class="khtitel">${p.big?`<b class="khbig">${p.big}</b> `:""}${p.kop||esc(p.sleutel)}</span>
      <span class="khmeta">${wanneer}${meet?" · "+meet:""}</span></summary>
    <div class="khbody">${p.rapport?kansRapportHTML(p):`${kLoop(p)}${kmPlan(p.sleutel)?kmHTML(kmStand(p)):kTeltMeeHTML(p)}${kMeetRegel(p)}${kSpark(lijn)}${p.actie?`<div class="act">${p.actie}</div>`:""}`}
      <p class="khwis"><button class="lnk" type="button" data-khwis="${p.id}">Wis uit geschiedenis</button></p></div>
  </details>`;
}

/* ---------- melding op Ovâhzicht, badge op Kansâh en de pop-up ---------- */
function kansNieuweRapporten(){return KP.rijen.filter(p=>p.rapport&&!p.gelezen_om).sort((a,b)=>a.rapport_op<b.rapport_op?-1:1)}
function kansBadge(){
  const n=kansNieuweRapporten().length;
  [['nav.hoofdmenu button[data-s="kansen"]',"rap"],['#kansTabs [data-kt="geschiedenis"]',"rap"]].forEach(([q,c])=>{
    const b=document.querySelector(q);if(!b)return;let s=b.querySelector(".badge");
    if(!n){if(s)s.remove();return}
    if(!s){s=document.createElement("span");s.className="badge "+c;b.appendChild(s)}
    s.textContent=n;s.title=n===1?"1 nieuw kans-rapport":n+" nieuwe kans-rapporten"});
}
// taken met meetplan die na afmelden nog meten (voor de voortgang-pop-up en de melding)
function kansMetingen(){return KP.rijen.filter(p=>p.gestopt_om&&!p.rapport&&kmPlan(p.sleutel)).sort((a,b)=>a.rapport_op<b.rapport_op?-1:1)}
// Bovenaan Ovâhzicht (sinds 03-10, wens Marnix: Kansâh-tegel weg, alleen boven de lopende kansen):
// alle pogingen zonder rapport, zowel "mee bezig" (doen-fase) als "meet nog" (afgemeld, rapport volgt).
function kansMetingHTML(){
  const l=KP.rijen.filter(p=>!p.rapport).sort((a,b)=>(!!a.gestopt_om-!!b.gestopt_om)||(a.rapport_op<b.rapport_op?-1:1));
  if(!l.length)return "";
  const regel=p=>{
    if(!p.gestopt_om)return `${bronChip(p.bron)} ${esc(kTekst(p.kop)).slice(0,80)} · <b>mee bezig</b>${kRapDatumVast(p)?` · rapport ${kD(p.rapport_op)}`:` sinds ${kD(p.gestart_om)}`}`;
    const st=kmPlan(p.sleutel)?kmStand(p):null,E=st&&st.E;
    return `${bronChip(p.bron)} ${esc(kTekst(p.kop)).slice(0,80)} · meet nog · rapport ${kD(p.rapport_op)}${E!=null?` · nu <b>${kX(E)}</b> je normaal`:""}`;
  };
  return `<div class="alarm meting" role="status">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">◔</span><h2>${l.length===1?"Lopende kans":l.length+" lopende kansâh"}</h2></div>
    <p>${l.slice(0,4).map(regel).join("<br>")}${l.length>4?`<br>en nog ${l.length-4}`:""}</p>
    <p>${kansMetingen().length?'<button class="btn" type="button" data-kansvoort>Bekijk de voortgang</button> ':""}<button class="btn" type="button" data-ga="kansen">Kèk bè Kansâh</button></p>
  </div>`;
}
function kansMeldingHTML(){
  const l=kansNieuweRapporten();if(!l.length)return kansMetingHTML();
  return `<div class="alarm rapport" role="status">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">★</span><h2>${l.length===1?"Je kans-rapport is klaar":l.length+" kans-rapporten zijn klaar"}</h2></div>
    <p>${l.slice(0,3).map(p=>{const O=KANS_OORDEEL[p.rapport.oordeel]||KANS_OORDEEL.onbekend;return `${bronChip(p.bron)} ${esc(kTekst(p.kop)).slice(0,90)} <span class="chip ${O.c}">${O.t}</span>`}).join("<br>")}${l.length>3?`<br>en nog ${l.length-3}`:""}</p>
    <p><button class="btn yellow" type="button" data-kansrap>Bekijk ${l.length===1?"het rapport":"de rapporten"}</button></p>
  </div>`+kansMetingHTML();
}
// pop-up "Meting loopt": voortgang van alle taken die nog meten
let KVOORT=false;
function kansVoortOpen(){
  const l=kansMetingen();if(!l.length||!$("kansPop"))return;
  KVOORT=true;KPOP=-1;$("kansPop").hidden=false;document.body.classList.add("popopen");
  $("kansPopTitel").textContent=l.length===1?"Meting loopt":l.length+" metingen lopen";
  $("kansPopSub").textContent="Zo doen de posts van je taak het tot nu toe";
  $("kansPopInhoud").innerHTML=l.map(p=>`<div class="krap kvoortblok"><div class="kkop">${bronChip(p.bron)}</div><h3>${p.kop||esc(p.sleutel)}</h3>${kmLoop(p)}${kmHTML(kmStand(p))}</div>`).join("");
  $("kansPopGelezen").hidden=true;$("kansPopLater").textContent="Sluite";
  $("kansPopDicht").focus({preventScroll:true});
}
let KPOP=null;
function kansPopOpen(id){
  const p=id!=null?KP.rijen.find(x=>x.id==id):kansNieuweRapporten()[0];if(!p||!p.rapport||!$("kansPop"))return;
  KPOP=p.id;$("kansPop").hidden=false;document.body.classList.add("popopen");kansPopTeken();$("kansPopDicht").focus({preventScroll:true});
}
function kansPopTeken(){
  const p=KP.rijen.find(x=>x.id==KPOP);if(!p)return kansPopDicht();
  const l=kansNieuweRapporten(),i=l.indexOf(p);
  $("kansPopTitel").textContent=p.gelezen_om?"Kans-rapport":"Rapport klaar!";
  $("kansPopSub").textContent=`${BRON[p.bron][0]} · ${p.looptijd_dagen} dagen na Mee bezig`+(i>=0&&l.length>1?` · ${i+1} van ${l.length} nieuw`:"");
  $("kansPopInhoud").innerHTML=kansRapportHTML(p);
  $("kansPopGelezen").hidden=!!p.gelezen_om;
  $("kansPopGelezen").textContent=l.filter(x=>x!==p).length?"Gelezen ✓ · volgende":"Gelezen ✓";
  $("kansPopLater").textContent=p.gelezen_om?"Sluite":"Later";
}
function kansPopDicht(){if(KPOP==null)return;KPOP=null;KVOORT=false;$("kansPop").hidden=true;document.body.classList.remove("popopen");kansNaWijzig()}
async function kansGelezen(p){if(!p||p.gelezen_om)return;try{await kpWijzig(p,{gelezen_om:new Date().toISOString()})}catch(e){showMsg("Bewaren lukte nie: "+(e.message||e))}}
// bij het openen van de app: 1x per sessie de pop-up (na Ververse nie nog een keer)
// eerst een nieuw rapport (1x per sessie); anders de voortgang van lopende metingen (1x per dag)
function kansPopBijStart(){
  if(sectie!=="ovahzicht")return;
  if(kansNieuweRapporten().length){
    try{if(sessionStorage.getItem("hc_kans_pop"))return;sessionStorage.setItem("hc_kans_pop","1")}catch(e){}
    kansPopOpen();return}
  if(kansMetingen().length){const d=vandaagAms();if(store.get("hc_kans_voort")===d)return;store.set("hc_kans_voort",d);kansVoortOpen()}
}
function kansNaWijzig(){kansBadge();if(sectie==="kansen")renderKansen();else if(sectie==="ovahzicht")renderOvahzicht();else if(sectie==="muziek")render()}

document.addEventListener("click",async e=>{
  const t=e.target;if(!t.closest)return;
  const kt=t.closest("#kansTabs [data-kt]");if(kt){kansTab=kt.dataset.kt;renderKansen();return}
  const f=t.closest("#kansFilter button");if(f){kansFilter=f.dataset.v;renderKansen();return}
  const hb=t.closest("#khBron button");if(hb){khBron=hb.dataset.v;renderKansGeschiedenis();return}
  const hs=t.closest("#khStatus button");if(hs){khStatus=hs.dataset.v;renderKansGeschiedenis();return}
  if(t.closest("#kToonVerborgen")){kansToonVerborgen=!kansToonVerborgen;sectie==="kansen"?renderKansen():render();return}
  // pop-up
  if(t.closest("[data-kansrap]")){kansPopOpen();return}
  if(t.closest("[data-kansvoort]")){kansVoortOpen();return}
  if(KPOP!=null){
    if(t.closest("#kansPopGelezen")){const p=KP.rijen.find(x=>x.id==KPOP);await kansGelezen(p);const v=kansNieuweRapporten()[0];if(v){KPOP=v.id;kansPopTeken()}else kansPopDicht();return}
    if(t.closest("#kansPopDicht")||t.closest("#kansPopLater")||t.id==="kansPop"){kansPopDicht();return}
  }
  // naar de geschiedenis (rapport openklappen)
  const ho=t.closest("[data-khopen]");if(ho){const id=ho.dataset.khopen;if(KPOP!=null)kansPopDicht();khOpen=id;khStatus="alles";khBron="alles";kansTab="geschiedenis";setSectie("kansen");
    const el=document.querySelector(`[data-kh="${id}"]`);if(el)el.scrollIntoView({block:"start"});return}
  if(t.closest("[data-kansgesch]")){kansTab="geschiedenis";setSectie("kansen");return}
  const w=t.closest("[data-khwis]");if(w){
    if(w.dataset.zeker!=="1"){w.dataset.zeker="1";w.textContent="Zeker? Tik nog een keer om te wissen";return}
    const p=KP.rijen.find(x=>x.id==w.dataset.khwis);if(p)try{await kpWis(p)}catch(x){showMsg("Wissen lukte nie: "+(x.message||x))}
    kansNaWijzig();return}
  // zelf posts/nummâhs toevoegen of eruit halen
  const km=t.closest("[data-kmplus],[data-kmmin],[data-kmnrmin]");
  if(km){const p=KP.rijen.find(x=>x.id==km.dataset.kpid);if(p)await kmExtraWijzig(p,km.dataset.kmplus?{plus:km.dataset.kmplus}:km.dataset.kmmin?{min:km.dataset.kmmin}:{nrmin:km.dataset.kmnrmin});return}
  // knoppen op de kaarten
  const b=t.closest("[data-kz]");if(!b)return;
  b.disabled=true;
  try{
    const kp=b.closest("[data-kp]");
    if(kp){const p=KP.rijen.find(x=>x.id==kp.dataset.kp);if(!p)return;
      if(b.dataset.kz==="oeps")await kpWis(p);
      else{await kpWijzig(p,{gestopt_om:new Date().toISOString(),afloop:b.dataset.kz});
        if(kmPlan(p.sleutel)){const st=kmStand(p);if(st&&st.rapportOp)await kpWijzig(p,{rapport_op:st.rapportOp})}}   // meetplan: rapportdatum = als je laatste post z'n eindstand heeft
    }else{
      const id=b.closest("[data-kans]").dataset.kans,k=kansLaatste.find(x=>x.id===id);if(!k)return;
      if(b.dataset.kz==="start")await kansStart(k);
      else if(b.dataset.kz==="verborgen")await kansVerberg(k.id,!k.verborgen);
    }
  }catch(x){showMsg("Bewaren lukte nie: "+(x.message||x))}
  kansNaWijzig();
});
document.addEventListener("change",async e=>{
  const sel=e.target.closest&&e.target.closest("select[data-kmkies],select[data-kmnr]");if(!sel||!sel.value)return;
  const p=KP.rijen.find(x=>x.id==sel.dataset.kpid);if(!p)return;
  await kmExtraWijzig(p,sel.matches("[data-kmkies]")?{plus:sel.value}:{nr:sel.value});
});
// plus/min/nummer verwerken, rapportdatum bijwerken (meetplan) en alles opnieuw tekenen (ook de pop-up)
async function kmExtraWijzig(p,w){
  const ex=JSON.parse(JSON.stringify(kpExtra(p)));ex.plus=ex.plus||[];ex.min=ex.min||[];ex.nummers=ex.nummers||[];
  const weg=(a,v)=>a.filter(x=>x!==v);
  if(w.plus){ex.min=weg(ex.min,w.plus);const st=kmStand({...p,extra:{...ex,plus:[]}});if(!(st&&st.taak.some(r=>r.id===w.plus))&&!ex.plus.includes(w.plus))ex.plus.push(w.plus)}
  if(w.min){if(ex.plus.includes(w.min))ex.plus=weg(ex.plus,w.min);else if(!ex.min.includes(w.min))ex.min.push(w.min)}
  if(w.nr&&!ex.nummers.includes(w.nr))ex.nummers.push(w.nr);
  if(w.nrmin)ex.nummers=weg(ex.nummers,w.nrmin);
  await kpExtraZet(p,ex);
  if(p.gestopt_om&&!p.rapport&&kmPlan(p.sleutel)){const st=kmStand(p);if(st&&st.rapportOp&&st.rapportOp!==p.rapport_op)try{await kpWijzig(p,{rapport_op:st.rapportOp})}catch(x){}}
  if(KVOORT)kansVoortOpen();
  kansNaWijzig();
}
// rapport openklappen in de geschiedenis = gelezen
document.addEventListener("toggle",async e=>{
  const d=e.target;if(!d.matches||!d.matches("details[data-kh]"))return;
  if(d.open)khOpen=d.dataset.kh;else if(khOpen==d.dataset.kh)khOpen=null;
  const p=KP.rijen.find(x=>x.id==d.dataset.kh);
  if(d.open&&p&&p.rapport&&!p.gelezen_om){await kansGelezen(p);kansBadge();d.classList.remove("nieuw");const c=d.querySelector("summary .chip[style*='--hy']");if(c)c.remove()}
},true);
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&KPOP!=null)kansPopDicht();
  const r=(e.key==="Enter"||e.key===" ")&&e.target.closest&&e.target.closest("[data-kansgesch]");
  if(r){e.preventDefault();kansTab="geschiedenis";setSectie("kansen")}
});
