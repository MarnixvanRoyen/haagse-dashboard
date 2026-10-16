// reacties.js — melding bij Insta-reacties waar je nog nie op gereageerd hebt (17-10-2026, chat 48, SQL 38)
//   - Supabase kijkt elk uur (:20) bij Meta welke reacties onder je posts van de laatste 30 dagen nog op je wachten.
//   - Beantwoord = antwoord van jou eronder, óf een latere eigen reactie onder de post met @naam.
//     Reageert dezelfde persoon daarna nog eens (met tekst), dan staat het gesprek weer open ("reageerde opnieuw").
//   - Hier: melding bovenaan Ovâhzicht (#ovAlarm) en bovenaan Insta (#igReac) + groene badge op het menu Insta.
//   - Afvinke = weg uit de melding zonder te reageren (emoji, spam); ongedaan maken kan meteen erna.
//   - Check nâh = korte extra ronde bij Meta (hooguit 1× per 90 s); terugkomen in de app doet dat ook, stil.
//   - Tabel/view nog nie gedraaid (SQL 38)? Dan zie je niks en gaat er niks mis.

const REAC_TOON=3;                        // zoveel meteen zichtbaar, de rest achter "Laat allâh zien"
let RX={rijen:[],stand:null,ok:false,geladen:0,open:false,bezig:false,uitslag:"",undo:null,allesZeker:false};
let reacUndoTimer=null,reacZekerTimer=null,reacLiveOm=0;

async function reacLaden(){
  if(!sb)return;
  try{
    const [r,s]=await Promise.all([
      sb.from("ig_reactie_open").select("comment_id,media_id,gebruiker,tekst,gepost_om,laatste_ander_om,laatste_ander_tekst,vervolg,post_om,permalink,plaatje,bijschrift,product")
        .order("laatste_ander_om",{ascending:false}).limit(200),
      sb.from("ig_reactie_stand").select("gelukt_om,fout,fout_om,live_om").limit(1)]);
    if(r.error)throw r.error;
    RX.rijen=r.data||[];RX.stand=(s.data||[])[0]||null;RX.ok=true;
  }catch(e){RX.rijen=[];RX.stand=null;RX.ok=false}   // nog geen SQL 38: stil
  RX.geladen=Date.now();
}
async function reacBijStart(){await reacLaden();reacTeken()}   // start.js

/* ---------- tekenen ---------- */
function reacOud(ts){
  const m=Math.max(0,Math.round((Date.now()-Date.parse(ts))/6e4));
  if(m<2)return "net";if(m<60)return m+" min geleden";
  const u=Math.round(m/60);if(u<24)return u+" uur geleden";
  const d=Math.round(u/24);return d===1?"gistâh":d+" dagen geleden";
}
function reacStandTekst(){
  const s=RX.stand;if(!s||!s.gelukt_om)return "wordt elk uur gecheckt";
  return "gecheckt om "+tijdAms(s.gelukt_om)+(dagNL(s.gelukt_om)!==dagNL(new Date().toISOString())?" ("+dLabel(dagNL(s.gelukt_om))+")":"");
}
// lukte het al een tijd nie (> 3 uur)? Dan eerlijk melden dat de lijst oud kan zijn
function reacStoring(){
  const s=RX.stand;if(!s||!s.fout||!s.fout_om)return "";
  const g=s.gelukt_om?Date.parse(s.gelukt_om):0;
  if(Date.parse(s.fout_om)<=g||Date.now()-g<3*36e5)return "";
  const sleutel=typeof FB_SLEUTELFOUT!=="undefined"&&FB_SLEUTELFOUT.test(s.fout);
  return `<p class="reacstoring">Ik kan de reacties nu nie checke${sleutel?": de Facebook-sleutel werkt nie (zie de gele melding)":" (Meta gaf een fout)"}. Dit lijstje kan oud zijn.</p>`;
}
function reacRij(x){
  const naam=x.gebruiker?"@"+esc(x.gebruiker):"iemand";
  const tekst=esc((x.laatste_ander_tekst||x.tekst||"").trim()).slice(0,280)||"<i>(geen tekst)</i>";
  const link=esc(x.permalink||"#");
  return `<li class="reacrij">
    <a class="igthumb klein" href="${link}" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">${x.plaatje?`<img src="${esc(x.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</a>
    <div class="reactxt"><div class="reacwie"><b>${naam}</b> <span class="reactijd">${x.vervolg?"reageerde opnieuw · ":""}${reacOud(x.laatste_ander_om||x.gepost_om)}</span></div>
      <p>${tekst}</p></div>
    <div class="reacknop"><a class="btn" href="${link}" target="_blank" rel="noopener">Open in Insta</a><button class="btn" type="button" data-reacaf="${esc(x.comment_id)}" aria-label="Afvinke: ${naam}">✓ Afvinke</button></div>
  </li>`;
}
function reacMeldingHTML(){
  if(!RX.ok)return '<div class="reacBox" hidden></div>';
  const l=RX.rijen,n=l.length;
  const undo=RX.undo?`<p class="reacundo" role="status">${RX.undo.length===1?"1 reactie":RX.undo.length+" reacties"} afgevinkt · <button class="reaclink" type="button" data-reacundo>Ongedaan make</button></p>`:"";
  const check=`<button class="reaclink" type="button" data-reaccheck${RX.bezig?" disabled":""}>${RX.bezig?"Bezig…":"Check nâh"}</button>`;
  const uitslag=RX.uitslag?` <span class="reacuitslag">${esc(RX.uitslag)}</span>`:"";
  if(!n)return `<div class="reacBox"><p class="reacklaar"><span aria-hidden="true">💬</span> Allâh reacties beantwoord ✓ <span class="sub">· ${reacStandTekst()} · ${check}${uitslag}</span></p>${undo}${reacStoring()}</div>`;
  const zicht=RX.open?l:l.slice(0,REAC_TOON);
  return `<div class="reacBox"><div class="alarm reac" role="status">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">💬</span><h2>${n===1?"1 reactie wacht op je":n+" reacties wachte op je"}</h2></div>
    <p class="sub">Nog nie op gereageerd, nieuwste eerst · ${reacStandTekst()} · ${check}${uitslag}</p>
    ${reacStoring()}
    <ul class="reaclijst">${zicht.map(reacRij).join("")}</ul>
    ${undo}
    <p class="reacvoet">${n>REAC_TOON?`<button class="btn" type="button" data-reacmeer>${RX.open?"Minder late zien":"Laat allâh zien ("+n+")"}</button>`:""}
      <button class="btn" type="button" data-reacalles>${RX.allesZeker?"Zeker? Tik nog een keâh":"Allâh afvinke"}</button></p>
  </div></div>`;
}
function reacBadge(){
  const b=document.querySelector('nav.hoofdmenu button[data-s="insta"]');if(!b)return;
  const n=RX.ok?RX.rijen.length:0;let s=b.querySelector(".badge.reac");
  if(!n){if(s)s.remove();return}
  if(!s){s=document.createElement("span");s.className="badge reac";b.appendChild(s)}
  s.textContent=n;s.title=n===1?"1 reactie wacht op je":n+" reacties wachte op je";
}
// Twee plekken: bovenaan Ovâhzicht (#ovAlarm, met "Allâh beantwoord ✓" als er niks is) en bovenaan Insta (#igReac, alleen als er iets wacht).
function reacTeken(){
  const act=document.activeElement;let attr=null,waar=null;
  document.querySelectorAll(".reacBox").forEach(b=>{if(act&&b.contains(act)){attr=[...act.attributes].map(a=>a.name).find(a=>a.startsWith("data-reac"));waar=b.parentElement&&b.parentElement.id}});
  const ob=document.querySelector("#ovAlarm .reacBox");if(ob)ob.outerHTML=reacMeldingHTML();
  const ig=$("igReac");if(ig)ig.innerHTML=RX.ok&&(RX.rijen.length||RX.undo)?reacMeldingHTML():"";
  if(attr&&waar&&$(waar)){const t=$(waar).querySelector(`[${attr}]`)||$(waar).querySelector(".reacBox button");if(t)t.focus({preventScroll:true})}   // focus nie kwijt (toetsenbord/VoiceOver)
  reacBadge();
}

/* ---------- acties ---------- */
async function reacAfvinken(ids,aan=true){
  if(!ids.length)return;
  const voor=RX.rijen;
  if(aan){RX.rijen=RX.rijen.filter(x=>!ids.includes(x.comment_id));RX.undo=ids;clearTimeout(reacUndoTimer);
    reacUndoTimer=setTimeout(()=>{RX.undo=null;reacTeken()},8000)}
  else{RX.undo=null}
  reacTeken();
  const {error}=await sb.rpc("ig_reactie_afvinken",{ids,aan});
  if(error){RX.rijen=voor;RX.undo=null;RX.uitslag="Afvinke lukte nie: "+(error.message||"fout");reacTeken();return}
  if(!aan){await reacLaden();reacTeken()}
}
async function reacCheck(stil){
  if(RX.bezig||!RX.ok)return;
  RX.bezig=true;RX.uitslag="";reacLiveOm=Date.now();if(!stil)reacTeken();
  let tekst="";
  try{
    const {data,error}=await sb.rpc("ig_reacties_live");
    if(error)throw error;
    if(data&&data.te_snel)tekst="Net al gecheckt, kan weâh om "+tijdAms(data.weer_om);
    else if(data&&data.fout)tekst="Meta is effe traag of gaf een fout; de uur-ronde pakt 't op";
    else tekst="Gecheckt ✓";
  }catch(e){tekst="Checke lukte nie: "+(e.message||"fout")}
  await reacLaden();
  RX.bezig=false;RX.uitslag=stil?"":tekst;reacTeken();
}

document.addEventListener("click",e=>{
  const a=e.target.closest("[data-reacaf]");if(a){reacAfvinken([a.dataset.reacaf]);return}
  if(e.target.closest("[data-reacundo]")){const ids=RX.undo||[];clearTimeout(reacUndoTimer);reacAfvinken(ids,false);return}
  if(e.target.closest("[data-reaccheck]")){reacCheck(false);return}
  if(e.target.closest("[data-reacmeer]")){RX.open=!RX.open;reacTeken();return}
  if(e.target.closest("[data-reacalles]")){
    if(!RX.allesZeker){RX.allesZeker=true;reacTeken();clearTimeout(reacZekerTimer);reacZekerTimer=setTimeout(()=>{RX.allesZeker=false;reacTeken()},4000);return}
    RX.allesZeker=false;clearTimeout(reacZekerTimer);reacAfvinken(RX.rijen.map(x=>x.comment_id));return}
});
// terug in de app (bijv. net gereageerd in Insta): stil even checken, hooguit 1× per 2 minuten
document.addEventListener("visibilitychange",()=>{
  if(document.hidden||!$("app")||$("app").hidden||!RX.ok)return;
  if(RX.rijen.length&&Date.now()-reacLiveOm>12e4)reacCheck(true);
  else if(Date.now()-RX.geladen>5*6e4)reacLaden().then(reacTeken);
});
