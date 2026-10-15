// plekkies.js — tab Plekkies: serie "Haagse plekkies doâh Haagse mense" (15-10-2026, chat 50)
// Wie doet mee, waar en wanneer shooten we, welke tekst komt erbij, en hoe deed de post het.
//
// Data: Supabase-tabellen hp_mensen en hp_shoots (32_plekkies.sql), alleen voor Marnix (RLS is_marnix + eigen rijen).
// Privacy (AVG):
//  * persoonsgegevens alleen in Supabase: NIET in localStorage/sessionStorage, NIET in de console, NIET in exports.
//    Foutmeldingen tonen alleen error.message (nooit error.details: daar kan Postgres de hele rij in zetten).
//  * e-mail/telefoon alleen met akkoord (de database weigert het anders ook).
//  * "Contact wisse" (rpc hp_contact_wissen): e-mail, telefoon, notitie weg → Archief (naam + Insta + geposte shoots blijven),
//    shoots die nooit gepost zijn worden mee gewist. "Alles wisse" (rpc hp_alles_wissen): persoon helemaal weg,
//    geposte shoots blijven als "gewiste persoon".
// Post-cijfers: alleen bestaande functies (pdEind, pdNorm uit postdetail.js; igNormaalEind, igPartnersVan uit insta.js).
// Tik op de post in een shoot = de pop-up "Post in detail" van chat 44 (via data-pd, postdetail.js regelt de klik).

let HP={mensen:[],shoots:[],geladen:false,laden:null,err:null,filter:"alles"};
let HPF=null;   // open formulier: {soort:"persoon"/"shoot", id, vuil, bevestig, post, terug}
const HP_STIL_DAGEN=365;      // zo lang geen shoot → vraag of het contact gewist mag worden
const HP_POST_KEUZE=30;       // zoveel posts in de post-kiezer (na "Toon meer")
const HP_POST_EERST=12;       // eerst zoveel (geen lijst-in-een-lijst die apart scrolt: lastig op de telefoon)
const HP_TZ="Europe/Amsterdam";
const HP_DAG=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,weekday:"short",day:"numeric",month:"short"});
const HP_DAGJ=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,weekday:"short",day:"numeric",month:"short",year:"numeric"});
const HP_TIJD=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,hour:"2-digit",minute:"2-digit"});
const HP_DELEN=new Intl.DateTimeFormat("en-CA",{timeZone:HP_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const HP_STATUS={gepland:"Gepland",geschoten:"Geschoten",gepost:"Gepost"};
const HP_TEKST={idee:"Tekst: idee",klaar:"Tekst: klaar",gepost:"Tekst: gepost"};
const HP_HOE={dm:"Insta-DM",mail:"Mail",mondeling:"Mondeling",anders:"Anders"};
const HP_NF1=new Intl.NumberFormat("nl-NL",{minimumFractionDigits:1,maximumFractionDigits:1});

/* ---------- laden ---------- */
async function hpLaden(){
  if(HP.laden)return HP.laden;
  HP.laden=(async()=>{
    try{
      const [m,s]=await Promise.all([
        sb.from("hp_mensen").select("*").order("naam"),
        sb.from("hp_shoots").select("*").order("wanneer",{ascending:true,nullsFirst:false})]);
      if(m.error)throw m.error;if(s.error)throw s.error;
      HP.mensen=m.data||[];HP.shoots=s.data||[];HP.err=null;
    }catch(e){HP.err=hpFout(e)}
    HP.geladen=true;HP.laden=null;
  })();
  return HP.laden;
}
// alleen de korte melding, nooit details (kan persoonsgegevens bevatten)
function hpFout(e){const m=(e&&e.message)||String(e);
  if(/hp_mensen|hp_shoots/.test(m)&&/does not exist|schema cache|Could not find/i.test(m))return "Tabellen bestaan nog nie: draai eerst 32_plekkies.sql.";
  if(/hp_contact_alleen_met_akkoord/.test(m))return "E-mail en telefoon kunnen alleen met akkoord.";
  if(/hp_akkoord_met_datum/.test(m))return "Vul de datum van het akkoord in.";
  if(/insta_check/.test(m))return "Insta-naam: alleen kleine letters, cijfers, punt en _ (max 30).";
  if(/email_check/.test(m))return "Dat e-mailadres klopt nie.";
  if(/telefoon_check/.test(m))return "Telefoonnummâh: alleen cijfers, spatie, + - ( ).";
  if(/kaart_link_check/.test(m))return "Kaart-link moet met https:// beginnen.";
  if(/naam_check|plek_check/.test(m))return "Naam en plek mogen nie leeg zijn.";
  if(/Alleen voor Marnix|row-level security|permission denied/i.test(m))return "Geen toegang (alleen voor Marnix).";
  return m.length>160?m.slice(0,160)+"…":m;
}

/* ---------- hulpjes ---------- */
const hpPersoon=id=>HP.mensen.find(m=>m.id===id)||null;
const hpShootsVan=id=>HP.shoots.filter(s=>s.persoon_id===id);
const hpPost=id=>id&&(IG.posts||[]).find(p=>p.media_id===id)||null;
function hpDatum(ts,jaar){if(!ts)return "nog geen datum";const d=new Date(ts);
  return (jaar||Math.abs(Date.now()-d)>300*864e5?HP_DAGJ:HP_DAG).format(d)+" · "+HP_TIJD.format(d)}
function hpDelen(ts){   // timestamptz → {d:"2026-10-20", t:"08:00"} in Haagse tijd (voor de invulvelden)
  if(!ts)return {d:"",t:""};const o={};HP_DELEN.formatToParts(new Date(ts)).forEach(x=>o[x.type]=x.value);
  return {d:`${o.year}-${o.month}-${o.day}`,t:`${o.hour}:${o.minute}`}}
function hpVanDelen(d,t){   // datum + tijd (Haagse tijd) → ISO; zonder tijd = 12:00
  if(!d)return null;const [Y,M,D]=d.split("-").map(Number),[h,mi]=(t||"12:00").split(":").map(Number);
  let u=Date.UTC(Y,M-1,D,h,mi);for(let i=0;i<2;i++){const p=hpDelen(new Date(u).toISOString()),[ph,pm]=p.t.split(":").map(Number);
    const [pY,pM,pD]=p.d.split("-").map(Number);u-=(Date.UTC(pY,pM-1,pD,ph,pm)-Date.UTC(Y,M-1,D,h,mi))}
  return new Date(u).toISOString()}
const hpVandaag=()=>hpDelen(new Date().toISOString()).d;
const hpInsta=s=>String(s||"").trim().replace(/^@+/,"").toLowerCase();
const hpInstaLink=i=>i?`<a href="https://www.instagram.com/${encodeURIComponent(i)}/" target="_blank" rel="noopener">@${esc(i)}</a>`:"";
const hpKaartUrl=s=>s.kaart_link||("https://maps.apple.com/?q="+encodeURIComponent(s.plek+", Den Haag"));
function hpNaam(s){const m=hpPersoon(s.persoon_id);return m?m.naam:(s.persoon_id?"?":"gewiste persoon")}
function hpLaatsteShoot(m){const l=hpShootsVan(m.id).map(s=>Date.parse(s.wanneer||s.aangemaakt_om)).filter(x=>!isNaN(x));
  return l.length?Math.max(...l):Date.parse(m.aangemaakt_om)}

/* ---------- toestemmingstekst (om te sturen, plat Haags) ---------- */
function hpToestemming(naam){
  return `Hoi ${naam||"daâh"}! Leuk dat je mee wil doen aan Haagse plekkies doâh Haagse mense 💛💚\n`+
    `Om de shoot te plannen bewaar ik je naam, Insta-naam, e-mail en telefoonnummâh. Alleen voâh mèzelf, ik deel het met niemand.\n`+
    `Ben je akkoord? Stuur dan effe "akkoord" terug.\n`+
    `Wil je latâh dat ik je gegevens wis? Eén berichie is genoeg, dan haal ik ze weg.\n`+
    `Groetjes, Marnix (@the_hague_beachlife)`;
}

/* ---------- post-cijfers bij een geposte shoot ---------- */
function hpPostCijfers(p){
  const E=typeof pdEind==="function"?pdEind(p):null;
  const N=igNormaalEind(p);
  const x=E&&N.genoeg&&N.waarde>0?E.eind/N.waarde:null;
  const rij=(k,v,norm,eind)=>{
    if(v==null||isNaN(v))return `<span class="hpcijf"><b>—</b><small>${k}</small></span>`;
    const keer=norm>0?v/norm:null;
    const kl=keer==null?"":keer>=1.25?"goed":keer<=0.8?"laag":"";
    return `<span class="hpcijf ${kl}"><b>${nf0.format(v)}</b><small>${k}${eind?" ≈":""}${keer!=null?` · ${HP_NF1.format(keer)}× normaal`:""}</small></span>`};
  const lk=typeof pdNorm==="function"?pdNorm(p,q=>q.likes==null?null:+q.likes):{waarde:null};
  const vg=typeof pdNorm==="function"?pdNorm(p,q=>q.nieuwe_volgers==null?null:+q.nieuwe_volgers):{waarde:null};
  return `<div class="hpcijfers">`+
    rij("bereik",E?Math.round(E.eind):null,N.genoeg?N.waarde:null,E&&!E.klaar)+
    rij("likes",p.likes==null?null:+p.likes,lk.waarde)+
    rij("nieuwe volgâhs",p.nieuwe_volgers==null?null:+p.nieuwe_volgers,vg.waarde)+`</div>`+
    (x!=null?`<p class="sub hpx">${HP_NF1.format(x)}× je normaal${typeof pdFase==="function"&&pdFase(x)?": "+esc(pdFase(x).t):""}${E&&!E.klaar?" (verwacht, loopt nog)":""}</p>`:"");
}
function hpPostHTML(s){
  if(!s.media_id)return "";
  const p=hpPost(s.media_id);
  if(!p)return `<div class="hppost leeg"><span class="sub">Post ${esc(s.media_id)} nie (meâh) gevonden in je Insta-cijfâhs.</span></div>`;
  return `<div class="hppost" data-pd="${esc(p.media_id)}" tabindex="0" role="button" aria-label="Post in detail bekijken">
    <span class="igthumb hpthumb">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span>
    <div class="hppostin"><div class="hppostkop">${esc(HP_DAG.format(new Date(p.gepost_om)))} · ${esc(IG_GROEPEN[soortGroep(p)].een)} <span class="hpkijk">Post in detail ›</span></div>${hpPostCijfers(p)}</div></div>`;
}

/* ---------- tekenen ---------- */
async function renderPlekkies(){
  const el=$("hpInhoud");if(!el)return;
  if(!HP.geladen){el.innerHTML=`<p class="sub">Effe ophale…</p>`;await hpLaden();if(sectie!=="plekkies")return}
  if(HP.err){el.innerHTML=`<div class="card binnenkort"><h2>Plekkies</h2><p class="kd">Lukte nie, âhwe</p><p class="sub">${esc(HP.err)}</p></div>`;$("hpStats").innerHTML="";return}
  const nu=Date.now();
  const actief=HP.mensen.filter(m=>!m.archief),arch=HP.mensen.filter(m=>m.archief);
  const komend=HP.shoots.filter(s=>s.status==="gepland").sort((a,b)=>(a.wanneer?Date.parse(a.wanneer):9e15)-(b.wanneer?Date.parse(b.wanneer):9e15));
  const gepost=HP.shoots.filter(s=>s.status==="gepost");
  $("hpStats").innerHTML=
    `<div class="ytstat"><span class="k">Mense</span><span class="v">${actief.length}</span><span class="s">${actief.filter(m=>m.akkoord).length} met akkoord${arch.length?` · ${arch.length} in archief`:""}</span></div>`+
    `<div class="ytstat"><span class="k">Gepland</span><span class="v">${komend.length}</span><span class="s">${komend[0]&&komend[0].wanneer?"eâhste: "+esc(HP_DAG.format(new Date(komend[0].wanneer))):"nog niks in de agenda"}</span></div>`+
    `<div class="ytstat"><span class="k">Gepost</span><span class="v">${gepost.length}</span><span class="s">${HP.shoots.filter(s=>s.status==="geschoten").length} geschoten, nog nie gepost</span></div>`;

  // komende shoots
  let h=`<div class="card"><div class="cardhead"><div><h2>Komende shoots</h2><p class="sub">Alles met status gepland, eâhste bovenaan</p></div></div>`;
  h+=komend.length?`<div class="hplijst">${komend.map(s=>hpShootRij(s,nu)).join("")}</div>`:`<p class="sub">Nog geen shoots gepland. Tik op <b>+ Shoot</b>.</p>`;
  h+=`</div>`;

  // alle shoots met filter
  const tel={alles:HP.shoots.length,gepland:komend.length,geschoten:0,gepost:gepost.length};
  HP.shoots.forEach(s=>{if(s.status==="geschoten")tel.geschoten++});
  const lijst=HP.shoots.filter(s=>HP.filter==="alles"||s.status===HP.filter)
    .sort((a,b)=>(b.wanneer?Date.parse(b.wanneer):0)-(a.wanneer?Date.parse(a.wanneer):0));
  h+=`<div class="card"><div class="cardhead"><div><h2>Shoots</h2><p class="sub">Nieuwste bovenaan. Tik op de post voâh alle cijfâhs.</p></div>
    <div class="seg" id="hpFilter" role="group" aria-label="Filter shoots">${["alles","gepland","geschoten","gepost"].map(k=>
      `<button type="button" data-v="${k}" aria-pressed="${HP.filter===k}">${k==="alles"?"Allâh":HP_STATUS[k]} <span class="seg-n">${tel[k]}</span></button>`).join("")}</div></div>`;
  h+=lijst.length?`<div class="hpkaarten">${lijst.map(s=>hpShootKaart(s,nu)).join("")}</div>`:`<p class="sub">Niks met deze status.</p>`;
  h+=`</div>`;

  // mense
  h+=`<div class="card"><div class="cardhead"><div><h2>Mense</h2><p class="sub">Wie doet mee. E-mail en telefoon alleen met akkoord.</p></div></div>`;
  h+=actief.length?`<div class="hplijst">${actief.map(m=>hpPersoonRij(m,nu)).join("")}</div>`:`<p class="sub">Nog niemand. Tik op <b>+ Persoon</b>.</p>`;
  h+=`</div>`;

  // archief
  if(arch.length){
    h+=`<details class="card hparchief"><summary><h2>Archief <span class="seg-n">${arch.length}</span></h2><p class="sub">Contact gewist; naam, Insta en geposte shoots bewaard</p></summary><div class="hplijst">${arch.map(m=>{
      const sh=hpShootsVan(m.id);
      return `<div class="hprij arch"><div class="hprijin"><b>${esc(m.naam)}</b> ${hpInstaLink(m.insta)}
        <div class="sub">gewist ${m.gewist_om?esc(HP_DAGJ.format(new Date(m.gewist_om))):""}${sh.length?" · "+sh.map(s=>{const p=hpPost(s.media_id);
          return p&&p.permalink?`<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(s.plek)}</a>`:esc(s.plek)}).join(", "):""}</div></div>
        <button class="btn hpklein" type="button" data-hpalles="${esc(m.id)}">Alles wisse…</button></div>`}).join("")}</div>
      <p class="sub">\"Alles wisse\" is voâh als iemand vraagt om helemaal weg te weze (recht op vergetelheid). Geposte shoots blijven dan staan als \"gewiste persoon\".</p></details>`;
  }
  el.innerHTML=h;
}
function hpShootRij(s,nu){
  const t=s.wanneer?Date.parse(s.wanneer):null,voorbij=t&&t<nu-3*36e5;
  const m=hpPersoon(s.persoon_id);
  return `<div class="hprij"><div class="hpdatum${voorbij?" voorbij":""}">${s.wanneer?`<b>${esc(HP_DAG.format(new Date(s.wanneer)))}</b><span>${esc(HP_TIJD.format(new Date(s.wanneer)))}</span>`:`<b>?</b><span>geen datum</span>`}</div>
    <div class="hprijin"><b>${esc(s.plek)}</b><div class="sub">${m?esc(m.naam)+" "+hpInstaLink(m.insta):"nog niemand gekoppeld"}</div>
      <div class="hpchips">${voorbij?`<span class="chip warn">datum voorbij: geschoten?</span>`:""}<span class="chip mute">${HP_TEKST[s.tekst_status]}</span></div></div>
    <div class="hpknoppen"><a class="btn hpklein" href="${esc(hpKaartUrl(s))}" target="_blank" rel="noopener">Route</a>
      ${voorbij?`<button class="btn hpklein" type="button" data-hpgeschoten="${esc(s.id)}">Geschoten ✓</button>`:""}
      <button class="btn hpklein" type="button" data-hpshoot="${esc(s.id)}">Bewerke</button></div></div>`;
}
function hpShootKaart(s,nu){
  const m=hpPersoon(s.persoon_id),oud=s.status==="geschoten"&&s.wanneer&&Date.parse(s.wanneer)<nu-7*864e5;
  const st={gepland:"mute",geschoten:"warn",gepost:"good"}[s.status];
  const tekst=[s.caption&&"caption",s.story_tekst&&"storytekst"].filter(Boolean).join(" + ");
  return `<div class="hpkaart"><div class="hpkaartkop"><div><b>${esc(s.plek)}</b><div class="sub">${esc(hpDatum(s.wanneer))} · ${m?esc(m.naam)+" "+hpInstaLink(m.insta):esc(hpNaam(s))}</div></div>
      <button class="btn hpklein" type="button" data-hpshoot="${esc(s.id)}">Bewerke</button></div>
    <div class="hpchips"><span class="chip ${st}">${HP_STATUS[s.status]}</span><span class="chip mute">${HP_TEKST[s.tekst_status]}${tekst?" ("+tekst+")":""}</span>${oud?`<span class="chip warn">al een week geschoten, nog nie gepost</span>`:""}${s.status==="gepost"&&!s.media_id?`<span class="chip warn">kies de post</span>`:""}</div>
    ${hpPostHTML(s)}</div>`;
}
function hpPersoonRij(m,nu){
  const sh=hpShootsVan(m.id),stil=nu-hpLaatsteShoot(m)>HP_STIL_DAGEN*864e5&&(m.email||m.telefoon||m.notitie);
  return `<div class="hprij"><div class="hprijin"><b>${esc(m.naam)}</b> ${hpInstaLink(m.insta)}
      <div class="hpchips">${m.akkoord?`<span class="chip good">✓ akkoord ${m.akkoord_op?esc(dLabel(m.akkoord_op,true)):""}</span>`:`<span class="chip warn">nog geen akkoord</span>`}
      <span class="chip mute">${sh.length} shoot${sh.length===1?"":"s"}</span>${stil?`<span class="chip warn">al een jaar stil: contact wisse?</span>`:""}</div>
      ${m.notitie?`<div class="sub hpnotitie">${esc(m.notitie)}</div>`:""}</div>
    <div class="hpknoppen"><button class="btn hpklein" type="button" data-hppersoon="${esc(m.id)}">Bewerke</button></div></div>`;
}

/* ---------- formulieren (pop-up #hpPop) ---------- */
function hpOpen(soort,id,terug){
  HPF={soort,id:id||null,vuil:false,bevestig:null,terug:terug||document.activeElement,post:null,status:""};
  if(soort==="shoot"){const s=id&&HP.shoots.find(x=>x.id===id);HPF.post=s?s.media_id:null}
  $("hpPop").hidden=false;document.body.classList.add("popopen");
  hpFormTeken();
  const eerste=$("hpPop").querySelector("input:not([type=checkbox]),select,textarea");if(eerste)eerste.focus({preventScroll:true});
}
function hpDicht(force){
  if(!HPF)return;
  if(HPF.vuil&&!force){hpMeld("Nog nie opgeslagen. Tik op Opslaan, of op Annulere om weg te gaan zonder opslaan.",true);return}
  const t=HPF.terug;HPF=null;$("hpPop").hidden=true;$("hpForm").innerHTML="";
  if(![...document.querySelectorAll(".vnpop")].some(x=>!x.hidden))document.body.classList.remove("popopen");
  if(t&&t.isConnected&&t.focus)t.focus({preventScroll:true});
}
function hpMeld(t,fout){const e=$("hpMeld");if(!e)return;e.textContent=t||"";e.classList.toggle("fout",!!fout);e.hidden=!t}

function hpFormTeken(){
  if(!HPF)return;
  if(HPF.soort==="persoon")hpPersoonForm();else hpShootForm();
}
function hpPersoonForm(){
  const m=HPF.id?hpPersoon(HPF.id):null;
  $("hpTitel").textContent=m?"Persoon bewerke":"Nieuwe persoon";
  $("hpSub").textContent=m?`Toegevoegd ${HP_DAGJ.format(new Date(m.aangemaakt_om))}`:"Wie doet mee aan de serie?";
  const ak=m?m.akkoord:false;
  let h=`<form id="hpF" class="hpform" novalidate>
    <label>Naam <input name="naam" required maxlength="100" autocomplete="off" value="${esc(m?m.naam:"")}"></label>
    <label>Insta-naam <input name="insta" maxlength="31" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="zonder @" value="${esc(m&&m.insta||"")}"></label>
    <label>Notitie / verhaal <small>wat is hun plekkie, waarom</small><textarea name="notitie" rows="3" maxlength="3000">${esc(m&&m.notitie||"")}</textarea></label>
    <fieldset class="hpakkoord"><legend>Toestemming (AVG)</legend>
      <label class="hpvink"><input type="checkbox" name="akkoord" ${ak?"checked":""}> Akkoord gegeven om contactgegevens te bewaren</label>
      <div class="hptwee"><label>Datum akkoord <input type="date" name="akkoord_op" value="${esc(m&&m.akkoord_op||hpVandaag())}"></label>
      <label>Hoe <select name="akkoord_hoe">${Object.entries(HP_HOE).map(([k,v])=>`<option value="${k}" ${(m&&m.akkoord_hoe||"dm")===k?"selected":""}>${v}</option>`).join("")}</select></label></div>
      <div class="hptwee"><label>E-mail <input type="email" name="email" maxlength="200" autocomplete="off" value="${esc(m&&m.email||"")}"></label>
      <label>Telefoon <input type="tel" name="telefoon" maxlength="25" autocomplete="off" value="${esc(m&&m.telefoon||"")}"></label></div>
      <p class="sub hpzonder" id="hpZonder">Zonder akkoord bewaar je alleen naam, Insta-naam en notitie. E-mail en telefoon gaan pas open als je het vinkje zet.</p>
      <details class="hptoest"><summary>Tekstje om akkoord te vragen</summary><pre id="hpToestTekst">${esc(hpToestemming(m&&m.naam))}</pre>
        <button class="btn hpklein" type="button" id="hpKopieer">Kopieer tekstje</button></details>
    </fieldset>`;
  if(HPF.bevestig==="contact"){
    const n=m?hpShootsVan(m.id).filter(s=>s.status!=="gepost").length:0;
    h+=`<div class="hpbevestig" role="alert"><b>Contact van ${esc(m.naam)} wisse?</b>
      <ul><li><b>Weg:</b> e-mail, telefoon en notitie${n?`, en ${n} shoot${n===1?"":"s"} die nooit gepost ${n===1?"is":"zijn"}`:""}.</li>
      <li><b>Blijft:</b> naam, Insta-naam en de geposte shoots met link naar de post (in het Archief).</li></ul>
      <div class="hpformknop"><button class="btn rood" type="button" id="hpJaWis">Ja, wisse</button><button class="btn" type="button" id="hpNeeWis">Nee, toch nie</button></div></div>`;
  }
  h+=`<p class="hpmeld" id="hpMeld" role="status" hidden></p>
    <div class="hpformknop"><button class="btn yellow" type="submit">Opslaan</button><button class="btn" type="button" id="hpAnnuleer">Annulere</button>
      ${m&&!HPF.bevestig?`<button class="btn rood hprechts" type="button" id="hpWisContact">Contact wisse…</button>`:""}</div></form>`;
  $("hpForm").innerHTML=h;
  hpAkkoordVelden();
}
function hpAkkoordVelden(){
  const f=$("hpF");if(!f||!f.akkoord)return;const aan=f.akkoord.checked;
  ["akkoord_op","akkoord_hoe","email","telefoon"].forEach(k=>{f[k].disabled=!aan});
  $("hpZonder").hidden=aan;
}
function hpShootForm(){
  const s=HPF.id?HP.shoots.find(x=>x.id===HPF.id):null;
  $("hpTitel").textContent=s?"Shoot bewerke":"Nieuwe shoot";
  $("hpSub").textContent=s?`Toegevoegd ${HP_DAGJ.format(new Date(s.aangemaakt_om))}`:"Waar en wanneer?";
  const w=hpDelen(s&&s.wanneer);
  const opties=HP.mensen.filter(m=>!m.archief||(s&&m.id===s.persoon_id));
  let h=`<form id="hpF" class="hpform" novalidate>
    <label>Wie <select name="persoon_id"><option value="">— nog niemand —</option>${opties.map(m=>`<option value="${esc(m.id)}" ${s&&s.persoon_id===m.id?"selected":""}>${esc(m.naam)}${m.insta?" (@"+esc(m.insta)+")":""}</option>`).join("")}</select></label>
    <label>Plek <input name="plek" required maxlength="200" autocomplete="off" placeholder="bijv. Pier, Kurhaus, Westbroekpark" value="${esc(s?s.plek:"")}"></label>
    <label>Kaart-link <small>mag leeg: dan zoekt Route op de naam van de plek</small><input name="kaart_link" type="url" maxlength="1000" autocomplete="off" placeholder="https://maps.apple.com/…" value="${esc(s&&s.kaart_link||"")}"></label>
    <button class="btn hpklein" type="button" id="hpZoekKaart">Zoek plek op de kaart ↗</button>
    <div class="hptwee"><label>Datum <input type="date" name="d" value="${esc(w.d)}"></label><label>Tijd <input type="time" name="t" value="${esc(w.t)}"></label></div>
    <label>Status <select name="status">${Object.entries(HP_STATUS).map(([k,v])=>`<option value="${k}" ${(s?s.status:"gepland")===k?"selected":""}>${v}</option>`).join("")}</select></label>
    <label>Caption <small>tekst onder de post</small><textarea name="caption" rows="4" maxlength="5000">${esc(s&&s.caption||"")}</textarea></label>
    <label>Storyteksten <small>bijv. één regel per scène</small><textarea name="story_tekst" rows="3" maxlength="5000">${esc(s&&s.story_tekst||"")}</textarea></label>
    <label>Tekst is <select name="tekst_status">${Object.entries(HP_TEKST).map(([k,v])=>`<option value="${k}" ${(s?s.tekst_status:"idee")===k?"selected":""}>${v.replace("Tekst: ","")}</option>`).join("")}</select></label>
    <fieldset class="hppostkies"><legend>Post</legend><div id="hpPostKies"></div></fieldset>`;
  if(HPF.bevestig==="shoot")h+=`<div class="hpbevestig" role="alert"><b>Deze shoot wisse?</b><p class="sub">De shoot en z'n teksten gaan weg. De post op Insta blijft natuurlijk gewoon staan.</p>
      <div class="hpformknop"><button class="btn rood" type="button" id="hpJaWis">Ja, wisse</button><button class="btn" type="button" id="hpNeeWis">Nee, toch nie</button></div></div>`;
  h+=`<p class="hpmeld" id="hpMeld" role="status" hidden></p>
    <div class="hpformknop"><button class="btn yellow" type="submit">Opslaan</button><button class="btn" type="button" id="hpAnnuleer">Annulere</button>
      ${s&&!HPF.bevestig?`<button class="btn rood hprechts" type="button" id="hpWisShoot">Shoot wisse…</button>`:""}</div></form>`;
  $("hpForm").innerHTML=h;
  hpPostKiesTeken();
}
// post kiezen: recente posts, die bij deze persoon lijken te horen bovenaan
function hpPostKiesTeken(){
  const f=$("hpF"),el=$("hpPostKies");if(!f||!el)return;
  const m=hpPersoon(f.persoon_id.value),insta=m&&m.insta;
  const van=f.d.value?Date.parse(hpVanDelen(f.d.value,"00:00"))-864e5:null;
  let posts=(IG.posts||[]).filter(p=>soortGroep(p)!=="story"&&p.gepost_om).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));
  const lijkt=p=>{if(!insta)return false;
    if(van&&Date.parse(p.gepost_om)<van)return false;
    const b=String(p.bijschrift||"").toLowerCase();
    return b.includes("@"+insta)||(typeof igPartnersVan==="function"&&igPartnersVan(p).includes(insta))};
  const top=posts.filter(lijkt).slice(0,5);
  const alleRest=posts.filter(p=>!top.includes(p)).slice(0,HP_POST_KEUZE),rest=HPF.pkAlles?alleRest:alleRest.slice(0,HP_POST_EERST);   // altijd je laatste posts (ook als de datum van de shoot nie klopt)
  const gekozen=HPF.post?posts.find(p=>p.media_id===HPF.post):null;
  const knop=(p,tag)=>`<button type="button" class="hppk${HPF.post===p.media_id?" aan":""}" data-hppk="${esc(p.media_id)}" aria-pressed="${HPF.post===p.media_id}">
      <span class="igthumb hpthumb">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span>
      <span class="hppktxt"><b>${esc(HP_DAG.format(new Date(p.gepost_om)))}</b> · ${esc(IG_GROEPEN[soortGroep(p)].een)}${tag?` <span class="chip good">${tag}</span>`:""}<br><small>${esc(String(p.bijschrift||"").split("\n")[0].slice(0,70))}</small></span></button>`;
  let h=HPF.post?`<p class="sub">Gekozen: ${gekozen?esc(HP_DAG.format(new Date(gekozen.gepost_om))):esc(HPF.post)} <button class="btn hpklein" type="button" id="hpGeenPost">Geen post</button></p>`:`<p class="sub">Nog geen post gekoppeld. Kies hieronder${insta?` (posts met @${esc(insta)} erin of als partnâh staan bovenaan)`:""}.</p>`;
  if(gekozen&&!top.includes(gekozen)&&!rest.includes(gekozen))h+=knop(gekozen);
  h+=top.map(p=>knop(p,"lijkt deze")).join("")+rest.map(p=>knop(p)).join("");
  if(rest.length<alleRest.length)h+=`<button class="btn hpklein" type="button" id="hpPkMeer">Toon meer posts (${alleRest.length-rest.length})</button>`;
  if(!top.length&&!rest.length)h+=`<p class="sub">Nog geen Insta-posts geladen.</p>`;
  el.innerHTML=`<div class="hppklijst">${h}</div>`;
}

/* ---------- opslaan / wissen ---------- */
async function hpOpslaan(){
  const f=$("hpF");if(!f)return;
  const leeg=v=>{v=String(v||"").trim();return v===""?null:v};
  let rij,tabel;
  if(HPF.soort==="persoon"){
    const ak=f.akkoord.checked;
    rij={naam:leeg(f.naam.value),insta:leeg(hpInsta(f.insta.value)),notitie:leeg(f.notitie.value),akkoord:ak,
      akkoord_op:ak?leeg(f.akkoord_op.value):null,akkoord_hoe:ak?f.akkoord_hoe.value:null,
      email:ak?leeg(f.email.value):null,telefoon:ak?leeg(f.telefoon.value):null};
    if(!rij.naam)return hpMeld("Vul een naam in.",true);
    if(rij.insta&&!/^[a-z0-9._]{1,30}$/.test(rij.insta))return hpMeld("Insta-naam: alleen kleine letters, cijfers, punt en _ (max 30).",true);
    if(ak&&!rij.akkoord_op)return hpMeld("Vul de datum van het akkoord in.",true);
    const oud=HPF.id&&hpPersoon(HPF.id);
    if(oud&&!ak&&(oud.email||oud.telefoon)&&!HPF.okZonder){HPF.okZonder=true;return hpMeld("Vinkje akkoord staat uit: e-mail en telefoon worden dan gewist. Tik nog een keer op Opslaan om door te gaan.",true)}
    tabel="hp_mensen";
  }else{
    rij={persoon_id:leeg(f.persoon_id.value),plek:leeg(f.plek.value),kaart_link:leeg(f.kaart_link.value),
      wanneer:hpVanDelen(f.d.value,f.t.value),status:f.status.value,caption:leeg(f.caption.value),
      story_tekst:leeg(f.story_tekst.value),tekst_status:f.tekst_status.value,media_id:HPF.post||null};
    if(!rij.plek)return hpMeld("Vul de plek in.",true);
    if(rij.kaart_link&&!/^https:\/\//.test(rij.kaart_link))return hpMeld("Kaart-link moet met https:// beginnen.",true);
    tabel="hp_shoots";
  }
  hpMeld("Effe opslaan…");
  const knop=f.querySelector("button[type=submit]");knop.disabled=true;
  try{
    const r=HPF.id?await sb.from(tabel).update(rij).eq("id",HPF.id):await sb.from(tabel).insert(rij);
    if(r.error)throw r.error;
  }catch(e){knop.disabled=false;return hpMeld(hpFout(e),true)}
  HPF.vuil=false;hpDicht(true);await hpHerlaad();
}
async function hpWis(soort){
  const id=HPF&&HPF.id;if(!id)return;hpMeld("Effe wisse…");
  try{
    const r=soort==="shoot"?await sb.from("hp_shoots").delete().eq("id",id):await sb.rpc("hp_contact_wissen",{p_id:id});
    if(r.error)throw r.error;
  }catch(e){return hpMeld(hpFout(e),true)}
  HPF.vuil=false;hpDicht(true);await hpHerlaad();
}
async function hpAllesWissen(id,knop){
  const m=hpPersoon(id);if(!m)return;
  if(knop.dataset.zeker!=="1"){knop.dataset.zeker="1";knop.textContent=`Zeker? ${m.naam} helemaal wisse`;knop.classList.add("rood");return}
  knop.disabled=true;
  try{const r=await sb.rpc("hp_alles_wissen",{p_id:id});if(r.error)throw r.error}
  catch(e){knop.disabled=false;knop.textContent="Lukte nie: "+hpFout(e);return}
  await hpHerlaad();
}
async function hpHerlaad(){HP.geladen=false;await hpLaden();if(sectie==="plekkies")renderPlekkies()}
async function hpSnelGeschoten(id,knop){
  knop.disabled=true;
  try{const r=await sb.from("hp_shoots").update({status:"geschoten"}).eq("id",id);if(r.error)throw r.error}
  catch(e){knop.disabled=false;knop.textContent="Lukte nie";knop.title=hpFout(e);return}
  await hpHerlaad();
}

/* ---------- klikken en typen ---------- */
document.addEventListener("click",e=>{
  const t=e.target;if(!t.closest)return;
  if(t.closest("#hpNieuwPersoon"))return hpOpen("persoon",null,t.closest("button"));
  if(t.closest("#hpNieuwShoot"))return hpOpen("shoot",null,t.closest("button"));
  const fb=t.closest("#hpFilter button");if(fb){HP.filter=fb.dataset.v;renderPlekkies();return}
  const ps=t.closest("[data-hppersoon]");if(ps)return hpOpen("persoon",ps.dataset.hppersoon,ps);
  const sh=t.closest("[data-hpshoot]");if(sh)return hpOpen("shoot",sh.dataset.hpshoot,sh);
  const ge=t.closest("[data-hpgeschoten]");if(ge)return hpSnelGeschoten(ge.dataset.hpgeschoten,ge);
  const al=t.closest("[data-hpalles]");if(al)return hpAllesWissen(al.dataset.hpalles,al);
  if(!HPF)return;
  if(t.closest("#hpDicht")||t.closest("#hpAnnuleer"))return hpDicht(!!t.closest("#hpAnnuleer"));
  if(t.closest("#hpWisContact")){HPF.bevestig="contact";hpBewaarInvoer(hpFormTeken);return}
  if(t.closest("#hpWisShoot")){HPF.bevestig="shoot";hpBewaarInvoer(hpFormTeken);return}
  if(t.closest("#hpNeeWis")){HPF.bevestig=null;hpBewaarInvoer(hpFormTeken);return}
  if(t.closest("#hpJaWis"))return hpWis(HPF.soort==="shoot"?"shoot":"contact");
  if(t.closest("#hpZoekKaart")){const f=$("hpF");const q=(f.plek.value.trim()||"Den Haag")+", Den Haag";window.open("https://maps.apple.com/?q="+encodeURIComponent(q),"_blank","noopener");return}
  if(t.closest("#hpKopieer")){const txt=$("hpToestTekst").textContent;const b=t.closest("#hpKopieer");
    (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>{b.textContent="Gekopieerd ✓"},()=>{b.textContent="Kopiëren lukte nie: selecteer de tekst"});return}
  if(t.closest("#hpPkMeer")){HPF.pkAlles=true;hpPostKiesTeken();return}
  if(t.closest("#hpGeenPost")){HPF.post=null;HPF.vuil=true;hpPostKiesTeken();return}
  const pk=t.closest("[data-hppk]");
  if(pk){HPF.post=pk.dataset.hppk;HPF.vuil=true;const f=$("hpF");
    if(f.status.value!=="gepost"){f.status.value="gepost";f.tekst_status.value="gepost";hpMeld("Status op Gepost gezet (pas aan als dat nie klopt).")}
    hpPostKiesTeken();return}
});
// formulier opnieuw tekenen zonder getypte tekst kwijt te raken
function hpBewaarInvoer(teken){
  const f=$("hpF"),w={};if(f)[...f.elements].forEach(x=>{if(x.name)w[x.name]=x.type==="checkbox"?x.checked:x.value});
  teken();const g=$("hpF");if(!g)return;
  [...g.elements].forEach(x=>{if(x.name&&x.name in w){if(x.type==="checkbox")x.checked=w[x.name];else x.value=w[x.name]}});
  if(HPF&&HPF.soort==="persoon")hpAkkoordVelden();else hpPostKiesTeken();
  const b=$("hpPop").querySelector(".hpbevestig");if(b)b.scrollIntoView({block:"nearest"});
}
document.addEventListener("submit",e=>{if(e.target.id==="hpF"){e.preventDefault();hpOpslaan()}});
document.addEventListener("input",e=>{
  if(!HPF||!e.target.closest("#hpF"))return;HPF.vuil=true;HPF.okZonder=false;
  const n=e.target.name;
  if(n==="akkoord")hpAkkoordVelden();
  if(n==="naam"&&HPF.soort==="persoon"){const p=$("hpToestTekst");if(p)p.textContent=hpToestemming(e.target.value.trim())}
  if(HPF.soort==="shoot"&&(n==="persoon_id"||n==="d"))hpPostKiesTeken();
});
document.addEventListener("keydown",e=>{
  if(!HPF||$("hpPop").hidden)return;
  if(typeof PD!=="undefined"&&PD)return;                        // post-pop-up ligt erbovenop: die sluit eerst
  if(e.key==="Escape"){e.preventDefault();hpDicht()}
});
