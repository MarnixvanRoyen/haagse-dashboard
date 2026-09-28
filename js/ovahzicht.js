// ovahzicht.js — de tegels op de startpagina, één per onderdeel

/* ---------- Live muziekcijfers ----------
   YouTube en SoundCloud: bij het openen vraagt de app Supabase om nieuwe cijfers (rpc muziek_live,
   hooguit 1x per 10 min). "Vandaag erbè" = laatste meting van vandaag min de laatste meting van de dag ervoor.
   Spotify heeft geen API: daar is het verschil tussen de laatste twee CSV-exports. */
const LIVE={yt:null,sc:null,bezig:false,t:0};
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
  let tot=0,erbe=0;
  per.forEach(rows=>{rows.sort((a,b)=>a.snap_date<b.snap_date?-1:1);
    const cur=rows[rows.length-1];if(cur.snap_date!==last)return;
    tot+=+cur[veld];
    if(!prevDag)return;
    const prev=rows.length>1?rows[rows.length-2]:null;
    erbe+=prev?(+cur[veld])-(+prev[veld]):(+cur[veld]);   // nieuw nummer: alles telt als erbè
  });
  return {last,prevDag,tot,erbe};
}
function liveRij(label,bron,g){
  const L=LIVE[bron]||{},vandaag=L.vandaag||vandaagAms();
  let status="";
  if(LIVE.bezig)status=" · effe bèwerke…";
  else if(L.fout)status=/muziek_live/.test(L.fout)?" · live staat nog uit (draai 07_live.sql)":" · live ophalen lukte nie";
  else if(L.om&&g&&g.last===vandaag)status=" · bègewerkt "+tijdAms(L.om);
  if(!g)return tegelRij(label,"—","nog geen meting"+status);
  if(!g.prevDag)return streamRij(label,"—",g.tot,"eerste meting, morgen zie je wat erbè komt"+status);
  const v=(g.erbe>0?"+":"")+nf0.format(g.erbe);
  if(g.last!==vandaag)return streamRij(label,v,g.tot,`erbè op ${dLabel(g.last)} · vandaag nog geen meting${status}`);
  let sinds;
  if(g.prevDag===gisteren(vandaag))sinds=L.vorige_om&&L.vorige_dag===g.prevDag?"sinds gisteren "+tijdAms(L.vorige_om):"sinds de meting van gisteren";
  else sinds="sinds "+dLabel(g.prevDag);
  return streamRij(label,v,g.tot,`vandaag erbè (${sinds})${status}`);
}
function spotifyRij(label){
  const snaps=SP.snaps||[];
  if(!snaps.length)return tegelRij(label,"—","nog geen CSV ingeladen");
  const dates=[...new Set(snaps.map(s=>s.snap_date))].sort();
  const last=dates[dates.length-1],prev=dates.length>1?dates[dates.length-2]:null;
  const prevBy=new Map(snaps.filter(s=>s.snap_date===prev).map(s=>[s.song,+s.streams||0]));
  const cur=snaps.filter(s=>s.snap_date===last);
  const tot=cur.reduce((a,s)=>a+(+s.streams||0),0);
  if(!prev)return streamRij(label,"—",tot,`pas één CSV (${dLabel(last)}), bij de volgende zie je wat erbè kwam`);
  const erbe=cur.reduce((a,s)=>a+(+s.streams||0)-(prevBy.get(s.song)||0),0);
  return streamRij(label,(erbe>0?"+":"")+nf0.format(erbe),tot,`erbè tussen CSV ${dLabel(prev)} en ${dLabel(last)} (alleen bij een nieuwe CSV)`);
}
async function muziekLive(){
  if(!sb||LIVE.bezig||Date.now()-LIVE.t<10*60e3)return;
  LIVE.bezig=true;LIVE.t=Date.now();if(sectie==="ovahzicht")renderOvahzicht();
  const bronnen=["yt","sc"];
  const res=await Promise.all(bronnen.map(b=>sb.rpc("muziek_live",{bron:b}).then(r=>r,e=>({error:e}))));
  const laden=[];
  res.forEach((r,i)=>{const b=bronnen[i];
    LIVE[b]=r.error?{fout:r.error.message||String(r.error)}:r.data;
    if(r.data&&r.data.ververst)laden.push(b==="yt"?loadYT():loadSCL());});
  await Promise.all(laden);
  LIVE.bezig=false;
  if(sectie==="ovahzicht")renderOvahzicht();else if(sectie==="muziek"&&laden.length)render();
}
// app weer in beeld (bijv. telefoon uit je zak)? dan opnieuw proberen, hooguit 1x per 10 min
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!$("app").hidden)muziekLive()});
// rij met groot getal (erbè) en het totaal eronder
function streamRij(k,v,tot,s){return `<div class="trij"><span class="k">${k}</span><span class="v">${v}</span><span class="tot">totaal ${nf0.format(tot)}</span>${s?`<span class="s">${s}</span>`:""}</div>`}
function tegelRij(k,v,s){return `<div class="trij"><span class="k">${k}</span><span class="v">${v}</span>${s?`<span class="s">${s}</span>`:""}</div>`}

function renderOvahzicht(){
  const poen=SC.reduce((a,r)=>a+r.usd,0)*state.rate+LABEL.periods.reduce((a,p)=>a+p.net,0);
  const sc=dagGroei(SCL.snaps,"track_id","plays"), yt=dagGroei(YT.snaps,"video_id","views");
  $("ovTegels").innerHTML=`
  <article class="tegel">
    <div class="tkop"><h2>Muziek</h2><span class="tag">Marreman Rojas & Beuk</span></div>
    <p class="tlbl">Poen tot nu toe</p>
    <div class="tgroot"><small>€</small>${nf2.format(poen)}</div>
    <p class="s">SoundCloud + label (netto), alle maanden samen</p>
    <div class="trijen">
      ${liveRij('<i class="dot sc"></i>SoundCloud-plays',"sc",sc)}
      ${liveRij('<i class="dot yt"></i>YouTube-weergaven',"yt",yt)}
      ${spotifyRij('<i class="dot sp"></i>Spotify-streams')}
    </div>
    <button class="btn yellow" type="button" data-ga="muziek">Kèk bè Muziek</button>
  </article>
  <article class="tegel binnenkort">
    <div class="tkop"><h2>Insta</h2><span class="tag">@the_hague_beachlife</span></div>
    <p class="kd">Komt d'r an, âhwe!</p>
    <p class="s">Volgâhs, bereik en wat werkt, straks elke dag vanzelf bijgewerkt.</p>
    <button class="btn" type="button" data-ga="insta">Wat komt d'r?</button>
  </article>
  ${appsTegel()}`;
}

function appsTegel(){
  const n=sneekCompute();
  return `<article class="tegel">
    <div class="tkop"><h2>Apps</h2><span class="tag">Haagse Sneek</span></div>
    <p class="tlbl">Sneek · spelâhs op de lèst</p>
    <div class="tgroot">${nf0.format(n.spelers)}</div>
    <p class="s">haagsesneek.nl</p>
    <div class="trijen">
      ${tegelRij("Nieuwe spelâhs",(n.nieuw7?"+":"")+nf0.format(n.nieuw7),"laatste 7 dagen")}
      ${GC.dag.length?(g=>tegelRij("Bezoekâhs",nf0.format(g.b7),"laatste 7 dagen · "+nf0.format(g.p7)+" potjes gestart"))(gcCompute()):""}
      ${tegelRij("Hoogste scoâh",n.top[0]?nf0.format(n.top[0].score):"—",n.top[0]?"@"+esc(n.top[0].insta):"")}
    </div>
    <button class="btn yellow" type="button" data-ga="apps">Kèk bè Apps</button>
  </article>`;
}
