// ovahzicht.js — de tegels op de startpagina, één per onderdeel

function liveRij(label,bron,g){
  const i=liveInfo(bron,g);
  return i.leeg?tegelRij(label,i.v,i.s):streamRij(label,i.v,g.tot,i.s);
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
// Sneek vandaag: bezoekâhs groot, eronder hoeveel er een potje speelden
function bezoekRij(v){
  const pctS=v.bezoek?" ("+pct(Math.min(1,v.speelden/v.bezoek))+")":"";
  return `<div class="trij"><span class="k">Bezoekâhs vandaag</span><span class="v">${nf0.format(v.bezoek)}</span><span class="tot">${nf0.format(v.speelden)} speelden${pctS}</span><span class="s">${v.exact?"sinds 00:00":"sinds "+tijdAms(dagUTC(Date.now())+"T00:00:00Z")}${v.gedeeld?" · "+nf0.format(v.gedeeld)+" scoâhs gedeeld":""}${liveStatus("gc","08_goatcounter_live.sql")}</span></div>`;
}
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
  ${instaTegel()}
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
      ${GC.dag.length?(v=>bezoekRij(v))(gcVandaag()):""}
      ${tegelRij("Nieuwe spelâhs",(n.nieuw7?"+":"")+nf0.format(n.nieuw7),"laatste 7 dagen")}
      ${GC.dag.length?(g=>tegelRij("Bezoekâhs",nf0.format(g.b7),"laatste 7 dagen · "+nf0.format(g.p7)+" speelden een potje"))(gcCompute()):""}
      ${tegelRij("Hoogste scoâh",n.top[0]?nf0.format(n.top[0].score):"—",n.top[0]?"@"+esc(n.top[0].insta):"")}
    </div>
    <button class="btn yellow" type="button" data-ga="apps">Kèk bè Apps</button>
  </article>`;
}
