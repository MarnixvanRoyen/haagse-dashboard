// app.js — het hoofdmenu: Ovâhzicht · Muziek · Insta · Apps

const SECTIES=["ovahzicht","muziek","insta","apps"];
let sectie="ovahzicht";                            // bij openen altijd op het Ovâhzicht beginnen
store.del("hc_sectie");                            // oude "laatste plek" opruimen

function setSectie(s){
  sectie=s;
  document.querySelectorAll("nav.hoofdmenu button").forEach(b=>b.setAttribute("aria-current",b.dataset.s===s?"page":"false"));
  SECTIES.forEach(x=>$("s-"+x).hidden=x!==s);
  if(s==="muziek")render();          // grafieken opnieuw tekenen nu ze zichtbaar zijn
  if(s==="ovahzicht")renderOvahzicht();
  if(s==="apps")renderSneek();
  if(s==="insta")renderInsta();
}
document.querySelectorAll("nav.hoofdmenu button").forEach(b=>b.addEventListener("click",()=>setSectie(b.dataset.s)));
// knoppen op de tegels ("Kèk bè Muziek") springen naar dat onderdeel
document.addEventListener("click",e=>{const b=e.target.closest("[data-ga]");if(b)setSectie(b.dataset.ga)});
