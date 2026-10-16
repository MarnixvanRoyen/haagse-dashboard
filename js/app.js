// app.js — het hoofdmenu: Ovâhzicht · Insta · Threads · Muziek · Apps · Kansâh · Plekkies · Events (chat 53) · Partnâhs (Partnâhs alleen op Mac/iPad)
// Telefoon/iPad: Ovâhzicht + keuzemenu (menuKies) dat de andere pagina's openklapt; computer: alles op één regel.

const SECTIES=["ovahzicht","insta","threads","muziek","apps","kansen","plekkies","events","partners"];
let sectie="ovahzicht";                            // bij openen altijd op het Ovâhzicht beginnen
store.del("hc_sectie");                            // oude "laatste plek" opruimen
// na de Ververse-knop: terug naar het onderdeel waar je was (alleen voor die ene keer, niet bij gewoon openen)
let VERVERS_GEDRUKT=false;                         // true = net op Ververse gedrukt: live ophalen mag dan al na 5 min (live.js)
try{const v=sessionStorage.getItem("hc_ververs");sessionStorage.removeItem("hc_ververs");if(SECTIES.includes(v)){sectie=v;VERVERS_GEDRUKT=true}}catch(e){}

function setSectie(s){
  sectie=s;
  document.querySelectorAll("nav.hoofdmenu button[data-s]").forEach(b=>b.setAttribute("aria-current",b.dataset.s===s?"page":"false"));
  SECTIES.forEach(x=>$("s-"+x).hidden=x!==s);
  menuLabel();menuDicht();
  if(s==="muziek")render();          // grafieken opnieuw tekenen nu ze zichtbaar zijn
  if(s==="ovahzicht")renderOvahzicht();
  if(s==="apps")renderSneek();
  if(s==="insta")renderInsta();
  if(s==="threads")renderThreads();
  if(s==="kansen")renderKansen();
  if(s==="partners")renderPartners();
  if(s==="plekkies")renderPlekkies();
  if(s==="events")renderEvents();
}
document.querySelectorAll("nav.hoofdmenu button[data-s]").forEach(b=>b.addEventListener("click",()=>setSectie(b.dataset.s)));
// knoppen op de tegels ("Kèk bè Muziek") springen naar dat onderdeel
document.addEventListener("click",e=>{const b=e.target.closest("[data-ga]");if(b)setSectie(b.dataset.ga)});
// Ververse-knop in de kop: de hele app opnieuw laden, net als sluiten en weer openen
// (als tegel op je beginscherm heb je geen adresbalk en geen omlaag-trekken om te verversen)
$("ververs").addEventListener("click",()=>{
  const b=$("ververs");b.disabled=true;b.classList.add("draait");
  try{sessionStorage.setItem("hc_ververs",sectie)}catch(e){}
  location.reload();
});

// menu (16-10, chat 50): op telefoon/iPad klapt "Kies een pagina ▾" een lijst open met de andere pagina's.
// De knop toont de pagina waar je bent; een rood stipje als er in de lijst een melding (badge) staat.
function menuLabel(){
  const t=$("menuKiesTxt");if(!t)return;
  const b=document.querySelector('#menuLijst button[data-s="'+sectie+'"]');
  t.textContent=b?b.childNodes[0].textContent.trim():"Kies een pagina";
  $("menuKies").classList.toggle("aan",!!b);
  $("menuStip").hidden=!document.querySelector("#menuLijst .badge");
}
function menuDicht(){const n=$("hoofdmenu");if(!n)return;n.classList.remove("open");$("menuKies").setAttribute("aria-expanded","false")}
$("menuKies").addEventListener("click",()=>{const n=$("hoofdmenu"),open=!n.classList.contains("open");
  n.classList.toggle("open",open);$("menuKies").setAttribute("aria-expanded",String(open));
  if(open){const a=document.querySelector('#menuLijst button[aria-current="page"]')||document.querySelector("#menuLijst button");if(a)a.focus({preventScroll:true})}});
document.addEventListener("click",e=>{if($("hoofdmenu").classList.contains("open")&&!e.target.closest("#hoofdmenu"))menuDicht()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("hoofdmenu").classList.contains("open")){menuDicht();$("menuKies").focus()}});
// badges (Insta, Threads, Kansâh) komen later binnen: stipje en label dan bijwerken
if(window.MutationObserver)new MutationObserver(()=>menuLabel()).observe($("menuLijst"),{childList:true,subtree:true});
