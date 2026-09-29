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
function showTip(e,html){const t=$("tip");t.innerHTML=html;t.hidden=false;const r=t.getBoundingClientRect();
  let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;t.style.left=x+"px";t.style.top=y+"px"}
function hideTip(){$("tip").hidden=true}

let msgT;function showMsg(t,good,sticky){clearTimeout(msgT);const n=$("notes");n.innerHTML=esc(t);n.hidden=false;n.style.background=good?"var(--good-soft)":"var(--warn-soft)";if(!sticky)msgT=setTimeout(()=>{n.style.background="";renderNotes()},good?6000:12000)}

function dLabel(d,long){const[y,m,dd]=d.split("-");return long?(+dd)+" "+MONTHS[+m-1]+" "+y:(+dd)+" "+MONTHS[+m-1]}

