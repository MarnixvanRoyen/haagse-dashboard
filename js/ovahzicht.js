// ovahzicht.js — de tegels op de startpagina, één per onderdeel

// stand van de laatste meting: tel een veld op over alle regels van de nieuwste datum
function laatsteStand(snaps,veld){
  if(!snaps||!snaps.length)return null;
  const d=snaps.reduce((a,s)=>s.snap_date>a?s.snap_date:a,"");
  return {d,tot:snaps.filter(s=>s.snap_date===d).reduce((a,s)=>a+(+s[veld]||0),0)};
}
/* "Erbè sinds je vorige bezoek": per bron onthoudt de browser twee standen:
   - gezien = de stand die je de laatste keer zag
   - basis  = de stand dáárvoor
   Komt er nieuwe data binnen (stand ≠ gezien), dan schuift gezien door naar basis.
   Zo blijft het verschil staan als je de pagina herlaadt, en telt het na een paar dagen weg zijn alles bij elkaar op.
   Let op: dit staat in de browser, dus je telefoon en je Mac houden elk hun eigen "vorige bezoek" bij. */
function erbeSinds(bron,stand){
  let m={};try{m=JSON.parse(store.get("hc_muziek_gezien")||"{}")||{}}catch(e){}
  const nu={tot:stand.tot,d:stand.d,t:new Date().toISOString().slice(0,10)};
  let o=m[bron];
  if(!o){o={basis:nu,gezien:nu}}
  else if(o.gezien.tot!==nu.tot||o.gezien.d!==nu.d){o={basis:o.gezien,gezien:nu}}
  m[bron]=o;store.set("hc_muziek_gezien",JSON.stringify(m));
  return {erbe:nu.tot-o.basis.tot,sinds:o.basis.t,eerste:o.basis===nu||(o.basis.tot===nu.tot&&o.basis.d===nu.d&&o.basis.t===nu.t)};
}
function erbeRij(label,bron,stand){
  if(!stand)return tegelRij(label,"—","nog geen meting");
  const e=erbeSinds(bron,stand);
  if(e.eerste)return tegelRij(label,"—",`vanaf nu tel ik wat erbè komt · totaal ${nf0.format(stand.tot)}`);
  return tegelRij(label,(e.erbe>0?"+":"")+nf0.format(e.erbe),`erbè sinds je bezoek van ${dLabel(e.sinds)} · totaal ${nf0.format(stand.tot)}`);
}
function tegelRij(k,v,s){return `<div class="trij"><span class="k">${k}</span><span class="v">${v}</span>${s?`<span class="s">${s}</span>`:""}</div>`}

function renderOvahzicht(){
  const poen=SC.reduce((a,r)=>a+r.usd,0)*state.rate+LABEL.periods.reduce((a,p)=>a+p.net,0);
  const sc=laatsteStand(SCL.snaps,"plays"), yt=laatsteStand(YT.snaps,"views"), sp=laatsteStand(SP.snaps,"streams");
  $("ovTegels").innerHTML=`
  <article class="tegel">
    <div class="tkop"><h2>Muziek</h2><span class="tag">Marreman Rojas & Beuk</span></div>
    <p class="tlbl">Poen tot nu toe</p>
    <div class="tgroot"><small>€</small>${nf2.format(poen)}</div>
    <p class="s">SoundCloud + label (netto), alle maanden samen</p>
    <div class="trijen">
      ${erbeRij('<i class="dot sc"></i>SoundCloud-plays',"sc",sc)}
      ${erbeRij('<i class="dot sp"></i>Spotify-streams',"sp",sp)}
      ${erbeRij('<i class="dot yt"></i>YouTube-weergaven',"yt",yt)}
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
