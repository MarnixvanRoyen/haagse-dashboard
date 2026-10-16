// events.js — tab Events: events plannen voor The Hague Beachlife / Marreman Rojas (16-10-2026, chat 53)
// Eén regel per event. Tik = formulier (pop-up #evPop): wat/waâh/wanneer, gastenlijst, uitnodigen.
//
// Keuzes Marnix (16-10): aanmelden houdt Marnix zelf bij (gasten antwoorden via WhatsApp/DM, hij tikt "Komt").
//   Geen openbare pagina. Geen +1 (één gast = één plek). Geen wachtlijst. Soort: op uitnodiging of open voâh iedereen.
//   Vol = "Komt" ≥ max. plekken → rood VOL, badge in het menu, knop "Sorry, vol" (tekst kopiëren).
//   Uitnodigen: WhatsApp-tekst (kopiëren of WhatsApp openen), Google Agenda-uitnodiging vanaf marremanrojas
//   (gasten met e-mail + akkoord; js/agenda.js), story 1080×1920, en "Zet in agenda" (.ics) voâh jezelf.
//   Teksten in Haags / Netjes / English (laatste keuze onthouden, geen persoonsgegeven).
// Data: Supabase ev_events + ev_gasten (36_events.sql), alleen voor Marnix (RLS is_marnix + eigen rijen).
// Privacy (AVG): gegevens alleen in Supabase, nooit in localStorage/sessionStorage/console. Foutmeldingen alleen error.message.
//   E-mail alleen met akkoord (de database weigert het anders ook). Geen telefoonnummers.
//   Na een event: "Contact wisse" haalt van alle gasten e-mail + akkoord weg (naam en Insta blijven voor de lijst).
// Hergebruikt: hpDelen, hpVanDelen, hpVandaag, hpInsta, hpUuid, HP_DAG/HP_TIJD/HP_DAGKORT/HP_WD, HP_UITNODIG_VAN (plekkies.js);
//   agGoogleLink, agIcs, agMail (agenda.js); BK_KLEUR, BK_FONT, bkRond, bkTekst, bkVlag, bkGolven, bkBewaar (bedankkaart.js);
//   pbRegels, pbSpeld, pbKanDelen (plekbedank.js). Daarom laadt dit bestand ná plekbedank.js.

let EV={events:[],gasten:[],geladen:false,laden:null,err:null,filter:"alles",ik:null};
let EVF=null;   // open formulier: {eid, vuil, bevestig, terug, gast (id die je bewerkt), wisZeker}
let EVS=null;   // open story: {taal, vrij, terug}
const EV_STATUS={concept:"Concept",uitgenodigd:"Uitgenodigd",afgelast:"Afgelast"};
const EV_STATUS_KL={concept:"mute",uitgenodigd:"lb",afgelast:"warn"};
const EV_GAST={uitgenodigd:"Uitgenodigd",komt:"Komt",kan_nie:"Kan nie"};
const EV_SOORT={uitnodiging:"Op uitnodiging",open:"Open voâh iedereen"};
const EV_STD_DUUR=120;        // geen eindtijd ingevuld → agenda rekent 2 uur
const EV_WIS_DAGEN=14;        // zo lang na het event: vraag of de e-mails gewist mogen worden
const EV_IK="the_hague_beachlife";
const EV_TALEN={haags:"Haags",netjes:"Netjes",en:"English"};
const EV_DAG_EN=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",weekday:"short",day:"numeric",month:"short"});   // "Sun, 25 Oct"

/* ---------- laden ---------- */
async function evLaden(){
  if(EV.laden)return EV.laden;
  EV.laden=(async()=>{
    try{
      const [e,g]=await Promise.all([
        sb.from("ev_events").select("*").order("begint",{ascending:true}),
        sb.from("ev_gasten").select("*").order("aangemaakt_om",{ascending:true})]);
      if(e.error)throw e.error;if(g.error)throw g.error;
      EV.events=e.data||[];EV.gasten=g.data||[];EV.err=null;
      try{const {data:{session}}=await sb.auth.getSession();EV.ik=session&&session.user&&session.user.email||null}catch(x){EV.ik=null}
    }catch(x){EV.err=evFout(x)}
    EV.geladen=true;EV.laden=null;evBadge();
  })();
  return EV.laden;
}
// alleen de korte melding, nooit details (kan persoonsgegevens bevatten)
function evFout(e){const m=(e&&e.message)||String(e);
  if(/ev_events|ev_gasten/.test(m)&&/does not exist|schema cache|Could not find/i.test(m))return "Tabellen bestaan nog nie: draai eerst 36_events.sql.";
  if(/ev_email_alleen_met_akkoord/.test(m))return "E-mail kan alleen met akkoord.";
  if(/ev_akkoord_met_datum/.test(m))return "Vul de datum van het akkoord in.";
  if(/ev_eind_na_begin/.test(m))return "De eindtijd moet ná de begintijd zijn.";
  if(/insta_check/.test(m))return "Insta-naam: alleen kleine letters, cijfers, punt en _ (max 30).";
  if(/email_check/.test(m))return "Dat e-mailadres klopt nie.";
  if(/max_plekken_check/.test(m))return "Max. plekken: een getal van 1 tot 10.000 (of leeg).";
  if(/titel_check|plek_check|naam_check/.test(m))return "Titel, plek en naam mogen nie leeg zijn.";
  if(/Alleen voor Marnix|row-level security|permission denied/i.test(m))return "Geen toegang (alleen voor Marnix).";
  return m.length>160?m.slice(0,160)+"…":m;
}

/* ---------- rekenen ---------- */
const evVan=id=>EV.events.find(e=>e.id===id)||null;
const evGastenVan=id=>EV.gasten.filter(g=>g.event_id===id);
function evEind(e){return e.eindigt?Date.parse(e.eindigt):Date.parse(e.begint)+EV_STD_DUUR*6e4}
// fase: concept · komend · geweest (afgelast telt als geweest: nie meer mee bezig)
function evFase(e){if(e.status==="afgelast"||evEind(e)<Date.now())return "geweest";return e.status==="concept"?"concept":"komend"}
function evTel(e,lijst){
  const g=lijst||evGastenVan(e.id),t={komt:0,uitgenodigd:0,kan_nie:0};g.forEach(x=>t[x.status]++);
  const max=e.max_plekken||null;
  return {...t,n:g.length,max,vrij:max?Math.max(0,max-t.komt):null,vol:!!max&&t.komt>=max,teveel:max?Math.max(0,t.komt-max):0};
}
const evMetMail=e=>evGastenVan(e.id).filter(g=>g.email);
const evMoetWissen=e=>evFase(e)==="geweest"&&evEind(e)<Date.now()-EV_WIS_DAGEN*864e5&&evMetMail(e).length>0;

/* ---------- badge in het menu: komende events die vol zitten ---------- */
function evBadge(){
  const b=document.querySelector('nav.hoofdmenu button[data-s="events"]');if(!b)return;
  const n=EV.err?0:EV.events.filter(e=>evFase(e)!=="geweest"&&evTel(e).vol).length;
  let s=b.querySelector(".badge");
  if(!n){if(s)s.remove();return}
  if(!s){s=document.createElement("span");s.className="badge";b.appendChild(s)}
  s.textContent=n;s.title=n===1?"1 event zit vol":n+" events zitten vol";
}
async function evBijStart(){try{await evLaden()}catch(e){}}   // start.js: badge zetten (stil; zonder SQL 36 gewoon niks)

/* ---------- teksten (Haags / Netjes / English) ---------- */
function evMeervoud(taal,n){return taal==="en"?(n===1?"spot":"spots"):taal==="haags"?(n===1?"plek":"plekke"):(n===1?"plek":"plekken")}
function evWanneerTxt(d,taal){
  const s=new Date(d.start),e=new Date(d.eind);
  const dag=taal==="en"?EV_DAG_EN.format(s):HP_DAG.format(s);
  return `${dag} · ${HP_TIJD.format(s)}–${HP_TIJD.format(e)}`;
}
function evUitnodiging(d,taal){
  const w=evWanneerTxt(d,taal),vrij=d.vrij?d.vrij:null,mv=vrij!=null?evMeervoud(taal,vrij):"";   // vol (0 vrij): geen regel over plekken
  const om=d.omschrijving?d.omschrijving.trim()+"\n":"";
  if(taal==="en"){
    const pl=d.soort==="open"?(vrij!=null?`Everyone's welcome, but only ${vrij} ${mv} left!`:"Everyone's welcome!"):(vrij!=null?`Only ${vrij} ${mv} left, so be quick!`:"");
    return `Hi! 🌊\nYou're invited to: ${d.titel}\n📅 ${w}\n📍 ${d.plek}\n${om}${pl?pl+"\n":""}Coming? Just reply "yes" and I'll put you on the list. 💛💚\nCheers, Marnix (@${EV_IK})`;
  }
  if(taal==="netjes"){
    const pl=d.soort==="open"?(vrij!=null?`Iedereen is welkom, maar er zijn nog maar ${vrij} ${mv} vrij!`:"Iedereen is welkom!"):(vrij!=null?`Er zijn nog ${vrij} ${mv} vrij, dus wees er snel bij!`:"");
    return `Hoi! 🌊\nJe bent uitgenodigd voor: ${d.titel}\n📅 ${w}\n📍 ${d.plek}\n${om}${pl?pl+"\n":""}Kom je? Stuur even "ja" terug, dan zet ik je op de lijst. 💛💚\nGroetjes, Marnix (@${EV_IK})`;
  }
  const pl=d.soort==="open"?(vrij!=null?`Iedereen is welkom, maâh d'r zijn nog maâh ${vrij} ${mv} vrè!`:"Iedereen is welkom!"):(vrij!=null?`D'r zijn nog ${vrij} ${mv} vrè, dus wees d'r snel bè!`:"");
  return `Hoi! 🌊\nJe ben uitgenodigd voâh: ${d.titel}\n📅 ${w}\n📍 ${d.plek}\n${om}${pl?pl+"\n":""}Kom je? Stuur effe "ja" terug, dan zet ik je op de lèst. 💛💚\nGroetjes, Marnix (@${EV_IK})`;
}
function evSorry(titel,taal){
  if(taal==="en")return `Hi! So nice that you want to join ${titel} 💛\nUnfortunately it's fully booked. I'll keep you posted for next time!\nCheers, Marnix (@${EV_IK})`;
  if(taal==="netjes")return `Hoi! Wat leuk dat je wilt komen naar ${titel} 💛\nHelaas, het zit vol. Ik hou je op de hoogte voor de volgende keer!\nGroetjes, Marnix (@${EV_IK})`;
  return `Hoi! Wat leuk dat je wil komme naâh ${titel} 💛\nHelaas, hij zit vol. Ik hou je op de hoogte voâh de volgende keâh!\nGroetjes, Marnix (@${EV_IK})`;
}
function evTaal(){const t=store.get("hc_event_taal");return EV_TALEN[t]?t:"haags"}

/* ---------- tekenen: de tab ---------- */
async function renderEvents(){
  const el=$("evInhoud");if(!el)return;
  if(!EV.geladen){el.innerHTML=`<p class="sub">Effe ophale…</p>`;await evLaden();if(sectie!=="events")return}
  if(EV.err){el.innerHTML=`<div class="card binnenkort"><h2>Events</h2><p class="kd">Lukte nie, âhwe</p><p class="sub">${esc(EV.err)}</p></div>`;$("evStats").innerHTML="";return}
  const tel={alles:EV.events.length,komend:0,concept:0,geweest:0};
  EV.events.forEach(e=>tel[evFase(e)]++);
  const komend=EV.events.filter(e=>evFase(e)==="komend").sort((a,b)=>Date.parse(a.begint)-Date.parse(b.begint));
  const nVol=komend.filter(e=>evTel(e).vol).length;
  const SUB={alles:`${EV.gasten.length} gaste in totaal`,komend:komend[0]?"eâhste: "+esc(HP_DAG.format(new Date(komend[0].begint)))+(nVol?` · ${nVol} vol`:""):"niks gepland",
    concept:"nog nie uitgenodigd",geweest:"voorbij of afgelast"};
  const NAAM={alles:"Allâh",komend:"Komend",concept:"Concept",geweest:"Geweest"};
  $("evStats").innerHTML=Object.keys(NAAM).map(k=>
    `<button type="button" class="ytstat hptegel${EV.filter===k?" aan":""}" data-evf="${k}" aria-pressed="${EV.filter===k}"><span class="k">${NAAM[k]}</span><span class="v">${tel[k]}</span><span class="s">${SUB[k]}</span></button>`).join("");
  // komend + concept: eerstvolgende bovenaan · geweest: nieuwste bovenaan
  const VOLG={komend:0,concept:1,geweest:2};
  const lijst=EV.events.filter(e=>EV.filter==="alles"||evFase(e)===EV.filter).sort((a,b)=>{
    const fa=evFase(a),fb=evFase(b);if(fa!==fb)return VOLG[fa]-VOLG[fb];
    return fa==="geweest"?Date.parse(b.begint)-Date.parse(a.begint):Date.parse(a.begint)-Date.parse(b.begint)});
  el.innerHTML=`<div class="card hplijstkaart">${lijst.length?`<div class="hplijst">${lijst.map(evRegel).join("")}</div>`
    :`<p class="sub">${EV.events.length?"Niks in deze lijst.":"Nog geen events. Tik op <b>+ Event</b>."}</p>`}</div>`;
  evBadge();
}
// één regel per event: datum · titel + plek + labels · knoppen. Tik op de regel = bewerke.
function evRegel(e){
  const t=Date.parse(e.begint),f=evFase(e),c=evTel(e),aan=f!=="geweest";
  const lo=[];
  if(evMoetWissen(e))lo.push(["al "+EV_WIS_DAGEN+" dagen voorbij: contact wisse?","contact wisse?"]);
  if(aan&&c.teveel)lo.push([`${c.teveel} te veel aangemeld`,`+${c.teveel} te veel`]);
  const telChip=c.vol?`<span class="chip evvol">VOL${c.max?` · ${c.komt}/${c.max}`:""}</span>`
    :`<span class="chip ${c.komt?"good":"mute"}">${c.komt}${c.max?"/"+c.max:""} komme</span>`;
  return `<div class="hprij evregel" data-evkaart="${esc(e.id)}" tabindex="0" role="button" aria-label="Event ${esc(e.titel)} bewerke">
    <div class="hpdatum${f==="geweest"?" evvoorbij":""}"><b>${esc(HP_DAGKORT.format(new Date(t)))}</b><span>${esc(HP_WD.format(new Date(t)))} ${esc(HP_TIJD.format(new Date(t)))}</span></div>
    <div class="hprijin"><div class="hpr1"><b>${esc(e.titel)}</b><span class="sub hpwie">${esc(e.plek)}</span></div>
      <div class="hpchips">${f==="geweest"&&e.status!=="afgelast"?`<span class="chip mute">Geweest</span>`:`<span class="chip ${EV_STATUS_KL[e.status]}">${EV_STATUS[e.status]}</span>`}
        ${telChip}<span class="chip mute pc">${EV_SOORT[e.soort]}</span>${c.uitgenodigd&&aan?`<span class="chip lb pc">${c.uitgenodigd} wachte op antwoord</span>`:""}
        ${lo.map(w=>`<span class="chip warn pc">${w[0]}</span>`).join("")}
        ${lo.length?`<span class="chip warn tel">${lo[0][1]}</span>`:""}</div></div>
    <div class="hpacties">${c.vol&&aan?`<button class="btn hpklein" type="button" data-evsorry="${esc(e.id)}" title="Tekst kopiëren voâh wie te laat is">📋<span class="pc">&nbsp;Sorry, vol</span></button>`:""}
      <span class="hppijl" aria-hidden="true">›</span></div></div>`;
}

/* ---------- formulier (pop-up #evPop) ---------- */
function evOpen(eid,terug){
  EVF={eid:eid||null,vuil:false,bevestig:null,terug:terug||document.activeElement,gast:null,wisZeker:false};
  $("evPop").hidden=false;document.body.classList.add("popopen");
  evFormTeken();
  const eerste=$("evPop").querySelector("#evF input[name=titel]");if(eerste&&!eid)eerste.focus({preventScroll:true});
  else $("evDicht").focus({preventScroll:true});
}
function evDicht(force){
  if(!EVF)return;
  if(EVF.vuil&&!force){evMeld("Nog nie opgeslagen. Tik op Opslaan, of nog een keer op Sluite om weg te gaan zonder opslaan.",true);EVF.vuil=false;EVF.wasVuil=true;return}
  const t=EVF.terug;EVF=null;$("evPop").hidden=true;$("evForm").innerHTML="";
  if(![...document.querySelectorAll(".vnpop")].some(x=>!x.hidden))document.body.classList.remove("popopen");
  if(t&&t.isConnected&&t.focus)t.focus({preventScroll:true});
  if(sectie==="events")renderEvents();
}
function evMeld(t,fout){const e=$("evMeld");if(!e)return;e.textContent=t||"";e.classList.toggle("fout",!!fout);e.hidden=!t}

function evFormTeken(){
  if(!EVF)return;
  const e=EVF.eid?evVan(EVF.eid):null,nieuw=!e;
  $("evTitel").textContent=nieuw?"Nieuw event":e.titel;
  $("evSub").textContent=nieuw?"Eerst wat, waâh en wanneer. Na Opslaan voeg je de gaste toe.":`${EV_SOORT[e.soort]} · toegevoegd ${HP_DAGJ.format(new Date(e.aangemaakt_om))}`;
  const b=hpDelen(e&&e.begint),ei=e&&e.eindigt?hpDelen(e.eindigt):{t:""};
  const st0=e?e.status:"concept";
  let h=`<form id="evF" class="hpform" novalidate>
    <fieldset class="hpstatusveld"><legend>Status</legend><input type="hidden" name="status" value="${st0}">
      <div class="seg hpstatus evstatus" id="evStatus" role="radiogroup" aria-label="Status">${Object.entries(EV_STATUS).map(([k,v])=>
        `<button type="button" role="radio" data-evst="${k}" aria-checked="${st0===k}" aria-pressed="${st0===k}">${v}</button>`).join("")}</div>
    </fieldset>
    <fieldset><legend>Wat, waâh en wanneer</legend>
      <label>Titel <input name="titel" required maxlength="120" autocomplete="off" placeholder="bijv. Zonsondergang op de Pier" value="${esc(e?e.titel:"")}"></label>
      <label>Plek <input name="plek" required maxlength="200" autocomplete="off" placeholder="bijv. Pier, Kurhaus, Boulevard" value="${esc(e?e.plek:"")}"></label>
      <div class="hptwee evdrie"><label>Datum <input type="date" name="d" value="${esc(b.d)}"></label><label>Begin <input type="time" name="t" value="${esc(b.t)}"></label>
        <label>Eind <small>mag leeg</small><input type="time" name="te" value="${esc(ei.t)}"></label></div>
      <div class="hptwee"><label>Soort <select name="soort">${Object.entries(EV_SOORT).map(([k,v])=>`<option value="${k}" ${(e?e.soort:"uitnodiging")===k?"selected":""}>${v}</option>`).join("")}</select></label>
        <label>Max. plekke <small>leeg = geen maximum</small><input type="number" name="max" min="1" max="10000" inputmode="numeric" value="${esc(e&&e.max_plekken||"")}"></label></div>
      <label>Omschrijving <small>komt in de uitnodiging en op de story</small><textarea name="omschrijving" rows="3" maxlength="2000">${esc(e&&e.omschrijving||"")}</textarea></label>
    </fieldset>
    <fieldset class="evgastveld"><legend>Gaste</legend><div id="evGasten"></div></fieldset>
    <fieldset><legend>Uitnodige</legend><div id="evUit"></div></fieldset>`;
  if(EVF.bevestig==="event")h+=`<div class="hpbevestig" role="alert"><b>Event wisse?</b><p class="sub">Het event én de hele gastenlijst (${evGastenVan(e.id).length} gaste) gaan weg. Dit kan nie terug.</p>
      <div class="hpformknop"><button class="btn rood" type="button" id="evJaWis">Ja, wisse</button><button class="btn" type="button" id="evNeeWis">Nee, toch nie</button></div></div>`;
  h+=`<p class="hpmeld" id="evMeld" role="status" hidden></p>
    <div class="hpformknop"><button class="btn yellow" type="submit">Opslaan</button><button class="btn" type="button" id="evAnnuleer">Sluite</button>
      ${!nieuw&&!EVF.bevestig?`<span class="hprechts"><button class="btn rood" type="button" id="evWisEvent">Event wisse…</button></span>`:""}</div></form>`;
  $("evForm").innerHTML=h;
  evGastenTeken();evUitTeken();
}
function evZetStatus(st){const f=$("evF");if(!f)return;f.status.value=st;
  document.querySelectorAll("#evStatus [data-evst]").forEach(b=>{const aan=b.dataset.evst===st;b.setAttribute("aria-checked",aan);b.setAttribute("aria-pressed",aan)})}

/* ---------- gastenlijst (wordt meteen opgeslagen, los van het formulier) ---------- */
function evGastenTeken(){
  const el=$("evGasten");if(!el||!EVF)return;
  if(!EVF.eid){el.innerHTML=`<p class="sub">Sla het event eerst op, dan kun je gaste toevoege.</p>`;return}
  const e=evVan(EVF.eid);if(!e)return;
  const g=evGastenVan(e.id),c=evTel(e,g),f=$("evF");
  const maxNu=f&&f.max.value?Math.max(1,parseInt(f.max.value,10)||0):c.max;
  const cc=maxNu?{...c,max:maxNu,vrij:Math.max(0,maxNu-c.komt),vol:c.komt>=maxNu}:c;
  const pctW=cc.max?Math.min(100,Math.round(cc.komt/cc.max*100)):0;
  let h=`<div class="evteller"><div class="evteltxt"><b>${cc.komt}${cc.max?" / "+cc.max:""}</b> komme${cc.vol?` <span class="chip evvol">VOL</span>`:cc.max?` · nog ${cc.vrij} ${evMeervoud("haags",cc.vrij)} vrè`:""}
      <span class="sub">${cc.uitgenodigd} uitgenodigd · ${cc.kan_nie} kan nie</span></div>
    ${cc.max?`<div class="evbalk${cc.vol?" vol":""}" role="img" aria-label="${cc.komt} van ${cc.max} plekke bezet"><i style="width:${pctW}%"></i></div>`:""}</div>`;
  if(cc.vol)h+=`<div class="evvolmeld">Zit vol! Wie nog wil komme, kan je deze tekst sture: <button class="btn hpklein" type="button" data-evsorry="${esc(e.id)}">📋 Kopieer "Sorry, vol"</button></div>`;
  if(g.length){
    const VOLG={komt:0,uitgenodigd:1,kan_nie:2};
    h+=`<div class="evgasten">${g.slice().sort((a,b)=>VOLG[a.status]-VOLG[b.status]||a.naam.localeCompare(b.naam,"nl")).map(x=>`<div class="evgast${EVF.gast===x.id?" bewerk":""}">
      <div class="evgastwie"><b>${esc(x.naam)}</b>${x.insta?` <a href="https://www.instagram.com/${encodeURIComponent(x.insta)}/" target="_blank" rel="noopener">@${esc(x.insta)}</a>`:""}${x.email?` <span class="chip good" title="E-mail bewaard (met akkoord)">✉︎</span>`:""}</div>
      <div class="seg evgaststatus" role="group" aria-label="Status van ${esc(x.naam)}">${Object.entries(EV_GAST).map(([k,v])=>
        `<button type="button" data-evgst="${k}" data-evg="${esc(x.id)}" aria-pressed="${x.status===k}">${v}</button>`).join("")}</div>
      <div class="evgastknop"><button class="btn hpklein" type="button" data-evgbewerk="${esc(x.id)}" aria-label="${esc(x.naam)} bewerke" title="Bewerke">✎</button>
        <button class="btn hpklein" type="button" data-evgwis="${esc(x.id)}" aria-label="${esc(x.naam)} wisse" title="Wisse">✕</button></div></div>`).join("")}</div>`;
  }else h+=`<p class="sub">Nog geen gaste. Voeg ze hieronder toe zodra ze "ja" zegge (of als je ze uitnodigt).</p>`;
  // toevoegen / bewerken
  const gb=EVF.gast&&g.find(x=>x.id===EVF.gast);
  h+=`<div class="evgastnieuw"><p class="evkop">${gb?"Gast bewerke":"Gast toevoege"}</p>
    <div class="hptwee"><label>Naam <input id="evgNaam" maxlength="100" autocomplete="off" value="${esc(gb?gb.naam:"")}"></label>
      <label>Insta-naam <input id="evgInsta" maxlength="31" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="zonder @" value="${esc(gb&&gb.insta||"")}"></label></div>
    <label class="hpvink"><input type="checkbox" id="evgAkkoord" ${gb&&gb.akkoord?"checked":""}> Akkoord om e-mail te bewaren <small>(voâh de agenda-uitnodiging)</small></label>
    <label>E-mail <input type="email" id="evgEmail" maxlength="200" autocomplete="off" value="${esc(gb&&gb.email||"")}" ${gb&&gb.akkoord?"":"disabled"}></label>
    <div class="hpformknop"><button class="btn yellow hpklein" type="button" id="evgOpslaan">${gb?"Gast opslaan":"+ Gast toevoege"}</button>${gb?`<button class="btn hpklein" type="button" id="evgStop">Annulere</button>`:""}</div>
    <p class="hpmeld" id="evgMeld" role="status" hidden></p></div>`;
  if(evMetMail(e).length)h+=`<div class="evwis"><button class="btn rood hpklein" type="button" id="evWisContact">${EVF.wisZeker?`Zeker? ${evMetMail(e).length} e-mailadresse wisse`:"Contact van alle gaste wisse…"}</button>
    <p class="sub">Na het event: e-mail en akkoord van alle gaste weg. Naam en Insta blijve op de lèst.</p></div>`;
  el.innerHTML=h;
}
function evgMeld(t,fout){const e=$("evgMeld");if(!e)return;e.textContent=t||"";e.classList.toggle("fout",!!fout);e.hidden=!t}
async function evGastOpslaan(){
  const e=EVF&&evVan(EVF.eid);if(!e)return;
  const leeg=v=>{v=String(v||"").trim();return v===""?null:v};
  const ak=$("evgAkkoord").checked;
  const rij={naam:leeg($("evgNaam").value),insta:leeg(hpInsta($("evgInsta").value)),akkoord:ak,akkoord_op:ak?hpVandaag():null,email:ak?leeg($("evgEmail").value):null};
  if(!rij.naam)return evgMeld("Vul een naam in.",true);
  if(rij.insta&&!/^[a-z0-9._]{1,30}$/.test(rij.insta))return evgMeld("Insta-naam: alleen kleine letters, cijfers, punt en _ (max 30).",true);
  if(rij.email&&!agMail(rij.email))return evgMeld("Dat e-mailadres klopt nie.",true);
  if(ak&&!rij.email){rij.akkoord=false;rij.akkoord_op=null}   // vinkje zonder e-mail: niks te bewaren
  const oud=EVF.gast&&EV.gasten.find(x=>x.id===EVF.gast);
  if(oud&&oud.akkoord&&oud.akkoord_op&&rij.akkoord)rij.akkoord_op=oud.akkoord_op;   // eerste akkoord-datum houden
  const knop=$("evgOpslaan");knop.disabled=true;evgMeld("Effe opslaan…");
  try{
    if(oud){const r=await sb.from("ev_gasten").update(rij).eq("id",oud.id);if(r.error)throw r.error;Object.assign(oud,rij)}
    else{const n={id:hpUuid(),event_id:e.id,status:"uitgenodigd",...rij};const r=await sb.from("ev_gasten").insert(n);if(r.error)throw r.error;
      EV.gasten.push({...n,aangemaakt_om:new Date().toISOString()})}
  }catch(x){knop.disabled=false;return evgMeld(evFout(x),true)}
  EVF.gast=null;evGastenTeken();evUitTeken();evBadge();
  evgMeld(oud?"Opgeslage ✓":`${rij.naam} staat op de lèst ✓ Tik op Komt zodra ze "ja" zegge.`);
  const n=$("evgNaam");if(n&&!oud)n.focus({preventScroll:true});
}
async function evGastStatus(id,st){
  const g=EV.gasten.find(x=>x.id===id);if(!g||g.status===st)return;
  const e=evVan(g.event_id),was=evTel(e).vol,oud=g.status;g.status=st;   // meteen tonen, daarna opslaan
  evGastenTeken();
  try{const r=await sb.from("ev_gasten").update({status:st}).eq("id",id);if(r.error)throw r.error}
  catch(x){g.status=oud;evGastenTeken();return evgMeld(evFout(x),true)}
  const c=evTel(e);evUitTeken();evBadge();
  if(st==="komt"&&c.teveel)evgMeld(`Let op: nu ${c.komt} komme, het maximum is ${c.max}.`,true);
  else if(!was&&c.vol)evgMeld("VOL! 🎉 Wie nog wil komme: tik op Kopieer \"Sorry, vol\".");
}
async function evGastWis(id,knop){
  const g=EV.gasten.find(x=>x.id===id);if(!g)return;
  if(knop.dataset.zeker!=="1"){knop.dataset.zeker="1";knop.textContent="Zeker?";knop.classList.add("rood");return}
  knop.disabled=true;
  try{const r=await sb.from("ev_gasten").delete().eq("id",id);if(r.error)throw r.error}
  catch(x){knop.disabled=false;return evgMeld(evFout(x),true)}
  EV.gasten=EV.gasten.filter(x=>x.id!==id);if(EVF.gast===id)EVF.gast=null;
  evGastenTeken();evUitTeken();evBadge();evgMeld(`${g.naam} is gewist.`);
}
async function evContactWis(){
  const e=EVF&&evVan(EVF.eid);if(!e)return;
  if(!EVF.wisZeker){EVF.wisZeker=true;evGastenTeken();return}
  try{const r=await sb.from("ev_gasten").update({email:null,akkoord:false,akkoord_op:null}).eq("event_id",e.id);if(r.error)throw r.error}
  catch(x){EVF.wisZeker=false;evGastenTeken();return evgMeld(evFout(x),true)}
  EV.gasten.forEach(g=>{if(g.event_id===e.id){g.email=null;g.akkoord=false;g.akkoord_op=null}});
  EVF.wisZeker=false;evGastenTeken();evUitTeken();evgMeld("Alle e-mailadresse van dit event zijn gewist ✓");
}

/* ---------- uitnodigen ---------- */
// gegevens uit wat NU in het formulier staat (ook als je nog nie opsloeg) + de gastenlijst uit de database
function evData(){
  const f=$("evF");if(!f)return null;
  const titel=f.titel.value.trim(),plek=f.plek.value.trim();if(!titel||!plek||!f.d.value||!f.t.value)return null;
  const start=hpVanDelen(f.d.value,f.t.value);
  let eind=f.te.value?hpVanDelen(f.d.value,f.te.value):null;
  if(eind&&Date.parse(eind)<=Date.parse(start))eind=new Date(Date.parse(eind)+864e5).toISOString();   // na middernacht
  if(!eind)eind=new Date(Date.parse(start)+EV_STD_DUUR*6e4).toISOString();
  const max=f.max.value?Math.max(1,parseInt(f.max.value,10)||0):null;
  const g=EVF.eid?evGastenVan(EVF.eid):[],komt=g.filter(x=>x.status==="komt").length;
  return {titel,plek,start,eind,max,soort:f.soort.value,omschrijving:f.omschrijving.value.trim(),
    vrij:max?Math.max(0,max-komt):null,vol:!!max&&komt>=max,mails:g.filter(x=>x.email&&x.status!=="kan_nie").map(x=>x.email)};
}
function evUitTeken(){
  const el=$("evUit");if(!el||!EVF)return;
  const d=evData();
  if(!d){el.innerHTML=`<p class="sub">Vul titel, plek, datum én begintijd in, dan kun je uitnodige.</p>`;return}
  const taal=evTaal(),tekst=evUitnodiging(d,taal);
  const nm=d.mails.length;
  const ag=nm?{titel:`🎉 ${d.titel}`,start:d.start,eind:d.eind,plek:d.plek,account:HP_UITNODIG_VAN,gasten:[...d.mails,EV.ik].filter(Boolean),tekst}:null;
  el.innerHTML=`<div class="seg evtaal" id="evTaal" role="group" aria-label="Taal van de teksten">${Object.entries(EV_TALEN).map(([k,v])=>
      `<button type="button" data-evtaal="${k}" aria-pressed="${taal===k}">${v}</button>`).join("")}</div>
    <details class="hptoest evtekst"><summary>Uitnodiging bekijke</summary><pre id="evTekst">${esc(tekst)}</pre></details>
    <div class="hpagendaknop evuitknop">
      <button class="btn hpklein" type="button" id="evKopieer">💬 Kopieer tekst</button>
      <a class="btn hpklein" id="evWa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(tekst)}">🟢 Open WhatsApp</a>
      ${ag?`<a class="btn hpklein" id="evAgUit" target="_blank" rel="noopener" href="${esc(agGoogleLink(ag))}">✉️ Agenda-uitnodiging (${nm})</a>`:""}
      <button class="btn hpklein" type="button" id="evStoryKnop">📱 Story</button>
      <button class="btn hpklein" type="button" id="evIcs">📅 Zet in agenda</button>
      ${d.vol?`<button class="btn hpklein" type="button" id="evSorryForm">📋 Sorry, vol</button>`:""}
    </div>
    <p class="sub">💬/🟢 voâh WhatsApp of Insta-DM (in WhatsApp kies je zelf het contact). ${ag?`✉️ opent Google Agenda van ${esc(HP_UITNODIG_VAN)} met ${nm} gast${nm===1?"":"e"} met e-mail: tik daar op <b>Opslaan</b> en dan <b>Versturen</b>.`:`✉️ Agenda-uitnodiging kan zodra een gast e-mail + akkoord heeft.`} 📅 zet het event in je eigen agenda (zonder gastgegevens).</p>`;
}
// eigen agenda (.ics): geen gastgegevens erin
function evEigen(d){return {titel:`🎉 Event: ${d.titel}`,start:d.start,eind:d.eind,plek:d.plek,uid:(EVF&&EVF.eid||"nieuw")+"@events.haagsecontent",
  tekst:`The Hague Beachlife event${d.omschrijving?"\n"+d.omschrijving:""}\nGastenlijst: dashboard, tab Events`}}
function evKopieer(tekst,knop,klaar){
  (navigator.clipboard?navigator.clipboard.writeText(tekst):Promise.reject()).then(()=>{knop.textContent=klaar||"Gekopieerd ✓"},()=>{knop.textContent="Kopiëren lukte nie"});
}
// bij uitnodigen: status Concept → Uitgenodigd (alleen als het event al is opgeslagen)
async function evNaarUitgenodigd(){
  const f=$("evF");if(!EVF||!EVF.eid||!f||f.status.value!=="concept")return;
  const e=evVan(EVF.eid);
  try{const r=await sb.from("ev_events").update({status:"uitgenodigd"}).eq("id",EVF.eid);if(r.error)throw r.error;if(e)e.status="uitgenodigd"}catch(x){return}
  evZetStatus("uitgenodigd");evMeld("Status op Uitgenodigd gezet.");
}

/* ---------- opslaan / wissen ---------- */
async function evOpslaan(){
  const f=$("evF");if(!f)return;
  const leeg=v=>{v=String(v||"").trim();return v===""?null:v};
  const rij={titel:leeg(f.titel.value),plek:leeg(f.plek.value),status:f.status.value,soort:f.soort.value,omschrijving:leeg(f.omschrijving.value),
    max_plekken:f.max.value?parseInt(f.max.value,10):null};
  if(!rij.titel)return evMeld("Vul een titel in.",true);
  if(!rij.plek)return evMeld("Vul de plek in.",true);
  if(!f.d.value||!f.t.value)return evMeld("Vul datum én begintijd in.",true);
  if(rij.max_plekken!=null&&!(rij.max_plekken>=1&&rij.max_plekken<=10000))return evMeld("Max. plekke: een getal van 1 tot 10.000 (of leeg).",true);
  rij.begint=hpVanDelen(f.d.value,f.t.value);
  rij.eindigt=f.te.value?hpVanDelen(f.d.value,f.te.value):null;
  if(rij.eindigt&&Date.parse(rij.eindigt)<=Date.parse(rij.begint))rij.eindigt=new Date(Date.parse(rij.eindigt)+864e5).toISOString();   // eind na middernacht = volgende dag
  evMeld("Effe opslaan…");
  const knop=f.querySelector("button[type=submit]");knop.disabled=true;
  const nieuw=!EVF.eid;
  try{
    if(EVF.eid){const r=await sb.from("ev_events").update(rij).eq("id",EVF.eid);if(r.error)throw r.error}
    else{const id=hpUuid();const r=await sb.from("ev_events").insert({id,...rij});if(r.error)throw r.error;EVF.eid=id}
  }catch(x){knop.disabled=false;return evMeld(evFout(x),true)}
  EVF.vuil=false;EVF.wasVuil=false;
  await evHerlaad();if(!EVF)return;
  evFormTeken();
  evMeld(nieuw?"Opgeslage ✓ Voeg nu je gaste toe en nodig ze uit.":"Opgeslage ✓");
}
async function evWis(){
  if(!EVF||!EVF.eid)return;evMeld("Effe wisse…");
  try{const r=await sb.from("ev_events").delete().eq("id",EVF.eid);if(r.error)throw r.error}
  catch(x){return evMeld(evFout(x),true)}
  EVF.vuil=false;await evHerlaad();evDicht(true);
}
async function evHerlaad(){EV.geladen=false;await evLaden();if(sectie==="events"&&!EVF)renderEvents()}

/* ---------- story 1080×1920 (pop-up #evsPop) ---------- */
const EVS_T={
  haags:{badge:"THE HAGUE BEACHLIFE · EVENT",open:"Iedereen is welkom!",vrij:n=>`Nog ${n} ${evMeervoud("haags",n)} vrè!`,vol:"VOL! Volgende keâh weâh!",
    cta:"Stuur effe 'n DM om mee te doen!",ctaVol:"Volg ons voâh het volgende event!"},
  netjes:{badge:"THE HAGUE BEACHLIFE · EVENT",open:"Iedereen is welkom!",vrij:n=>`Nog ${n} ${evMeervoud("netjes",n)} vrij!`,vol:"VOL! Tot de volgende keer!",
    cta:"Stuur een DM om mee te doen!",ctaVol:"Volg ons voor het volgende event!"},
  en:{badge:"THE HAGUE BEACHLIFE · EVENT",open:"Everyone's welcome!",vrij:n=>`Only ${n} ${evMeervoud("en",n)} left!`,vol:"FULLY BOOKED! See you next time!",
    cta:"Send a DM to join!",ctaVol:"Follow us for the next event!"}
};
async function evsOpen(terug){
  const d=evData();if(!d)return;
  EVS={taal:evTaal(),vrij:true,terug:terug||document.activeElement};
  $("evsPop").hidden=false;document.body.classList.add("popopen");
  $("evsTitel").textContent=`Story: ${d.titel}`;
  $("evsDeel").hidden=!pbKanDelen();$("evsStatus").textContent="";
  evsKnoppen();
  await document.fonts.load(`40px "Titan One"`).catch(()=>{});await document.fonts.load(`800 30px Nunito`).catch(()=>{});
  if(!EVS)return;
  evsTekenNu();$("evsDicht").focus({preventScroll:true});
}
function evsKnoppen(){if(!EVS)return;const d=evData();
  document.querySelectorAll("#evsTaal button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===EVS.taal));
  const kan=d&&(d.vrij!=null||d.soort==="open");$("evsVrij").checked=EVS.vrij&&kan;$("evsVrij").disabled=!kan;
  $("evsVrijTxt").textContent=d&&d.vol?"\"VOL!\" erop":d&&d.vrij!=null?"Plekke vrè erop":d&&d.soort==="open"?"\"Iedereen is welkom\" erop":"Plekke vrè (vul max. plekke in)";
}
function evsTekenNu(){if(!EVS)return;const d=evData();if(!d)return;evsTeken($("evsCanvas"),d,EVS_T[EVS.taal],EVS.taal,{vrij:EVS.vrij})}
function evsTeken(cv,d,T,taal,o){
  const c=cv.getContext("2d"),W=1080,H=1920,m=80,K=BK_KLEUR,F=BK_FONT;
  c.textBaseline="alphabetic";
  const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,K.zee);g.addColorStop(1,K.diep);c.fillStyle=g;c.fillRect(0,0,W,H);
  bkGolven(c,W,H,1.6);bkVlag(c,0,28,W);bkVlag(c,H-14,14,W);
  // badge (vast bovenaan, onder de Insta-balk)
  let y=170;c.font=`26px ${F.kop}`;const bw=Math.min(W-2*m,c.measureText(T.badge).width+56),bh=54;
  bkRond(c,(W-bw)/2,y,bw,bh,bh/2);c.fillStyle=K.geel;c.fill();
  bkTekst(c,T.badge,W/2,y+bh*0.68,`26px ${F.kop}`,K.donker,"center");
  // blokken meten, dan samen netjes in het midden zetten tussen badge (± 260) en de sticker-ruimte (vanaf 1740)
  let kf=128,kr;
  for(;kf>=56;kf-=4){c.font=`${kf}px ${F.kop}`;kr=pbRegels(c,d.titel,W-2*m,4);   // kleiner tot alles past: max 3 regels, geen … en geen regel te breed (lang woord)
    if(kr.length<=3&&!kr.some(l=>l.endsWith("…")||c.measureText(l).width>W-2*m))break}
  kf=Math.max(kf,56);c.font=`${kf}px ${F.kop}`;if(kr.length>3)kr=kr.slice(0,3);const klh=kf*1.06;
  c.font=`700 40px ${F.tekst}`;const or=d.omschrijving?pbRegels(c,d.omschrijving,W-2*m,4):[];const olh=52;
  const s=new Date(d.start),e=new Date(d.eind);
  const dagNaam=new Intl.DateTimeFormat(taal==="en"?"en-GB":"nl-NL",{timeZone:"Europe/Amsterdam",weekday:"long"}).format(s);
  const datum=new Intl.DateTimeFormat(taal==="en"?"en-GB":"nl-NL",{timeZone:"Europe/Amsterdam",day:"numeric",month:"long"}).format(s);
  const tijd=`${HP_TIJD.format(s)} – ${HP_TIJD.format(e)}`;
  const pil=!o.vrij?null:d.vol?T.vol:d.vrij!=null?(d.soort==="open"?T.open+" "+T.vrij(d.vrij):T.vrij(d.vrij)):d.soort==="open"?T.open:null;
  const H_KOP=kr.length*klh,H_DATUM=250,H_PLEK=70,H_OM=or.length?or.length*olh:0,H_PIL=pil?78:0,H_CTA=110,GAP=56;
  const blokken=[H_KOP,H_DATUM,H_PLEK,H_OM,H_PIL,H_CTA].filter(x=>x>0);
  const tot=blokken.reduce((a,b)=>a+b,0)+GAP*(blokken.length-1);
  const boven=270,onder=1700;y=boven+Math.max(0,(onder-boven-tot)/2);
  // titel
  c.save();c.shadowColor="rgba(0,0,0,.35)";c.shadowOffsetY=6;
  kr.forEach((l,i)=>bkTekst(c,l,W/2,y+kf*0.85+i*klh,`${kf}px ${F.kop}`,K.geel,"center"));c.restore();
  y+=H_KOP+GAP;
  // datumkaart
  const dw=W-2*m-80,dx=(W-dw)/2;
  c.save();c.shadowColor="rgba(0,0,0,.35)";c.shadowBlur=24;c.shadowOffsetY=8;bkRond(c,dx,y,dw,H_DATUM,34);c.fillStyle=K.vlak;c.fill();c.restore();
  bkRond(c,dx,y,dw,H_DATUM,34);c.lineWidth=4;c.strokeStyle=K.geel;c.stroke();
  bkTekst(c,dagNaam.charAt(0).toUpperCase()+dagNaam.slice(1),W/2,y+66,`800 40px ${F.tekst}`,K.ink2,"center");
  let df=92;c.font=`${df}px ${F.kop}`;while(c.measureText(datum).width>dw-60&&df>48)c.font=`${df-=4}px ${F.kop}`;
  bkTekst(c,datum,W/2,y+158,c.font,"#fff","center");
  bkTekst(c,tijd,W/2,y+218,`800 44px ${F.tekst}`,K.geel,"center");
  y+=H_DATUM+GAP;
  // plek: groen labeltje met speldje
  c.font=`800 40px ${F.tekst}`;const pl=pbRegels(c,d.plek,W-2*m-120,1)[0]||"";const pw=c.measureText(pl).width+100,ph=H_PLEK,px=(W-pw)/2;
  bkRond(c,px,y,pw,ph,ph/2);c.fillStyle=K.groen;c.fill();
  pbSpeld(c,px+38,y+ph/2,K.geel);
  bkTekst(c,pl,px+66,y+ph*0.68,c.font,"#fff","left");
  y+=H_PLEK+GAP;
  // omschrijving
  if(or.length){or.forEach((l,i)=>bkTekst(c,l,W/2,y+40+i*olh,`700 40px ${F.tekst}`,"#fff","center"));y+=H_OM+GAP}
  // plekke vrè / vol / welkom
  if(pil){c.font=`800 38px ${F.tekst}`;const t=pbRegels(c,pil,W-2*m-60,1)[0]||"",w=c.measureText(t).width+70,x=(W-w)/2;
    bkRond(c,x,y,w,H_PIL,H_PIL/2);
    if(d.vol){c.fillStyle="#c0392b";c.fill();bkTekst(c,t,W/2,y+H_PIL*0.65,c.font,"#fff","center")}
    else{c.lineWidth=4;c.strokeStyle=K.geel;c.stroke();c.fillStyle="rgba(245,197,24,.14)";c.fill();bkTekst(c,t,W/2,y+H_PIL*0.65,c.font,K.geel,"center")}
    y+=H_PIL+GAP}
  // oproep + account
  bkTekst(c,d.vol?T.ctaVol:T.cta,W/2,y+46,`800 44px ${F.tekst}`,"#fff","center");
  bkTekst(c,"@"+EV_IK,W/2,y+100,`700 36px ${F.tekst}`,K.groenL,"center");
  // vanaf 1740: vrij voâh de link-sticker
}
function evsDicht(){if(!EVS)return;const t=EVS.terug;EVS=null;$("evsPop").hidden=true;
  if(![...document.querySelectorAll(".vnpop")].some(x=>!x.hidden))document.body.classList.remove("popopen");
  if(t&&t.isConnected&&t.focus)t.focus({preventScroll:true})}
function evsNaam(){const d=evData(),n=new Date(),p=x=>String(x).padStart(2,"0");
  const t=String(d&&d.titel||"event").replace(/[^\p{L}\p{N}._ -]/gu,"").trim().slice(0,40)||"event";
  return `${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())} The_HagueBeachlife Event ${t}.png`}
function evsBlob(){return new Promise((res,rej)=>{try{$("evsCanvas").toBlob(b=>b?res(b):rej(new Error("leeg")),"image/png")}catch(e){rej(e)}})}
async function evsDelen(){
  try{const f=new File([await evsBlob()],evsNaam(),{type:"image/png"});await navigator.share({files:[f]});$("evsStatus").textContent="✓ Gedeeld.";evNaarUitgenodigd()}
  catch(e){if(e&&e.name==="AbortError")return;$("evsStatus").textContent="Dele lukte nie: "+(e&&e.message||e)+". Probeer Downloade."}
}
async function evsDownloaden(){
  try{const n=evsNaam();bkBewaar(await evsBlob(),n);$("evsStatus").textContent=`✓ Opgeslage in je Downloads als "${n}".`;evNaarUitgenodigd()}
  catch(e){$("evsStatus").textContent="Downloade lukte nie: "+(e&&e.message||e)}
}

/* ---------- klikken en typen ---------- */
document.addEventListener("click",e=>{
  const t=e.target;if(!t.closest)return;
  // story-pop-up ligt bovenop
  if(EVS){
    if(t.closest("#evsDicht")||t.id==="evsPop")return evsDicht();
    const tb=t.closest("#evsTaal button");if(tb){EVS.taal=tb.dataset.v;store.set("hc_event_taal",EVS.taal);evsKnoppen();evsTekenNu();if(EVF)evUitTeken();return}
    if(t.closest("#evsDeel"))return evsDelen();
    if(t.closest("#evsDownload"))return evsDownloaden();
    if(t.closest("#evsPop"))return;
  }
  if(t.closest("#evNieuw"))return evOpen(null,t.closest("button"));
  const fb=t.closest("[data-evf]");if(fb){EV.filter=EV.filter===fb.dataset.evf&&fb.dataset.evf!=="alles"?"alles":fb.dataset.evf;renderEvents();return}
  const so=t.closest("[data-evsorry]");if(so){e.stopPropagation();const ev=evVan(so.dataset.evsorry);if(ev)evKopieer(evSorry(ev.titel,evTaal()),so,"Gekopieerd ✓");return}
  const kb=t.closest("[data-evkaart]");
  if(kb&&!t.closest("#evPop")){if(t.closest("a"))return;return evOpen(kb.dataset.evkaart,kb)}
  if(!EVF)return;
  if(t.closest("#evDicht")||t.closest("#evAnnuleer"))return evDicht(!!EVF.wasVuil);
  if(t.id==="evPop")return evDicht();
  if(t.closest("#evWisEvent")){EVF.bevestig="event";evBewaarInvoer();return}
  if(t.closest("#evNeeWis")){EVF.bevestig=null;evBewaarInvoer();return}
  if(t.closest("#evJaWis"))return evWis();
  const sk=t.closest("[data-evst]");if(sk){evZetStatus(sk.dataset.evst);EVF.vuil=true;return}
  // gasten
  const gs=t.closest("[data-evgst]");if(gs)return evGastStatus(gs.dataset.evg,gs.dataset.evgst);
  const gb=t.closest("[data-evgbewerk]");if(gb){EVF.gast=gb.dataset.evgbewerk;evGastenTeken();const n=$("evgNaam");if(n)n.focus({preventScroll:true});return}
  const gw=t.closest("[data-evgwis]");if(gw)return evGastWis(gw.dataset.evgwis,gw);
  if(t.closest("#evgOpslaan"))return evGastOpslaan();
  if(t.closest("#evgStop")){EVF.gast=null;evGastenTeken();return}
  if(t.closest("#evWisContact"))return evContactWis();
  // uitnodigen
  const tl=t.closest("[data-evtaal]");if(tl){store.set("hc_event_taal",tl.dataset.evtaal);evUitTeken();return}
  if(t.closest("#evKopieer")){const d=evData();if(d){evKopieer(evUitnodiging(d,evTaal()),t.closest("#evKopieer"));evNaarUitgenodigd()}return}
  if(t.closest("#evWa")||t.closest("#evAgUit")){evNaarUitgenodigd();return}
  if(t.closest("#evSorryForm")){const d=evData();if(d)evKopieer(evSorry(d.titel,evTaal()),t.closest("#evSorryForm"));return}
  if(t.closest("#evStoryKnop"))return evsOpen(t.closest("button"));
  if(t.closest("#evIcs")){const d=evData();if(d)agIcs(evEigen(d),"event-"+d.titel);return}
});
// formulier opnieuw tekenen (bijv. voor de wis-bevestiging) zonder getypte tekst kwijt te raken
function evBewaarInvoer(){
  const f=$("evF"),w={};if(f)[...f.elements].forEach(x=>{if(x.name)w[x.name]=x.value});
  evFormTeken();const g=$("evF");if(!g)return;
  [...g.elements].forEach(x=>{if(x.name&&x.name in w)x.value=w[x.name]});
  evZetStatus(g.status.value);evGastenTeken();evUitTeken();
  const b=$("evPop").querySelector(".hpbevestig");if(b)b.scrollIntoView({block:"nearest"});
}
document.addEventListener("submit",e=>{if(e.target.id==="evF"){e.preventDefault();evOpslaan()}});
document.addEventListener("input",e=>{
  const t=e.target;
  if(EVS&&t.id==="evsVrij"){EVS.vrij=t.checked;evsTekenNu();return}
  if(!EVF)return;
  if(t.id==="evgAkkoord"){const m=$("evgEmail");m.disabled=!t.checked;if(t.checked)m.focus({preventScroll:true});return}
  if(t.closest("#evGasten"))return;              // gastvelden: nie het hele formulier vuil
  if(!t.closest("#evF"))return;
  EVF.vuil=true;EVF.wasVuil=false;
  if(["titel","plek","d","t","te","soort","max","omschrijving"].includes(t.name)){evUitTeken();if(t.name==="max")evGastenTeken()}
});
// Enter in een gastveld = gast toevoegen (nie het hele formulier opslaan)
document.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&EVF&&e.target.closest&&e.target.closest(".evgastnieuw")&&e.target.tagName==="INPUT"){e.preventDefault();evGastOpslaan();return}
  if(!EVF&&!EVS&&(e.key==="Enter"||e.key===" ")){const r=e.target.closest&&e.target.closest(".evregel");if(r&&e.target===r){e.preventDefault();evOpen(r.dataset.evkaart,r)}}
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  if(EVS){e.preventDefault();e.stopImmediatePropagation();evsDicht();return}
  if(EVF&&!$("evPop").hidden){e.preventDefault();e.stopImmediatePropagation();evDicht()}
},true);
