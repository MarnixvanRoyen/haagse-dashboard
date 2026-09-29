// kansen.js — "Kansâh": waar zit ruimte om te groeien? Muziek, Insta en Sneek samen.
// Elke regel hieronder bekijkt de cijfers en maakt ALLEEN een kaart als de data er aanleiding voor geeft.
// Een kaart: {id, bron, big, h (kop), p (uitleg), a (wat kun je doen), impact 0-100, n (aantal metingen, voor zekerheid),
//             meet:{naam, waarde, fmt, beter:"hoger"|"lager"} (voor voortgang), trend (tekst: vs vorige week)}
// Status (bezig / gedaan / nie voor mij) staat in Supabase-tabel kans_status (10_kansen.sql), zodat laptop en telefoon hetzelfde zien.

let KANS={status:new Map(),err:null,lokaal:false};
let kansFilter="alles", kansToonVerborgen=false;

async function loadKansen(){
  try{
    const {data,error}=await sb.from("kans_status").select("sleutel,status,waarde_toen,tekst_toen,gezet_om");
    if(error)throw error;
    KANS={status:new Map(data.map(r=>[r.sleutel,r])),err:null,lokaal:false};
  }catch(e){   // tabel bestaat nog niet: tijdelijk in deze browser bewaren
    let lok=[];try{lok=JSON.parse(store.get("hc_kansen")||"[]")}catch(x){}
    KANS={status:new Map(lok.map(r=>[r.sleutel,r])),err:e.message||String(e),lokaal:true};
  }
}
async function kansZet(k,status){
  const oud=KANS.status.get(k.id);
  const rij={sleutel:k.id,status,waarde_toen:oud&&oud.waarde_toen!=null?oud.waarde_toen:(k.meet?k.meet.waarde:null),
    tekst_toen:(oud&&oud.tekst_toen)||k.h.replace(/<[^>]+>/g,"").slice(0,200),gezet_om:(oud&&oud.gezet_om)||new Date().toISOString()};
  if(!status){KANS.status.delete(k.id)}else KANS.status.set(k.id,rij);
  if(KANS.lokaal){store.set("hc_kansen",JSON.stringify([...KANS.status.values()]));return}
  const {error}=status?await sb.from("kans_status").upsert(rij):await sb.from("kans_status").delete().eq("sleutel",k.id);
  if(error)showMsg("Bewaren lukte nie: "+error.message);
}

/* ---------- hulpjes ---------- */
const kMed=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
const nf1k=new Intl.NumberFormat("nl-NL",{maximumFractionDigits:1});
const kPlus=v=>(v>0?"+":v<0?"−":"")+nf0.format(Math.abs(v));
function kVs(nu,voor,eenheid=""){if(nu==null||voor==null)return null;const d=voor?nu/voor-1:null;
  return `${nf0.format(nu)}${eenheid} deze week, vorige week ${nf0.format(voor)}${eenheid}`+(d==null?"":d>0.05?` <span class="up">↑ ${pct(d)}</span>`:d<-0.05?` <span class="down">↓ ${pct(-d)}</span>`:" (gelijk)")}

/* ---------- MUZIEK ---------- */
function kansenMuziek(d){
  const out=[];
  // 1. Spotify 1.000-grens: welk nummer is het dichtst bij geld?
  if(SP.snaps&&SP.snaps.length){const s=spCompute();
    const kand=s.list.filter(t=>t.below).sort((a,b)=>b.y12-a.y12);
    const t=kand[0];
    if(t){const nog=1000-t.y12,mnd=t.perMonth>0?nog/t.perMonth:null;
      out.push({id:"muziek-spotify-grens-"+tKey(t.title),bron:"muziek",impact:nog<300?75:nog<600?60:45,n:s.dates.length>1?10:5,
        big:"nog "+nf0.format(nog),h:`streams tot <b>${esc(t.title)}</b> Spotify-geld oplevert`,
        p:`Spotify betaalt alleen voor nummers met minstens 1.000 streams in 12 maanden. ${esc(t.title)} staat op ${nf0.format(t.y12)}${t.y12exact?"":" (schatting)"}.`+
          (mnd!=null?` In dit tempo (${nf0.format(t.perMonth)} per maand) duurt dat nog ${mnd>24?"meer dan 2 jaar":nf0.format(Math.ceil(mnd))+" maanden"}.`:"")+
          (kand[1]?` Daarna: ${esc(kand[1].title)} (${nf0.format(kand[1].y12)}).`:""),
        a:`<b>Doe:</b> promoot 4 weken alleen ${esc(t.title)}: zet hem onder je Insta-posts, in je story met Spotify-link en vraag vrienden hem in een playlist te zetten. Eén nummer over de grens levert meer op dan tien nummers eronder.`,
        meet:{naam:"streams in 12 mnd",waarde:t.y12,beter:"hoger"}})}}
  // 2. SoundCloud: wie groeit er nu het hardst? (momentum)
  if(SCL.snaps&&SCL.snaps.length){const s=sclCompute();
    if(s.multiDay){const g=[...s.list].filter(t=>t.grow>0).sort((a,b)=>b.grow-a.grow);const mg=kMed(s.list.map(t=>t.grow||0));
      const t=g[0];
      if(t&&t.grow>=5&&t.grow>=2*Math.max(1,mg)){
        out.push({id:"muziek-sc-momentum-"+t.id,bron:"muziek",impact:55,n:Math.min(10,s.dates.length),
          big:"+"+nf0.format(t.grow),h:`plays in 7 dagen voor <b>${esc(t.title)}</b>, je snelste groeiâh op SoundCloud`,
          p:`Het middelste nummer kreeg er ${nf0.format(mg||0)} bij. ${g[1]?`Daarna: ${esc(g[1].title)} (+${nf0.format(g[1].grow)}).`:""} Wat al loopt, is het makkelijkst verder te duwen.`,
          a:`<b>Doe:</b> gebruik ${esc(t.title)} deze week onder een Insta-post of reel en zet in je story een link naar <a href="${esc(t.url||"#")}" target="_blank" rel="noopener">SoundCloud</a>. Kies in de Insta-tab bij die post het nummer, dan zie je hier het effect.`,
          meet:{naam:"plays erbij per week",waarde:t.grow,beter:"hoger"}})}
      // 3. nieuwe release die beter loopt dan normaal
      const perDag=s.list.filter(t=>t.perDay!=null&&t.age>45).map(t=>t.perDay),norm=kMed(perDag);
      const nieuw=s.list.filter(t=>t.age!=null&&t.age<=45&&t.perDay!=null&&norm&&t.perDay>=1.5*norm).sort((a,b)=>b.perDay-a.perDay)[0];
      if(nieuw)out.push({id:"muziek-sc-nieuw-"+nieuw.id,bron:"muziek",impact:45,n:8,
        big:nf1k.format(nieuw.perDay/norm)+"×",h:`zo snel als normaal: <b>${esc(nieuw.title)}</b> (${nieuw.age} dagen oud)`,
        p:`${nf0.format(nieuw.plays)} plays, ${nf0.format(nieuw.perDay)} per dag. Je oudere nummers doen gemiddeld ${nf0.format(norm)} per dag.`,
        a:`<b>Doe:</b> dit is je kans op een nieuwe toppâh. Zet hem op Spotify-playlists die je kent, maak er een reel mee en overweeg een extended mix voor DJ's.`,
        meet:{naam:"plays per dag",waarde:Math.round(nieuw.perDay),beter:"hoger"}})}}
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
    if(sh>=0.5)out.push({id:"muziek-top3",bron:"muziek",impact:30,n:10,big:pct(sh),h:"van al je muziekgeld komt uit je top 3",
      p:`${tt.slice(0,3).map(t=>esc(t.track)).join(", ")}. De andere ${tt.length-3} nummers delen de rest.`,
      a:"<b>Doe:</b> zoek wat deze drie gemeen hebben (tempo, sfeer, releasemaand, promotie) en maak daar je volgende release op. Oude toppâhs opnieuw promoten kost weinig.",
      meet:{naam:"% uit top 3",waarde:Math.round(sh*100),beter:"lager"}})}
  // 6. landen: waar betaalt een stream het meest?
  const lnd=d.countries.filter(c=>c.units>=100&&c.c);
  if(lnd.length>=3){const gem=d.countries.reduce((a,c)=>a+c.v,0)/Math.max(1,d.countries.reduce((a,c)=>a+c.units,0))*1000;
    const beste=lnd.map(c=>({...c,per:c.v/c.units*1000})).filter(c=>c.c!==d.countries[0].c).sort((a,b)=>b.per-a.per)[0];
    if(beste&&gem&&beste.per>=1.3*gem)out.push({id:"muziek-land-"+beste.c,bron:"muziek",impact:25,n:beste.units>=500?10:6,
      big:eur(beste.per),h:`per 1.000 streams in ${esc(cName(beste.c))}, ${nf1k.format(beste.per/gem)}× je gemiddelde`,
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
  if(LABEL.generated&&LABEL.toBook>0)out.push({id:"muziek-te-boeken",bron:"muziek",impact:15,n:10,big:eur(LABEL.toBook),h:"staat bij DJ·World nog te boeken",
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
  if(best&&best.idx>=1.15){const recent=IG.posts.filter(p=>Date.parse(p.gepost_om)>Date.now()-30*864e5&&labelsVan(p,"onderwerp").includes(best.naam)).length;
    out.push({id:"insta-onderwerp-"+best.naam,bron:"insta",impact:Math.min(70,35+(best.idx-1)*100),n:best.n,
      big:"+"+nf0.format((best.idx-1)*100)+"%",h:`bereik bij posts over <b>${esc(best.naam)}</b>`,
      p:`${best.n} posts, middelste bereik ${nf0.format(best.med)}. De laatste 30 dagen postte je er ${recent} over.`,
      a:`<b>Doe:</b> plan deze week 2 posts over ${esc(best.naam)}${best.kw!=null?` (ze worden ook ${best.kw>=(igWatWerkt("soort").alleKw||0)?"vaak":"soms"} gedeeld/bewaard)`:""}.`,
      meet:{naam:`posts over ${best.naam} in 30 dagen`,waarde:recent,beter:"hoger"}})}
  const slecht=[...on].sort((a,b)=>a.idx-b.idx)[0];
  if(slecht&&slecht!==best&&slecht.idx<=0.8&&slecht.n>=10)out.push({id:"insta-onderwerp-minder-"+slecht.naam,bron:"insta",impact:20,n:slecht.n,
    big:"−"+nf0.format((1-slecht.idx)*100)+"%",h:`bereik bij posts over <b>${esc(slecht.naam)}</b>`,
    p:`${slecht.n} posts, middelste bereik ${nf0.format(slecht.med)}.`,
    a:`<b>Doe:</b> niet stoppen als je 't mooi vindt, maar combineer ${esc(slecht.naam)} met een sterker onderwerp${best?` zoals ${esc(best.naam)}`:""}, of zet het in een carrousel.`});
  // 2. soort: reels
  const so=igWatWerkt("soort").rijen, reel=so.find(r=>r.naam==="Reel");
  const p90=IG.posts.filter(p=>Date.parse(p.gepost_om)>Date.now()-90*864e5), reelAandeel=p90.length?p90.filter(p=>soortNaam(p)==="Reel").length/p90.length:0;
  if(reel&&reel.n>=5&&reel.idx>=1.2&&reelAandeel<0.3)out.push({id:"insta-meer-reels",bron:"insta",impact:Math.min(70,40+(reel.idx-1)*60),n:reel.n,
    big:"+"+nf0.format((reel.idx-1)*100)+"%",h:"bereik bij reels, maar maar "+pct(reelAandeel)+" van je posts is een reel",
    p:`${reel.n} reels, middelste bereik ${nf0.format(reel.med)}.`,
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
    if(c.nieuwPct>=0.5&&conv<5)out.push({id:"insta-nieuw-naar-volger",bron:"insta",impact:50,n:split.length*2,
      big:nf1k.format(conv),h:"nieuwe volgâhs per 1.000 nieuwe mensen die je bereikt",
      p:`Je bereikte ${nf0.format(rn)} mensen die je niet volgen (${pct(c.nieuwPct)} van je bereik), daarvan gingen er ${fw} volgen.`,
      a:"<b>Doe:</b> geef nieuwe mensen een reden: eindig bijschriften met één zin als \"Elke dag Scheveningen, volg voor morgen\", en zet 3 toppâhs vast bovenaan je profiel.",
      meet:{naam:"volgâhs per 1.000 nieuw",waarde:Math.round(conv*10)/10,beter:"hoger"}})}
  // 5. delen vs bewaren
  if(c.w.shares>=20&&(c.w.saves||0)<c.w.shares*0.2)out.push({id:"insta-bewaren",bron:"insta",impact:25,n:7,
    big:nf0.format(c.w.shares)+" : "+nf0.format(c.w.saves||0),h:"gedeeld tegen bewaard, laatste 7 dagen",
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
  else if(gelabeld<15)out.push({id:"insta-label-muziek",bron:"insta",impact:30,n:10,big:nf0.format(gelabeld),h:"posts waarbij je hebt aangegeven welke muziek eronder zat",
    p:"Pas vanaf ongeveer 5 posts mét en 5 zonder eigen muziek kan het dashboard zeggen of je eigen muziek bereik kost, en wat het oplevert aan plays.",
    a:'<b>Doe:</b> label in de tab Insta je laatste 20 posts (2 minuten werk, één keuze per post). <button class="btn" type="button" data-ga="insta">Naâh Insta</button>',
    meet:{naam:"gelabelde posts",waarde:gelabeld,beter:"hoger"}});
  // 7. wat doet een Insta-post voor je plays?
  const eff=IG.posts.map(p=>{const m=labelsVan(p,"muziek")[0];return m&&m!=="(geen)"&&m!=="(eigen muziek)"?igPlaysEffect(m,dagNL(p.gepost_om)):null}).filter(e=>e&&e.x7!=null);
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
  if(!bio)out.push({id:"sneek-bio-link",bron:"sneek",impact:35,n:10,big:"?",h:"hoeveel mensen via je Insta-bio naâh Sneek gaan",
    p:"Meta telt klikken op je bio-link niet. Met een eigen link ziet GoatCounter het wél.",
    a:'<b>Doe:</b> zet in Insta → Profiel bewerken → Links: <code>https://www.haagsesneek.nl/?ref=bio</code>. Deze kaart verdwijnt vanzelf zodra het eerste bio-bezoek binnen is.'});
  // 2. stories meten
  const storyLinks=links.filter(l=>/^story-/.test(l.bron));
  const laatsteStory=storyLinks.map(l=>l.eerst).sort().pop();
  if(s.tot.insta>0&&(!laatsteStory||Date.parse(laatsteStory)<Date.now()-14*864e5))out.push({id:"sneek-story-links",bron:"sneek",impact:40,n:10,
    big:nf0.format(s.tot.insta),h:"Sneek-bezoekâhs uit Insta in 30 dagen, maar van geen enkele story weet je wat ie opleverde",
    p:laatsteStory?`Je laatste story met eigen link was op ${dLabel(laatsteStory,1)}.`:"Je hebt nog geen story met een eigen link gebruikt.",
    a:'<b>Doe:</b> maak bij je volgende Sneek-story een link met de knop "Link voor story" in de tab Insta en plak die in je link-sticker. <button class="btn" type="button" data-ga="insta">Naâh Insta</button>',
    meet:{naam:"bezoekâhs via eigen links (30 d)",waarde:s.tot.link,beter:"hoger"}});
  // 3. beste story tot nu
  if(storyLinks.length>=2){const b=[...storyLinks].sort((a,c)=>c.n-a.n)[0],m=kMed(storyLinks.map(l=>l.n));
    if(b.n>=1.5*m)out.push({id:"sneek-beste-story-"+b.bron,bron:"sneek",impact:30,n:storyLinks.length*2,big:nf0.format(b.n),h:`bezoekâhs uit story <code>${esc(b.bron)}</code> (${dLabel(b.eerst)}), je beste tot nu`,
      p:`De middelste story met link bracht ${nf0.format(m)}.`,a:"<b>Doe:</b> kijk wat die story anders deed (tijdstip, tekst, plaatje, score laten zien?) en doe dat nog eens."})}
  // 4. Insta-bezoek zakt in
  const d=s.dagen,w1=d.slice(-7).reduce((a,x)=>a+x.parts[0].v+x.parts[1].v,0),w0=d.slice(-14,-7).reduce((a,x)=>a+x.parts[0].v+x.parts[1].v,0);
  if(w0>=10&&w1<w0*0.7)out.push({id:"sneek-insta-zakt",bron:"sneek",impact:45,n:10,big:"−"+pct(1-w1/w0),h:"Sneek-bezoekâhs via Insta/Facebook vergeleken met vorige week",
    p:`Deze week ${nf0.format(w1)}, vorige week ${nf0.format(w0)}.`,trend:kVs(w1,w0),
    a:"<b>Doe:</b> tijd voor een nieuwe Sneek-story: laat de toppâh van de lèst zien (\"Wie pakt @… z'n plek?\") met een eigen link.",
    meet:{naam:"bezoekâhs via Meta per week",waarde:w1,beter:"hoger"}});
  // 5. bezoekers spelen niet
  if(g.b30>=30){const r=g.p30/g.b30;
    if(r<0.6)out.push({id:"sneek-speel-ratio",bron:"sneek",impact:40,n:g.b30>=100?10:6,big:pct(1-r),h:"van de Sneek-bezoekâhs start geen potje",
      p:`${nf0.format(g.b30)} bezoekâhs, ${nf0.format(g.p30)} speelden (30 dagen). Wie niet speelt, komt ook niet op de lèst.`,
      a:"<b>Doe:</b> maak de startknop groter en de eerste seconde spannender (bijv. meteen spelen met één tik, uitleg pas daarna). Kijk op de telefoon hoe het beginscherm eruitziet.",
      meet:{naam:"% dat speelt",waarde:Math.round(r*100),beter:"hoger"}})}
  // 6. weinig scores gedeeld
  if(g.p30>=20){const r=g.g30/g.p30;
    if(r<0.1)out.push({id:"sneek-delen",bron:"sneek",impact:35,n:g.p30>=100?10:6,big:pct(r),h:"van de spelâhs deelt z'n scoâh",
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
  lijst.forEach(k=>{k.id=k.id.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");k.zeker=k.n>=10?1:k.n>=5?0.7:0.4;k.score=k.impact*k.zeker;k.st=KANS.status.get(k.id)||null});
  return lijst.sort((a,b)=>b.score-a.score);
}
const BRON={muziek:["Muziek","sc"],insta:["Insta","hy"],sneek:["Sneek","groen"]};
function kansGrootte(k){return k.score>=45?'<span class="chip good">grote kans</span>':k.score>=25?'<span class="chip warn">middel</span>':'<span class="chip mute">klein</span>'}
function kansZeker(k){return k.zeker>=1?"":k.zeker>=0.7?' <span class="chip mute">nog voorzichtig</span>':' <span class="chip mute">weinig data</span>'}
function kansVoortgang(k){
  const st=k.st;let t="";
  if(k.trend)t+=`<div class="kvoort">Trend: ${k.trend}</div>`;
  if(st&&k.meet&&st.waarde_toen!=null){const oud=+st.waarde_toen,nu=k.meet.waarde,f=k.meet.fmt||(v=>nf0.format(v));
    const beter=k.meet.beter==="hoger"?nu>oud:nu<oud,gelijk=nu===oud;
    t+=`<div class="kvoort">Sinds ${dLabel(String(st.gezet_om).slice(0,10))}: ${esc(k.meet.naam)} ${f(oud)} → <b>${f(nu)}</b> ${gelijk?"(nog gelijk)":beter?'<span class="up">betâh ↑</span>':'<span class="down">nog nie betâh</span>'}</div>`}
  return t;
}
function kansKaart(k,klein){
  const st=k.st&&k.st.status;const [bn,bk]=BRON[k.bron];
  return `<article class="ins kans${st?" k-"+st:""}" data-kans="${esc(k.id)}">
    <div class="kkop"><span class="chip kbron" style="--c:var(--${bk})">${bn}</span>${kansGrootte(k)}${kansZeker(k)}${st==="bezig"?' <span class="chip warn">mee bezig</span>':st==="gedaan"?' <span class="chip good">gedaan ✓</span>':""}</div>
    <span class="big">${k.big}</span><h3>${k.h}</h3>${klein?"":`<p>${k.p}</p>`}<div class="act">${k.a}</div>${kansVoortgang(k)}
    ${klein?"":`<div class="kknop">
      <button class="btn" type="button" data-kz="bezig" aria-pressed="${st==="bezig"}">Mee bezig</button>
      <button class="btn" type="button" data-kz="gedaan" aria-pressed="${st==="gedaan"}">Gedaan</button>
      <button class="btn kweg" type="button" data-kz="verborgen">${st==="verborgen"?"Toch tonen":"Nie voor mij"}</button></div>`}
  </article>`;
}
function kansenHTML(lijst,opts={}){
  const zicht=lijst.filter(k=>kansToonVerborgen||!(k.st&&k.st.status==="verborgen"));
  const open=zicht.filter(k=>!k.st||k.st.status!=="gedaan"),klaar=zicht.filter(k=>k.st&&k.st.status==="gedaan");
  const verborgen=lijst.filter(k=>k.st&&k.st.status==="verborgen").length;
  let h=`<div class="insights">${open.map(k=>kansKaart(k)).join("")||'<p class="sub">Geen open kansen in deze selectie. Knap, âhwe!</p>'}</div>`;
  if(klaar.length)h+=`<h3 class="kgroep">Gedaan (${klaar.length}): houdt het effect bij</h3><div class="insights">${klaar.map(k=>kansKaart(k)).join("")}</div>`;
  if(verborgen)h+=`<p class="sub" style="margin-top:12px"><button class="btn" type="button" id="kToonVerborgen">${kansToonVerborgen?"Verberg":"Toon"} ${verborgen} weggezette kans${verborgen>1?"en":""}</button></p>`;
  return h;
}

/* ---------- pagina Kansâh ---------- */
let kansLaatste=[];
function renderKansen(){
  if(!$("kansLijst"))return;
  const alle=kansenAlle();kansLaatste=alle;
  const telt=b=>alle.filter(k=>(b==="alles"||k.bron===b)&&!(k.st&&["gedaan","verborgen"].includes(k.st.status))).length;
  document.querySelectorAll("#kansFilter button").forEach(b=>{b.setAttribute("aria-pressed",b.dataset.v===kansFilter);b.querySelector("span").textContent=telt(b.dataset.v)});
  const top=alle.filter(k=>!k.st||k.st.status==="bezig").slice(0,3);
  $("kansTop").innerHTML=top.length?top.map((k,i)=>`<li><b>${i+1}.</b> ${k.a.replace(/<button[^>]*>.*?<\/button>/g,"").replace(/^<b>Doe:<\/b>\s*/,"")} <span class="sub">(${BRON[k.bron][0]})</span></li>`).join(""):"<li>Alles gedaan. Tijd voor een biertje op de Pier.</li>";
  $("kansSub").textContent=`${alle.length} kansen gevonden in je muziek, Insta en Sneek, grootste eerst. Ze komen en gaan vanzelf met de cijfâhs.`+(KANS.lokaal?" (Je keuzes worden nu alleen in deze browser bewaard: draai 10_kansen.sql om ze overal te zien.)":"");
  $("kansLijst").innerHTML=kansenHTML(alle.filter(k=>kansFilter==="alles"||k.bron===kansFilter));
}
// muziek-tab "Waâh zit nog wat?": dezelfde motor, alleen muziek (volgt de filters van de muziek-tab)
function renderInsights(d){
  const l=kansenAlle(d).filter(k=>k.bron==="muziek");kansLaatste=l.concat(kansLaatste.filter(k=>k.bron!=="muziek"));
  $("insights").innerHTML=l.length?`<p class="sub" style="grid-column:1/-1;margin:0">Grootste kans eerst. Alle kansen (ook Insta en Sneek) staan onder <button class="btn" type="button" data-ga="kansen">Kansâh</button></p>`+kansenHTML(l)
    :'<p class="sub">Nog niks te zien. Laad eerst je SoundCloud-CSV in.</p>';
}
function kansTegel(){
  const alle=kansenAlle().filter(k=>!k.st||k.st.status==="bezig");
  return `<article class="tegel">
    <div class="tkop"><h2>Kansâh</h2><span class="tag">${alle.length} open</span></div>
    <p class="tlbl">Doe dit deze week</p>
    <div class="trijen">${alle.slice(0,3).map(k=>`<div class="trij"><span class="k"><span class="chip kbron" style="--c:var(--${BRON[k.bron][1]})">${BRON[k.bron][0]}</span></span><span class="v">${k.big}</span><span class="s">${k.h}</span></div>`).join("")||'<p class="s">Niks open. Lekkâh bezig!</p>'}</div>
    <button class="btn yellow" type="button" data-ga="kansen">Kèk bè Kansâh</button>
  </article>`;
}

document.addEventListener("click",async e=>{
  const f=e.target.closest("#kansFilter button");if(f){kansFilter=f.dataset.v;renderKansen();return}
  if(e.target.closest("#kToonVerborgen")){kansToonVerborgen=!kansToonVerborgen;sectie==="kansen"?renderKansen():render();return}
  const b=e.target.closest("[data-kz]");if(!b)return;
  const id=b.closest("[data-kans]").dataset.kans,k=kansLaatste.find(x=>x.id===id);if(!k)return;
  const huidig=k.st&&k.st.status,nieuw=b.dataset.kz===huidig?null:b.dataset.kz;
  await kansZet(k,nieuw);
  if(sectie==="kansen")renderKansen();else render();
});
