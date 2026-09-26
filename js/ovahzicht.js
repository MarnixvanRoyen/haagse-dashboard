// ovahzicht.js — de tegels op de startpagina, één per onderdeel

// stand van de laatste meting: tel een veld op over alle regels van de nieuwste datum
function laatsteStand(snaps,veld){
  if(!snaps||!snaps.length)return null;
  const d=snaps.reduce((a,s)=>s.snap_date>a?s.snap_date:a,"");
  return {d,tot:snaps.filter(s=>s.snap_date===d).reduce((a,s)=>a+(+s[veld]||0),0)};
}
function tegelRij(k,v,s){return `<div class="trij"><span class="k">${k}</span><span class="v">${v}</span>${s?`<span class="s">${s}</span>`:""}</div>`}

function renderOvahzicht(){
  const poen=SC.reduce((a,r)=>a+r.usd,0)*state.rate+LABEL.periods.reduce((a,p)=>a+p.net,0);
  const sc=laatsteStand(SCL.snaps,"plays"), yt=laatsteStand(YT.snaps,"views"), sp=laatsteStand(SP.snaps,"streams");
  const stand=o=>o?"stand "+dLabel(o.d):"nog geen meting";
  $("ovTegels").innerHTML=`
  <article class="tegel">
    <div class="tkop"><h2>Muziek</h2><span class="tag">Marreman Rojas & Beuk</span></div>
    <p class="tlbl">Poen tot nu toe</p>
    <div class="tgroot"><small>€</small>${nf2.format(poen)}</div>
    <p class="s">SoundCloud + label (netto), alle maanden samen</p>
    <div class="trijen">
      ${tegelRij('<i class="dot sc"></i>SoundCloud-plays',sc?nf0.format(sc.tot):"—",stand(sc))}
      ${tegelRij('<i class="dot sp"></i>Spotify-streams',sp?nf0.format(sp.tot):"—",stand(sp))}
      ${tegelRij('<i class="dot yt"></i>YouTube-weergaven',yt?nf0.format(yt.tot):"—",stand(yt))}
    </div>
    <button class="btn yellow" type="button" data-ga="muziek">Kèk bè Muziek</button>
  </article>
  <article class="tegel binnenkort">
    <div class="tkop"><h2>Insta</h2><span class="tag">@the_hague_beachlife</span></div>
    <p class="kd">Komt d'r an, âhwe!</p>
    <p class="s">Volgâhs, bereik en wat werkt, straks elke dag vanzelf bijgewerkt.</p>
    <button class="btn" type="button" data-ga="insta">Wat komt d'r?</button>
  </article>
  <article class="tegel binnenkort">
    <div class="tkop"><h2>Sneek</h2><span class="tag">haagsesneek.nl</span></div>
    <p class="kd">Komt d'r an, âhwe!</p>
    <p class="s">Bezoekâhs, potjes en spelers op de lèst.</p>
    <button class="btn" type="button" data-ga="sneek">Wat komt d'r?</button>
  </article>`;
}
