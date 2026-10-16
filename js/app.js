// app.js — het hoofdmenu: Ovâhzicht · Insta · Threads · Muziek · Apps · Kansâh · Plekkies · Partnâhs (Partnâhs alleen op Mac/iPad)

const SECTIES=["ovahzicht","insta","threads","muziek","apps","kansen","plekkies","partners"];
let sectie="ovahzicht";                            // bij openen altijd op het Ovâhzicht beginnen
store.del("hc_sectie");                            // oude "laatste plek" opruimen
// na de Ververse-knop: terug naar het onderdeel waar je was (alleen voor die ene keer, niet bij gewoon openen)
let VERVERS_GEDRUKT=false;                         // true = net op Ververse gedrukt: live ophalen mag dan al na 5 min (live.js)
try{const v=sessionStorage.getItem("hc_ververs");sessionStorage.removeItem("hc_ververs");if(SECTIES.includes(v)){sectie=v;VERVERS_GEDRUKT=true}}catch(e){}

function setSectie(s){
  sectie=s;
  document.querySelectorAll("nav.hoofdmenu button").forEach(b=>b.setAttribute("aria-current",b.dataset.s===s?"page":"false"));
  SECTIES.forEach(x=>$("s-"+x).hidden=x!==s);
  menuInBeeld();
  if(s==="muziek")render();          // grafieken opnieuw tekenen nu ze zichtbaar zijn
  if(s==="ovahzicht")renderOvahzicht();
  if(s==="apps")renderSneek();
  if(s==="insta")renderInsta();
  if(s==="threads")renderThreads();
  if(s==="kansen")renderKansen();
  if(s==="partners")renderPartners();
  if(s==="plekkies")renderPlekkies();
}
document.querySelectorAll("nav.hoofdmenu button").forEach(b=>b.addEventListener("click",()=>setSectie(b.dataset.s)));
// knoppen op de tegels ("Kèk bè Muziek") springen naar dat onderdeel
document.addEventListener("click",e=>{const b=e.target.closest("[data-ga]");if(b)setSectie(b.dataset.ga)});
// Ververse-knop in de kop: de hele app opnieuw laden, net als sluiten en weer openen
// (als tegel op je beginscherm heb je geen adresbalk en geen omlaag-trekken om te verversen)
$("ververs").addEventListener("click",()=>{
  const b=$("ververs");b.disabled=true;b.classList.add("draait");
  try{sessionStorage.setItem("hc_ververs",sectie)}catch(e){}
  location.reload();
});

// menu (15-10, chat 50): actieve knop in de schuifbalk in beeld schuiven (alleen de balk, nie de pagina) + vaagrandjes als er meer is
function menuInBeeld(){
  const st=$("menuStrook");if(!st)return;const b=st.querySelector('[aria-current="page"]');
  if(b){const l=b.offsetLeft-st.offsetLeft,r=l+b.offsetWidth;
    if(l<st.scrollLeft+8||r>st.scrollLeft+st.clientWidth-8)st.scrollLeft=Math.max(0,l-(st.clientWidth-b.offsetWidth)/2)}
  menuRandjes();
}
function menuRandjes(){const st=$("menuStrook");if(!st)return;
  st.classList.toggle("meer-l",st.scrollLeft>4);st.classList.toggle("meer-r",st.scrollLeft+st.clientWidth<st.scrollWidth-4)}
if($("menuStrook")){$("menuStrook").addEventListener("scroll",menuRandjes,{passive:true});
  // bij het opstarten is het menu nog onzichtbaar (breedte 0): zodra het in beeld komt of van breedte verandert opnieuw meten
  if(window.ResizeObserver)new ResizeObserver(()=>menuInBeeld()).observe($("menuStrook"));else addEventListener("resize",menuInBeeld)}
