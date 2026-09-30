// live.js — live muziekcijfers (YouTube + SoundCloud ververst bij openen), gebruikt door Ovâhzicht en Muziek

/* ---------- Live muziekcijfers ----------
   YouTube en SoundCloud: bij het openen vraagt de app Supabase om nieuwe cijfers (rpc muziek_live,
   hooguit 1x per 10 min). "Vandaag erbè" = laatste meting van vandaag min de laatste meting van de dag ervoor.
   Spotify heeft geen API: daar is het verschil tussen de laatste twee CSV-exports. */
const LIVE={yt:null,sc:null,gc:null,ig:null,bezig:false,t:0};
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
// YouTube, SoundCloud, GoatCounter (Sneek-bezoekers) en Insta tegelijk verversen, elk een eigen vraag (i.v.m. tijdslimiet)
async function muziekLive(){
  if(!sb||LIVE.bezig||Date.now()-LIVE.t<10*60e3)return;
  LIVE.bezig=true;LIVE.t=Date.now();hertekenLive();
  const bronnen=["yt","sc","gc","ig"];
  // na de Ververse-knop bovenaan mag het al na 5 min opnieuw (de oude "Nâh ververse"-knoppen per tabblad deden dat ook); gewoon openen: 10 min
  const mm=VERVERS_GEDRUKT?5:10;VERVERS_GEDRUKT=false;
  const res=await Promise.all(bronnen.map(b=>(b==="gc"?sb.rpc("gc_live",{min_minuten:mm}):b==="ig"?sb.rpc("ig_live",{min_minuten:mm}):sb.rpc("muziek_live",{bron:b,min_minuten:mm})).then(r=>r,e=>({error:e}))));
  const laden=[];
  res.forEach((r,i)=>{const b=bronnen[i];
    LIVE[b]=r.error?{fout:r.error.message||String(r.error)}:r.data;
    if(r.data&&r.data.ververst)laden.push(b==="yt"?loadYT():b==="sc"?loadSCL():b==="ig"?loadIG():loadGC());});
  await Promise.all(laden);
  LIVE.bezig=false;
  hertekenLive();
}
function hertekenLive(){
  if(sectie==="ovahzicht")renderOvahzicht();
  else if(sectie==="muziek"&&(state.tab==="youtube"||state.tab==="sclive"))render();
  else if(sectie==="apps")renderSneek();
  else if(sectie==="insta")renderInsta();
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
