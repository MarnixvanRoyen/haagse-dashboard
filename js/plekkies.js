// plekkies.js — tab Plekkies: serie "Haagse plekkies doâh Haagse mense" (15-10-2026, chat 50)
// Eén KAART per plekkie = één persoon + één plek + één shoot (+ tekst en de post). Eén formulier voor alles.
//
// Data: Supabase-tabellen hp_mensen en hp_shoots (32_plekkies.sql), alleen voor Marnix (RLS is_marnix + eigen rijen).
// Een kaart = één regel in hp_mensen + één regel in hp_shoots (persoon_id). Opslaan schrijft ze allebei.
// Privacy (AVG):
//  * persoonsgegevens alleen in Supabase: NIET in localStorage/sessionStorage, NIET in de console, NIET in exports.
//    Foutmeldingen tonen alleen error.message (nooit error.details: daar kan Postgres de hele rij in zetten).
//  * e-mail/telefoon alleen met akkoord (de database weigert het anders ook).
//  * "Contact wisse" (rpc hp_contact_wissen): e-mail, telefoon, notitie weg → Archief (naam + Insta + geposte shoot blijven);
//    is de shoot nog nie gepost, dan gaat die mee weg.
//  * "Kaart wisse": shoot weg + persoon helemaal weg (rpc hp_alles_wissen).
//  * Archief → "Alles wisse" (rpc hp_alles_wissen): persoon helemaal weg; een geposte shoot blijft als "gewiste persoon".
// Post-cijfers: alleen bestaande functies (pdEind uit postdetail.js; igNormaalEind, igPartnersVan uit insta.js).
// Tik op het postje in een regel = de pop-up "Post in detail" van chat 44 (via data-pd; postdetail.js regelt de klik).
// Knop ♥ Bedankje bij een geposte kaart (16-10-2026, chat 50.3): story-bedankkaart, zie js/plekbedank.js.
// Route/kaart-link weggehaald (16-10-2026, chat 50.1). De kolom kaart_link blijft in hp_shoots staan, maar het dashboard leest en schrijft hem nie meer.

let HP={mensen:[],shoots:[],geladen:false,laden:null,err:null,filter:"alles"};
let HPF=null;   // open formulier: {mid, sid, vuil, bevestig, post, terug, okZonder}
const HP_STIL_DAGEN=365;      // zo lang geen shoot → vraag of het contact gewist mag worden
const HP_POST_KEUZE=30;       // zoveel posts in de keuzelijst Post
const HP_TZ="Europe/Amsterdam";
const HP_DAG=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,weekday:"short",day:"numeric",month:"short"});
const HP_DAGJ=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,weekday:"short",day:"numeric",month:"short",year:"numeric"});
const HP_TIJD=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,hour:"2-digit",minute:"2-digit"});
const HP_DELEN=new Intl.DateTimeFormat("en-CA",{timeZone:HP_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const HP_STATUS={te_plannen:"Te plannen",gepland:"Gepland",geschoten:"Geschoten",gepost:"Gepost"};   // volgorde = volgorde van de knoppen (33_plekkies_te_plannen.sql)
const HP_STATUS_KL={te_plannen:"mute",gepland:"lb",geschoten:"warn",gepost:"good"};
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
  if(/status_check/.test(m))return "Status \"Te plannen\" kent de database nog nie: draai eerst 33_plekkies_te_plannen.sql.";
  if(/naam_check|plek_check/.test(m))return "Naam en plek mogen nie leeg zijn.";
  if(/Alleen voor Marnix|row-level security|permission denied/i.test(m))return "Geen toegang (alleen voor Marnix).";
  return m.length>160?m.slice(0,160)+"…":m;
}

/* ---------- kaarten: persoon + shoot samen ---------- */
// elke shoot is een kaart (met z'n persoon); een persoon zonder shoot is ook een kaart (bijv. als het opslaan van de shoot mislukte)
function hpKaarten(){
  const metShoot=new Set(),k=HP.shoots.map(s=>{if(s.persoon_id)metShoot.add(s.persoon_id);return {m:HP.mensen.find(m=>m.id===s.persoon_id)||null,s}});
  HP.mensen.forEach(m=>{if(!metShoot.has(m.id))k.push({m,s:null})});
  return k;
}
const hpKaartVan=(mid,sid)=>hpKaarten().find(k=>(sid&&k.s&&k.s.id===sid)||(!sid&&mid&&k.m&&k.m.id===mid))||null;
const hpStatus=k=>k.s?k.s.status:"te_plannen";
const hpPost=id=>id&&(IG.posts||[]).find(p=>p.media_id===id)||null;
const hpTijd=k=>k.s&&k.s.wanneer?Date.parse(k.s.wanneer):null;

/* ---------- hulpjes ---------- */
function hpDatum(ts){if(!ts)return "nog geen datum";const d=new Date(ts);
  return (Math.abs(Date.now()-d)>300*864e5?HP_DAGJ:HP_DAG).format(d)+" · "+HP_TIJD.format(d)}
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
const hpUuid=()=>(window.crypto&&crypto.randomUUID)?crypto.randomUUID():"10000000-1000-4000-8000-100000000000".replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));

/* ---------- toestemmingstekst (om te sturen, plat Haags) ---------- */
function hpToestemming(naam){
  return `Hoi ${naam||"daâh"}! Leuk dat je mee wil doen aan Haagse plekkies doâh Haagse mense 💛💚\n`+
    `Om de shoot te plannen bewaar ik je naam, Insta-naam, e-mail en telefoonnummâh. Alleen voâh mèzelf, ik deel het met niemand.\n`+
    `Ben je akkoord? Stuur dan effe "akkoord" terug.\n`+
    `Wil je latâh dat ik je gegevens wis? Eén berichie is genoeg, dan haal ik ze weg.\n`+
    `Groetjes, Marnix (@the_hague_beachlife)`;
}

/* ---------- tekenen ---------- */
async function renderPlekkies(){
  const el=$("hpInhoud");if(!el)return;
  if(!HP.geladen){el.innerHTML=`<p class="sub">Effe ophale…</p>`;await hpLaden();if(sectie!=="plekkies")return}
  if(HP.err){el.innerHTML=`<div class="card binnenkort"><h2>Plekkies</h2><p class="kd">Lukte nie, âhwe</p><p class="sub">${esc(HP.err)}</p></div>`;$("hpStats").innerHTML="";return}
  const nu=Date.now(),alle=hpKaarten();
  const actief=alle.filter(k=>!(k.m&&k.m.archief)),arch=alle.filter(k=>k.m&&k.m.archief);
  const komend=actief.filter(k=>hpStatus(k)==="gepland").sort((a,b)=>(hpTijd(a)??9e15)-(hpTijd(b)??9e15));
  const tel={alles:actief.length,te_plannen:0,gepland:komend.length,geschoten:0,gepost:0};
  actief.forEach(k=>{const st=hpStatus(k);if(st!=="gepland")tel[st]++});
  // tegeltjes = filter (tik = alleen die status; nog een keer tikken = weer allâh)
  const komendTxt=komend[0]&&hpTijd(komend[0])?"eâhste: "+esc(HP_DAG.format(new Date(hpTijd(komend[0])))):"niks in de agenda";
  const SUB={alles:`${actief.filter(k=>k.m&&k.m.akkoord).length} met akkoord${arch.length?` · ${arch.length} in archief`:""}`,te_plannen:"nog geen datum",gepland:komendTxt,geschoten:"nog nie gepost",gepost:"online"};
  $("hpStats").innerHTML=["alles",...Object.keys(HP_STATUS)].map(k=>
    `<button type="button" class="ytstat hptegel${HP.filter===k?" aan":""}" data-hpf="${k}" aria-pressed="${HP.filter===k}"><span class="k">${k==="alles"?"Allâh":HP_STATUS[k]}</span><span class="v">${tel[k]}</span><span class="s">${SUB[k]}</span></button>`).join("");

  // één lijst: gepland (eerstvolgende bovenaan) · te plannen · geschoten · gepost (nieuwste bovenaan)
  const VOLG={gepland:0,te_plannen:1,geschoten:2,gepost:3};
  const wanneer=k=>hpTijd(k)??Date.parse((k.s||k.m).aangemaakt_om);
  const lijst=actief.filter(k=>HP.filter==="alles"||hpStatus(k)===HP.filter).sort((a,b)=>{
    const sa=hpStatus(a),sb=hpStatus(b);if(sa!==sb)return VOLG[sa]-VOLG[sb];
    return sa==="gepland"?(hpTijd(a)??9e15)-(hpTijd(b)??9e15):wanneer(b)-wanneer(a)});
  let h=`<div class="card hplijstkaart">`;
  h+=lijst.length?`<div class="hplijst">${lijst.map(k=>hpKaart(k,nu)).join("")}</div>`:`<p class="sub">${actief.length?"Niks met deze status.":"Nog geen plekkies. Tik op <b>+ Plekkie</b>."}</p>`;
  h+=`</div>`;

  // archief
  if(arch.length){
    h+=`<details class="card hparchief"><summary><h2>Archief <span class="seg-n">${arch.length}</span></h2><p class="sub">Contact gewist; naam, Insta, plek en post bewaard</p></summary><div class="hplijst">${arch.map(k=>{
      const p=k.s&&hpPost(k.s.media_id);
      return `<div class="hprij arch"><div class="hprijin"><b>${esc(k.m.naam)}</b> ${hpInstaLink(k.m.insta)}
        <div class="sub">${k.s?(p&&p.permalink?`<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(k.s.plek)}</a>`:esc(k.s.plek))+" · ":""}gewist ${k.m.gewist_om?esc(HP_DAGJ.format(new Date(k.m.gewist_om))):""}</div></div>
        <div class="hpknoppen"><button class="btn hpklein" type="button" data-hpalles="${esc(k.m.id)}">Alles wisse…</button></div></div>`}).join("")}</div>
      <p class="sub">"Alles wisse" is voâh als iemand vraagt om helemaal weg te weze. Een geposte shoot blijft dan staan als "gewiste persoon".</p></details>`;
  }
  el.innerHTML=h;
}
const HP_DAGKORT=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,day:"numeric",month:"short"});
const HP_WD=new Intl.DateTimeFormat("nl-NL",{timeZone:HP_TZ,weekday:"short"});
// één regel per plekkie: datum · plek + wie + labels · (postje) · knoppen. Tik op de regel = bewerke.
// Telefoon (< 700 px): alleen de status + één waarschuwing; de rest (tekst, akkoord) staat in het formulier.
function hpKaart(k,nu){
  const s=k.s,m=k.m,st=hpStatus(k),t=hpTijd(k);
  const voorbij=st==="gepland"&&t&&t<nu-3*36e5;
  const lo=[];   // waarschuwingen: [lang, kort]
  if(voorbij)lo.push(["datum voorbij: geschoten?","geschoten?"]);
  if(st==="geschoten"&&t&&t<nu-7*864e5)lo.push(["al een week geschoten, nog nie gepost","nog nie gepost"]);
  if(st==="gepost"&&!(s&&s.media_id))lo.push(["kies de post","kies de post"]);
  if(m&&(m.email||m.telefoon||m.notitie)&&nu-(t||Date.parse(m.aangemaakt_om))>HP_STIL_DAGEN*864e5)lo.push(["al een jaar stil: contact wisse?","contact wisse?"]);
  if(m&&!m.akkoord&&st!=="gepost")lo.push(["nog geen akkoord","geen akkoord"]);
  const p=s&&hpPost(s.media_id);
  let mini="";
  if(p){const E=typeof pdEind==="function"?pdEind(p):null,N=igNormaalEind(p),x=E&&N.genoeg&&N.waarde>0?E.eind/N.waarde:null;
    mini=`<div class="hpmini" data-pd="${esc(p.media_id)}" tabindex="0" role="button" aria-label="Post in detail bekijken" title="Post in detail">
      <span class="igthumb hpthumb">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span>
      <span><b>${E?nf0.format(Math.round(E.eind)):"—"}</b><small><span class="pc">bereik · </span>${x!=null?`<span class="${x>=1.25?"goed":x<=0.8?"laag":""}">${HP_NF1.format(x)}×</span><span class="pc"> normaal</span>`:""}</small></span></div>`}
  else if(s&&s.media_id)mini=`<div class="hpmini leeg"><small>post?</small></div>`;
  const wie=m?`${esc(m.naam)}${m.insta?` · @${esc(m.insta)}`:""}`:`<i>gewiste persoon</i>`;
  const naam=s?esc(s.plek):"<i>nog geen plek</i>";
  return `<div class="hprij hpregel" data-hpkaart="${esc(s?s.id:"")}" data-hpm="${esc(m?m.id:"")}" tabindex="0" role="button" aria-label="Plekkie ${naam.replace(/<[^>]+>/g,"")} bewerke">
    <div class="hpdatum${voorbij?" voorbij":""}">${t?`<b>${esc(HP_DAGKORT.format(new Date(t)))}</b><span>${esc(HP_WD.format(new Date(t)))} ${esc(HP_TIJD.format(new Date(t)))}</span>`:`<b>—</b><span>geen datum</span>`}</div>
    <div class="hprijin"><div class="hpr1"><b>${naam}</b><span class="sub hpwie">${wie}</span></div>
      <div class="hpchips"><span class="chip ${HP_STATUS_KL[st]}">${HP_STATUS[st]}</span>
        ${s?`<span class="chip mute pc">${HP_TEKST[s.tekst_status]}</span>`:""}${m&&m.akkoord?`<span class="chip good pc">✓ akkoord</span>`:""}
        ${lo.map(w=>`<span class="chip warn pc">${w[0]}</span>`).join("")}
        ${lo.length?`<span class="chip warn tel">${lo[0][1]}${lo.length>1?` +${lo.length-1}`:""}</span>`:""}</div></div>
    <div class="hpacties">${mini}
      ${typeof pbKan==="function"&&pbKan(k)?`<button class="btn hpklein hpbedank" type="button" data-hpbedank="${esc(s.id)}" title="Bedankkaart maken" aria-label="Bedankkaart voor ${esc(m.naam)}">♥<span class="pc">&nbsp;Bedankje</span></button>`:""}
      ${voorbij?`<button class="btn hpklein" type="button" data-hpgeschoten="${esc(s.id)}" title="Markeer als geschoten">✓<span class="pc">&nbsp;Geschoten</span></button>`:""}
      <span class="hppijl" aria-hidden="true">›</span></div></div>`;
}

/* ---------- formulier (pop-up #hpPop): één kaart = wie + toestemming + waar/wanneer + tekst + post ---------- */
function hpOpen(sid,mid,terug){
  const k=sid||mid?hpKaartVan(mid,sid):null;
  HPF={mid:k&&k.m?k.m.id:null,sid:k&&k.s?k.s.id:null,vuil:false,bevestig:null,terug:terug||document.activeElement,post:k&&k.s?k.s.media_id:null,okZonder:false};
  $("hpPop").hidden=false;document.body.classList.add("popopen");
  hpFormTeken();
  const eerste=$("hpPop").querySelector("#hpF input[name=naam]");if(eerste)eerste.focus({preventScroll:true});
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
  const m=HPF.mid?HP.mensen.find(x=>x.id===HPF.mid):null,s=HPF.sid?HP.shoots.find(x=>x.id===HPF.sid):null;
  const nieuw=!m&&!s;
  $("hpTitel").textContent=nieuw?"Nieuw plekkie":(s?s.plek:"Plekkie")+(m?" · "+m.naam:"");
  $("hpSub").textContent=nieuw?"Wie, waâh, wanneer, tekst en post: alles op één kaart":`Toegevoegd ${HP_DAGJ.format(new Date((s||m).aangemaakt_om))}`;
  const w=hpDelen(s&&s.wanneer),ak=m?m.akkoord:false;
  const st0=s?s.status:"te_plannen";
  let h=`<form id="hpF" class="hpform" novalidate>
    <fieldset class="hpstatusveld"><legend>Status</legend><input type="hidden" name="status" value="${st0}">
      <div class="seg hpstatus" id="hpStatus" role="radiogroup" aria-label="Status">${Object.entries(HP_STATUS).map(([k,v])=>
        `<button type="button" role="radio" data-hpst="${k}" aria-checked="${st0===k}" aria-pressed="${st0===k}">${v}</button>`).join("")}</div>
    </fieldset>
    <fieldset><legend>Wie</legend>
      ${m||nieuw?`<label>Naam <input name="naam" required maxlength="100" autocomplete="off" value="${esc(m?m.naam:"")}"></label>
      <label>Insta-naam <input name="insta" maxlength="31" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="zonder @" value="${esc(m&&m.insta||"")}"></label>
      <label>Verhaal <small>wat is hun plekkie, waarom</small><textarea name="notitie" rows="3" maxlength="3000">${esc(m&&m.notitie||"")}</textarea></label>`
      :`<p class="sub">Gewiste persoon: alleen de plek en de post zijn bewaard.</p>`}
    </fieldset>
    ${m||nieuw?`<fieldset class="hpakkoord"><legend>Toestemming (AVG)</legend>
      <label class="hpvink"><input type="checkbox" name="akkoord" ${ak?"checked":""}> Akkoord gegeven om contactgegevens te bewaren</label>
      <div class="hptwee"><label>Datum akkoord <input type="date" name="akkoord_op" value="${esc(m&&m.akkoord_op||hpVandaag())}"></label>
      <label>Hoe <select name="akkoord_hoe">${Object.entries(HP_HOE).map(([k,v])=>`<option value="${k}" ${(m&&m.akkoord_hoe||"dm")===k?"selected":""}>${v}</option>`).join("")}</select></label></div>
      <div class="hptwee"><label>E-mail <input type="email" name="email" maxlength="200" autocomplete="off" value="${esc(m&&m.email||"")}"></label>
      <label>Telefoon <input type="tel" name="telefoon" maxlength="25" autocomplete="off" value="${esc(m&&m.telefoon||"")}"></label></div>
      <p class="sub hpzonder" id="hpZonder">Zonder akkoord bewaar je alleen naam, Insta-naam en verhaal. E-mail en telefoon gaan pas open als je het vinkje zet.</p>
      <details class="hptoest"><summary>Tekstje om akkoord te vragen</summary><pre id="hpToestTekst">${esc(hpToestemming(m&&m.naam))}</pre>
        <button class="btn hpklein" type="button" id="hpKopieer">Kopieer tekstje</button></details>
    </fieldset>`:""}
    <fieldset><legend>Waâh en wanneer</legend>
      <label>Plek <input name="plek" required maxlength="200" autocomplete="off" placeholder="bijv. Pier, Kurhaus, Westbroekpark" value="${esc(s?s.plek:"")}"></label>
      <div class="hptwee"><label>Datum <input type="date" name="d" value="${esc(w.d)}"></label><label>Tijd <input type="time" name="t" value="${esc(w.t)}"></label></div>
    </fieldset>
    <fieldset><legend>Tekst</legend>
      <label>Caption <small>tekst onder de post</small><textarea name="caption" rows="4" maxlength="5000">${esc(s&&s.caption||"")}</textarea></label>
      <label>Storyteksten <small>bijv. één regel per scène</small><textarea name="story_tekst" rows="3" maxlength="5000">${esc(s&&s.story_tekst||"")}</textarea></label>
      <label>Tekst is <select name="tekst_status">${Object.entries(HP_TEKST).map(([k,v])=>`<option value="${k}" ${(s?s.tekst_status:"idee")===k?"selected":""}>${v.replace("Tekst: ","")}</option>`).join("")}</select></label>
    </fieldset>
    <fieldset class="hppostkies"><legend>Post</legend><div id="hpPostKies"></div></fieldset>`;
  if(HPF.bevestig==="contact"){
    const weg=s&&s.status!=="gepost";
    h+=`<div class="hpbevestig" role="alert"><b>Contact van ${esc(m.naam)} wisse?</b>
      <ul><li><b>Weg:</b> e-mail, telefoon en verhaal${weg?", én deze shoot (die is nog nie gepost)":""}.</li>
      <li><b>Blijft:</b> naam, Insta-naam${weg?"":", plek en de post"}, in het Archief onderaan.</li></ul>
      <div class="hpformknop"><button class="btn rood" type="button" id="hpJaWis">Ja, wisse</button><button class="btn" type="button" id="hpNeeWis">Nee, toch nie</button></div></div>`;
  }
  if(HPF.bevestig==="kaart")h+=`<div class="hpbevestig" role="alert"><b>Hele kaart wisse?</b><p class="sub">${m?esc(m.naam)+" (met contactgegevens), ":""}de plek, de datum en de teksten gaan weg. De post op Insta blijft natuurlijk gewoon staan.</p>
      <div class="hpformknop"><button class="btn rood" type="button" id="hpJaWis">Ja, wisse</button><button class="btn" type="button" id="hpNeeWis">Nee, toch nie</button></div></div>`;
  h+=`<p class="hpmeld" id="hpMeld" role="status" hidden></p>
    <div class="hpformknop"><button class="btn yellow" type="submit">Opslaan</button><button class="btn" type="button" id="hpAnnuleer">Annulere</button>
      ${!nieuw&&!HPF.bevestig?`<span class="hprechts">${m?`<button class="btn rood" type="button" id="hpWisContact">Contact wisse…</button> `:""}<button class="btn rood" type="button" id="hpWisKaart">Kaart wisse…</button></span>`:""}</div></form>`;
  $("hpForm").innerHTML=h;
  hpAkkoordVelden();hpPostKiesTeken();
}
// status zetten (knoppen bovenaan + verborgen veld dat wordt opgeslagen)
function hpZetStatus(st){const f=$("hpF");if(!f)return;f.status.value=st;
  document.querySelectorAll("#hpStatus [data-hpst]").forEach(b=>{const aan=b.dataset.hpst===st;b.setAttribute("aria-checked",aan);b.setAttribute("aria-pressed",aan)})}
function hpAkkoordVelden(){
  const f=$("hpF");if(!f||!f.akkoord)return;const aan=f.akkoord.checked;
  ["akkoord_op","akkoord_hoe","email","telefoon"].forEach(k=>{f[k].disabled=!aan});
  $("hpZonder").hidden=aan;
}
// post kiezen: keuzelijst met je laatste 30 posts (geen stories). Posts met @insta van deze persoon in het bijschrift
// of als partnâh (vanaf de shootdatum) krijgen een ★. Staat er al een oudere post gekoppeld, dan staat die er ook bij.
function hpPostKiesTeken(){
  const f=$("hpF"),el=$("hpPostKies");if(!f||!el)return;
  const m=HPF.mid&&HP.mensen.find(x=>x.id===HPF.mid);
  const insta=f.insta?hpInsta(f.insta.value):(m&&m.insta);
  const van=f.d.value?Date.parse(hpVanDelen(f.d.value,"00:00"))-864e5:null;
  const alle=(IG.posts||[]).filter(p=>soortGroep(p)!=="story"&&p.gepost_om).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));
  const lijst=alle.slice(0,HP_POST_KEUZE);
  const gekozen=HPF.post?alle.find(p=>p.media_id===HPF.post):null;
  if(gekozen&&!lijst.includes(gekozen))lijst.push(gekozen);
  const lijkt=p=>{if(!insta)return false;
    if(van&&Date.parse(p.gepost_om)<van)return false;
    const b=String(p.bijschrift||"").toLowerCase();
    return b.includes("@"+insta)||(typeof igPartnersVan==="function"&&igPartnersVan(p).includes(insta))};
  const naam=p=>`${lijkt(p)?"★ ":""}${HP_DAG.format(new Date(p.gepost_om))} · ${IG_GROEPEN[soortGroep(p)].een} · ${String(p.bijschrift||"").split("\n")[0].slice(0,50)}`;
  const n=lijst.filter(lijkt).length;
  let h=`<label>Welke post? <small>je laatste ${HP_POST_KEUZE} posts${n?` · ★ = @${esc(insta)} staat erin of is partnâh`:""}</small>
    <select name="post_sel"><option value="">— nog geen post —</option>${lijst.map(p=>`<option value="${esc(p.media_id)}" ${HPF.post===p.media_id?"selected":""}>${esc(naam(p))}</option>`).join("")}
    ${HPF.post&&!gekozen?`<option value="${esc(HPF.post)}" selected>Post ${esc(HPF.post)} (nie meâh in je Insta-cijfâhs)</option>`:""}</select></label>`;
  if(gekozen)h+=`<div class="hpgekozen"><span class="igthumb hpthumb">${gekozen.plaatje?`<img src="${esc(gekozen.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span>
    <span class="sub">${esc(String(gekozen.bijschrift||"").split("\n")[0].slice(0,120))}</span></div>`;
  // bedankkaart (chat 50.3): alleen als deze post al is opgeslagen met status Gepost
  const kk=HPF.sid&&hpKaartVan(HPF.mid,HPF.sid);
  if(gekozen&&typeof pbKan==="function"&&pbKan(kk)&&kk.s.media_id===HPF.post)
    h+=`<button class="btn hpklein hpbedank" type="button" data-hpbedank="${esc(HPF.sid)}">♥ Bedankkaart make</button>`;
  if(!alle.length)h+=`<p class="sub">Nog geen Insta-posts geladen.</p>`;
  el.innerHTML=h;
}

/* ---------- opslaan / wissen ---------- */
async function hpOpslaan(){
  const f=$("hpF");if(!f)return;
  const leeg=v=>{v=String(v||"").trim();return v===""?null:v};
  const metPersoon=!!f.naam;
  let mrij=null;
  if(metPersoon){
    const ak=f.akkoord.checked;
    mrij={naam:leeg(f.naam.value),insta:leeg(hpInsta(f.insta.value)),notitie:leeg(f.notitie.value),akkoord:ak,
      akkoord_op:ak?leeg(f.akkoord_op.value):null,akkoord_hoe:ak?f.akkoord_hoe.value:null,
      email:ak?leeg(f.email.value):null,telefoon:ak?leeg(f.telefoon.value):null};
    if(!mrij.naam)return hpMeld("Vul een naam in.",true);
    if(mrij.insta&&!/^[a-z0-9._]{1,30}$/.test(mrij.insta))return hpMeld("Insta-naam: alleen kleine letters, cijfers, punt en _ (max 30).",true);
    if(ak&&!mrij.akkoord_op)return hpMeld("Vul de datum van het akkoord in.",true);
    const oud=HPF.mid&&HP.mensen.find(x=>x.id===HPF.mid);
    if(oud&&!ak&&(oud.email||oud.telefoon)&&!HPF.okZonder){HPF.okZonder=true;return hpMeld("Vinkje akkoord staat uit: e-mail en telefoon worden dan gewist. Tik nog een keer op Opslaan om door te gaan.",true)}
  }
  const srij={plek:leeg(f.plek.value),wanneer:hpVanDelen(f.d.value,f.t.value),status:f.status.value,
    caption:leeg(f.caption.value),story_tekst:leeg(f.story_tekst.value),tekst_status:f.tekst_status.value,media_id:HPF.post||null};
  if(!srij.plek)return hpMeld("Vul de plek in.",true);
  hpMeld("Effe opslaan…");
  const knop=f.querySelector("button[type=submit]");knop.disabled=true;
  try{
    // 1. persoon (nieuw: zelf een id maken, dan kan de shoot er meteen naar wijzen)
    if(metPersoon){
      if(HPF.mid){const r=await sb.from("hp_mensen").update(mrij).eq("id",HPF.mid);if(r.error)throw r.error}
      else{const id=hpUuid();const r=await sb.from("hp_mensen").insert({id,...mrij});if(r.error)throw r.error;HPF.mid=id}
    }
    // 2. shoot
    if(HPF.sid){const r=await sb.from("hp_shoots").update(srij).eq("id",HPF.sid);if(r.error)throw r.error}
    else{const id=hpUuid();const r=await sb.from("hp_shoots").insert({id,persoon_id:HPF.mid,...srij});if(r.error)throw r.error;HPF.sid=id}
  }catch(e){knop.disabled=false;HP.geladen=false;hpLaden();return hpMeld(hpFout(e),true)}   // half gelukt? opnieuw Opslaan werkt het bij (mid/sid zijn bewaard)
  HPF.vuil=false;hpDicht(true);await hpHerlaad();
}
async function hpWis(wat){
  if(!HPF)return;hpMeld("Effe wisse…");
  try{
    if(wat==="contact"){const r=await sb.rpc("hp_contact_wissen",{p_id:HPF.mid});if(r.error)throw r.error}
    else{
      if(HPF.sid){const r=await sb.from("hp_shoots").delete().eq("id",HPF.sid);if(r.error)throw r.error}
      if(HPF.mid){const r=await sb.rpc("hp_alles_wissen",{p_id:HPF.mid});if(r.error)throw r.error}
    }
  }catch(e){return hpMeld(hpFout(e),true)}
  HPF.vuil=false;hpDicht(true);await hpHerlaad();
}
async function hpAllesWissen(id,knop){
  const m=HP.mensen.find(x=>x.id===id);if(!m)return;
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
  if(t.closest("#hpNieuw"))return hpOpen(null,null,t.closest("button"));
  const fb=t.closest("[data-hpf]");if(fb){HP.filter=HP.filter===fb.dataset.hpf&&fb.dataset.hpf!=="alles"?"alles":fb.dataset.hpf;renderPlekkies();return}
  const ge=t.closest("[data-hpgeschoten]");if(ge)return hpSnelGeschoten(ge.dataset.hpgeschoten,ge);
  const al=t.closest("[data-hpalles]");if(al)return hpAllesWissen(al.dataset.hpalles,al);
  const kb=t.closest("[data-hpkaart]");
  if(kb&&!t.closest("#hpPop")){if(t.closest("a")&&!t.closest("a").matches("[data-hpkaart]"))return;   // een gewone link (bijv. Insta) doet z'n eigen ding
    return hpOpen(kb.dataset.hpkaart||null,kb.dataset.hpm||null,kb)}
  if(!HPF)return;
  if(t.closest("#hpDicht")||t.closest("#hpAnnuleer"))return hpDicht(!!t.closest("#hpAnnuleer"));
  if(t.closest("#hpWisContact")){HPF.bevestig="contact";hpBewaarInvoer();return}
  if(t.closest("#hpWisKaart")){HPF.bevestig="kaart";hpBewaarInvoer();return}
  if(t.closest("#hpNeeWis")){HPF.bevestig=null;hpBewaarInvoer();return}
  if(t.closest("#hpJaWis"))return hpWis(HPF.bevestig==="contact"?"contact":"kaart");
  if(t.closest("#hpKopieer")){const txt=$("hpToestTekst").textContent;const b=t.closest("#hpKopieer");
    (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>{b.textContent="Gekopieerd ✓"},()=>{b.textContent="Kopiëren lukte nie: selecteer de tekst"});return}
  const sk=t.closest("[data-hpst]");if(sk){hpZetStatus(sk.dataset.hpst);HPF.vuil=true;return}
});
// formulier opnieuw tekenen (bijv. voor de wis-bevestiging) zonder getypte tekst kwijt te raken
function hpBewaarInvoer(){
  const f=$("hpF"),w={};if(f)[...f.elements].forEach(x=>{if(x.name)w[x.name]=x.type==="checkbox"?x.checked:x.value});
  hpFormTeken();const g=$("hpF");if(!g)return;
  [...g.elements].forEach(x=>{if(x.name&&x.name in w){if(x.type==="checkbox")x.checked=w[x.name];else x.value=w[x.name]}});
  hpZetStatus(g.status.value);hpAkkoordVelden();hpPostKiesTeken();
  const b=$("hpPop").querySelector(".hpbevestig");if(b)b.scrollIntoView({block:"nearest"});
}
document.addEventListener("submit",e=>{if(e.target.id==="hpF"){e.preventDefault();hpOpslaan()}});
document.addEventListener("input",e=>{
  if(!HPF||!e.target.closest("#hpF"))return;HPF.vuil=true;HPF.okZonder=false;
  const n=e.target.name;
  if(n==="akkoord")hpAkkoordVelden();
  if(n==="naam"){const p=$("hpToestTekst");if(p)p.textContent=hpToestemming(e.target.value.trim())}
  if(n==="insta"||n==="d")hpPostKiesTeken();
  if(n==="post_sel"){HPF.post=e.target.value||null;const f=$("hpF");
    if(HPF.post&&f.status.value!=="gepost"){hpZetStatus("gepost");f.tekst_status.value="gepost";hpMeld("Status op Gepost gezet (pas aan als dat nie klopt).")}
    hpPostKiesTeken()}
  if(n==="d"&&e.target.value){const f=$("hpF");if(f.status.value==="te_plannen"){hpZetStatus("gepland");hpMeld("Datum geprikt: status op Gepland gezet.")}}
});
// Enter/spatie op een regel = bewerke
document.addEventListener("keydown",e=>{
  if(HPF||(e.key!=="Enter"&&e.key!==" "))return;const r=e.target.closest&&e.target.closest(".hpregel");
  if(!r||e.target!==r)return;e.preventDefault();hpOpen(r.dataset.hpkaart||null,r.dataset.hpm||null,r);
});
document.addEventListener("keydown",e=>{
  if(!HPF||$("hpPop").hidden)return;
  if(typeof PD!=="undefined"&&PD)return;                        // post-pop-up ligt erbovenop: die sluit eerst
  if(e.key==="Escape"){e.preventDefault();hpDicht()}
});
