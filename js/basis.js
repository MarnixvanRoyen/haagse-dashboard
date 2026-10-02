// basis.js — gedeelde hulpjes: opslag, getallen/datums opmaken, $(), tooltip, meldingen

const MONTHS=["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
let regionNames; try{regionNames=new Intl.DisplayNames(["nl"],{type:"region"})}catch(e){}

const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}},del(k){try{localStorage.removeItem(k)}catch(e){}}};

/* ---------- formatting ---------- */
const nf2=new Intl.NumberFormat("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2});
const nf0=new Intl.NumberFormat("nl-NL",{maximumFractionDigits:0});
function eur(v,precise){if(!precise&&v>0&&v<0.005)return "< € 0,01";return "€ "+(precise?new Intl.NumberFormat("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:4}).format(v):nf2.format(v))}
function usd(v){return "$ "+nf2.format(v)}
function pct(v){return nf0.format(v*100)+"%"}
function mLabel(m,long){const[y,mm]=m.split("-");return long?MONTHS[+mm-1]+" "+y:MONTHS[+mm-1]+" '"+y.slice(2)}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function pName(p){return PARTNERS[p]||p.charAt(0)+p.slice(1).toLowerCase().replace(/_/g," ")}
function cName(c){if(!c)return "Onbekend";try{return regionNames?regionNames.of(c):c}catch(e){return c}}

const $=id=>document.getElementById(id);

// nette schaalverdeling: stap = 1, 2, 2½ of 5 × 10ⁿ, maar altijd een heel getal (dus nooit 12,5 of 2,5)
function schaal(max,stappen){const m=Math.max(max,1),ruw=m/stappen,p=Math.pow(10,Math.floor(Math.log10(ruw)));
  const stap=Math.max(1,[1,2,2.5,5,10].map(x=>x*p).find(x=>x>=ruw&&Number.isInteger(x)));
  const top=stap*Math.ceil(m/stap),lijnen=[];for(let v=0;v<=top+1e-9;v+=stap)lijnen.push(v);return {top,lijnen}}
function niceMax(v){if(v<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(v)));for(const s of [1,2,2.5,5,10]){if(s*p>=v)return s*p}return 10*p}

function roundTop(x,yTop,w,h,r){r=Math.min(r,h,w/2);const yb=yTop+h;
  return `M${x},${yb}V${yTop+r}Q${x},${yTop} ${x+r},${yTop}H${x+w-r}Q${x+w},${yTop} ${x+w},${yTop+r}V${yb}Z`}
function showTip(e,html){
  const inGrafiek=e.target&&e.target.closest&&e.target.closest(".chart");
  if(inGrafiek&&matchMedia("(hover:none)").matches)return;   // telefoon: het getal boven de staaf is genoeg, geen groot vak over de grafiek
  const t=$("tip");t.innerHTML=html;t.hidden=false;const r=t.getBoundingClientRect();
  const dx=inGrafiek?36:14;                                    // in een grafiek: opzij van het getal boven de staaf
  let x=e.clientX+dx,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-dx;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;t.style.left=x+"px";t.style.top=y+"px"}
function hideTip(){$("tip").hidden=true}

/* ---------- getal boven een staaf ----------
   Elke staaf heeft een onzichtbaar aanwijs-vlak (rect.hit). staafGetal() geeft dat vlak het getal mee;
   muis erop = getal verschijnt, tikken/klikken = getal blijft staan tot je ergens anders tikt.
   Het getal wordt als laatste in de grafiek gezet, zodat geen andere staaf eroverheen valt. */
// datum (sinds 01-10): optioneel 4e stukje, bv. dKort("2026-09-30") → "di 30 sep". Staat vóór het getal: "di 30 sep · 2.566",
// zodat je ook op de telefoon (geen zweef-vak) ziet over welke dag/maand/post het getal gaat.
function staafGetal(xMid,yTop,tekst,datum){return ` data-bv="${esc(tekst)}"${datum?` data-bd="${esc(datum)}"`:""} data-bx="${xMid.toFixed(1)}" data-by="${(yTop-7).toFixed(1)}"`}
const DAG_KORT=["zo","ma","di","wo","do","vr","za"];
function dKort(d){return DAG_KORT[new Date(d+"T12:00:00Z").getUTCDay()]+" "+dLabel(d)}   // "di 30 sep"
function toonGetal(hit){
  const svg=hit.ownerSVGElement;if(!svg||hit.dataset.bv==null)return;
  const NS="http://www.w3.org/2000/svg";
  let t=svg.querySelector("text.bv");
  if(!t){t=document.createElementNS(NS,"text");t.setAttribute("class","bv");t.setAttribute("text-anchor","middle")}
  svg.appendChild(t);                                            // altijd bovenop
  const W=svg.viewBox.baseVal.width||9999;
  t.textContent="";
  if(hit.dataset.bd){const d=document.createElementNS(NS,"tspan");d.setAttribute("class","bvd");d.textContent=hit.dataset.bd+" · ";t.appendChild(d)}
  t.appendChild(document.createTextNode(hit.dataset.bv));
  t.setAttribute("y",hit.dataset.by);
  let half=24;try{half=Math.max(24,t.getComputedTextLength()/2+4)}catch(e){}   // hele tekst binnen de grafiek houden (ook met datum erbij)
  t.setAttribute("x",half*2>=W?W/2:Math.min(Math.max(+hit.dataset.bx,half),W-half));
  t.classList.add("zien");
}
function verbergGetal(svg){const t=svg&&svg.querySelector("text.bv");if(t)t.classList.remove("zien")}
document.addEventListener("mouseover",e=>{const h=e.target.closest&&e.target.closest(".chart .hit");if(h)toonGetal(h)});
document.addEventListener("mouseout",e=>{
  const h=e.target.closest&&e.target.closest(".chart .hit");if(!h)return;
  const naar=e.relatedTarget&&e.relatedTarget.closest&&e.relatedTarget.closest(".chart .hit");
  if(naar&&naar.ownerSVGElement===h.ownerSVGElement)return;   // door naar de volgende staaf: die toont zichzelf
  const vast=h.ownerSVGElement&&h.ownerSVGElement.querySelector(".hit.aan");
  vast?toonGetal(vast):verbergGetal(h.ownerSVGElement);        // vastgetikte staaf blijft staan
});
document.addEventListener("click",e=>{
  const hit=e.target.closest&&e.target.closest(".chart .hit");
  document.querySelectorAll(".chart .hit.aan").forEach(h=>{if(h!==hit){h.classList.remove("aan");verbergGetal(h.ownerSVGElement)}});
  if(hit){if(hit.classList.toggle("aan"))toonGetal(hit);else{verbergGetal(hit.ownerSVGElement);hideTip()}}
  else hideTip();
});
// vegen (telefoon, 02-10): vinger over de staven slepen = het getal van de staaf onder je vinger, net als met de muis.
// Pas vanaf 12 px bewegen (anders is het gewoon tikken en regelt de click hierboven het). Laatste staaf blijft staan.
let veeg=null;
document.addEventListener("touchstart",e=>{const h=e.target.closest&&e.target.closest(".chart .hit");const t=e.touches[0];
  veeg=h&&t?{svg:h.ownerSVGElement,x:t.clientX,y:t.clientY,aan:false}:null},{passive:true});
document.addEventListener("touchmove",e=>{const t=e.touches[0];if(!veeg||!t)return;
  if(!veeg.aan&&Math.hypot(t.clientX-veeg.x,t.clientY-veeg.y)<12)return;veeg.aan=true;
  const el=document.elementFromPoint(t.clientX,t.clientY),h=el&&el.closest&&el.closest(".chart .hit");
  if(!h||h.ownerSVGElement!==veeg.svg||h.classList.contains("aan"))return;
  veeg.svg.querySelectorAll(".hit.aan").forEach(x=>x.classList.remove("aan"));h.classList.add("aan");toonGetal(h)},{passive:true});
document.addEventListener("touchend",()=>{veeg=null},{passive:true});
document.addEventListener("touchcancel",()=>{veeg=null},{passive:true});

let msgT;function showMsg(t,good,sticky){clearTimeout(msgT);const n=$("notes");n.innerHTML=esc(t);n.hidden=false;n.style.background=good?"var(--good-soft)":"var(--warn-soft)";if(!sticky)msgT=setTimeout(()=>{n.style.background="";renderNotes()},good?6000:12000)}

function dLabel(d,long){const[y,m,dd]=d.split("-");return long?(+dd)+" "+MONTHS[+m-1]+" "+y:(+dd)+" "+MONTHS[+m-1]}

