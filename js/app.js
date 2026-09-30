// app.js — het hoofdmenu: Ovâhzicht · Insta · Muziek · Apps · Kansâh

const SECTIES=["ovahzicht","insta","muziek","apps","kansen"];
let sectie="ovahzicht";                            // bij openen altijd op het Ovâhzicht beginnen
store.del("hc_sectie");                            // oude "laatste plek" opruimen
// na de Ververse-knop: terug naar het onderdeel waar je was (alleen voor die ene keer, niet bij gewoon openen)
try{const v=sessionStorage.getItem("hc_ververs");sessionStorage.removeItem("hc_ververs");if(SECTIES.includes(v))sectie=v}catch(e){}

function setSectie(s){
  sectie=s;
  document.querySelectorAll("nav.hoofdmenu button").forEach(b=>b.setAttribute("aria-current",b.dataset.s===s?"page":"false"));
  SECTIES.forEach(x=>$("s-"+x).hidden=x!==s);
  if(s==="muziek")render();          // grafieken opnieuw tekenen nu ze zichtbaar zijn
  if(s==="ovahzicht")renderOvahzicht();
  if(s==="apps")renderSneek();
  if(s==="insta")renderInsta();
  if(s==="kansen")renderKansen();
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
