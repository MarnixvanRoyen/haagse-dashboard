// apps.js — onderdeel Apps. Eerste app: Haagse Sneek (www.haagsesneek.nl)
// De scores staan in hetzelfde Supabase-project, tabel "scores" (1 regel per Insta-naam, alleen de beste score).

let SNEEK={rows:[],err:null,metEerst:true};

async function loadSneek(){
  try{
    let rows;
    // eerst_gezien = wanneer iemand vóór het eerst op de lèst kwam (kolom uit 05_sneek.sql)
    try{rows=await fetchAll("scores","id,insta,score,created_at,eerst_gezien");SNEEK.metEerst=true}
    catch(e){rows=await fetchAll("scores","id,insta,score,created_at");SNEEK.metEerst=false}
    SNEEK.rows=rows.map(r=>({insta:r.insta,score:+r.score,beste:r.created_at,eerst:r.eerst_gezien||r.created_at}));
    SNEEK.err=null;
  }catch(e){SNEEK={rows:[],err:e.message,metEerst:false}}
}

// datum als JJJJ-MM-DD in Nederlandse tijd
const dagNL=t=>new Date(t).toLocaleDateString("sv-SE",{timeZone:"Europe/Amsterdam"});

const GROEPJES=[[1,9,"1 – 9"],[10,24,"10 – 24"],[25,49,"25 – 49"],[50,99,"50 – 99"],[100,1000,"100 of meer"]];

function sneekCompute(){
  const r=SNEEK.rows;
  const dagen=[];for(let i=29;i>=0;i--)dagen.push(dagNL(Date.now()-i*864e5));
  const perDag=Object.fromEntries(dagen.map(d=>[d,0]));
  r.forEach(x=>{const d=dagNL(x.eerst);if(d in perDag)perDag[d]++});
  const som=a=>a.reduce((s,d)=>s+perDag[d],0);
  const scores=r.map(x=>x.score).sort((a,b)=>a-b);
  const mediaan=scores.length?scores[Math.floor((scores.length-1)/2)]:0;
  return {
    spelers:r.length,
    nieuw7:som(dagen.slice(-7)), vorige7:som(dagen.slice(-14,-7)),
    dagen:dagen.map(d=>({d,v:perDag[d]})),
    top:[...r].sort((a,b)=>b.score-a.score||String(a.beste).localeCompare(String(b.beste))).slice(0,10),
    gem:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0, mediaan,
    groepjes:GROEPJES.map(([lo,hi,naam])=>({naam,n:scores.filter(s=>s>=lo&&s<=hi).length}))
  };
}

// simpele kolommengrafiek, zelfde stijl als de muziekgrafieken
function kolommen(el,data,kleur){
  const W=Math.max(300,Math.round(el.clientWidth||1000)),H=W<600?180:220,ml=30,mr=6,mt=10,mb=26,iw=W-ml-mr,ih=H-mt-mb;
  const top=niceMax(Math.max(1,...data.map(d=>d.v))), bw=iw/data.length;
  const y=v=>mt+ih-v/top*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nieuwe spelers per dag">`;
  [0,top/2,top].forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml-6}" y="${y(t)+4}" text-anchor="end">${nf0.format(t)}</text>`});
  data.forEach((d,i)=>{const h=d.v/top*ih,x=ml+i*bw+bw*.15;
    if(d.v)s+=`<path d="${roundTop(x,y(d.v),bw*.7,h,3)}" fill="var(--${kleur})"/>`;
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${ih}"><title>${dLabel(d.d,1)}: ${d.v} nieuw</title></rect>`;
    if((data.length-1-i)%7===0)s+=`<text x="${ml+i*bw+bw/2}" y="${H-8}" text-anchor="middle">${dLabel(d.d)}</text>`});
  el.innerHTML=s+"</svg>";
}

function renderSneek(){
  if(SNEEK.err){$("snStats").innerHTML=`<p class="sub">Sneek-cijfâhs ophale lukte nie: ${esc(SNEEK.err)}</p>`;return}
  const n=sneekCompute();
  if(!n.spelers){
    $("snStats").innerHTML='<p class="sub">Nog niks te zien. Staat er wél iemand op de lèst? Dan mag het dashboard de tabel nog niet lezen: draai eerst de SQL uit <code>supabase/05_sneek.sql</code>.</p>';
    ["snChart","snTop","snVerdeling"].forEach(id=>$(id).innerHTML="");return}
  const verschil=n.nieuw7-n.vorige7;
  $("snStats").innerHTML=[
    ["Spelâhs op de lèst",nf0.format(n.spelers),"elke Insta-naam telt 1 keer"],
    ["Nieuwe spelâhs",(n.nieuw7?"+":"")+nf0.format(n.nieuw7),`laatste 7 dagen · vorige week ${nf0.format(n.vorige7)}${verschil>0?' <span class="up">↑</span>':""}`],
    ["Hoogste scoâh",nf0.format(n.top[0].score),"@"+esc(n.top[0].insta)],
    ["Gemiddelde scoâh",nf0.format(n.gem),`de helft haalt ${nf0.format(n.mediaan)} of meer`]
  ].map(([k,v,s])=>`<div class="ytstat"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join("");
  $("snDagSub").textContent=SNEEK.metEerst?"Laatste 30 dagen: wanneer iemand vóór het eerst op de lèst kwam"
    :"Laatste 30 dagen. Let op: nu nog de datum van iemands beste scoâh (kolom eerst_gezien ontbreekt)";
  kolommen($("snChart"),n.dagen,"hy");
  $("snTop").innerHTML=`<thead><tr><th class="n">#</th><th>Spelâh</th><th class="n">Scoâh</th><th class="n">Record sinds</th></tr></thead><tbody>`+
    n.top.map((x,i)=>`<tr><td class="n">${i+1}</td><td><a href="https://www.instagram.com/${encodeURIComponent(x.insta)}/" target="_blank" rel="noopener">@${esc(x.insta)}</a></td><td class="n">${nf0.format(x.score)}</td><td class="n">${dLabel(dagNL(x.beste),1)}</td></tr>`).join("")+"</tbody>";
  const max=Math.max(...n.groepjes.map(g=>g.n));
  $("snVerdeling").innerHTML=n.groepjes.map(g=>bar(g.naam,[{v:g.n,c:"hy"}],max,nf0.format(g.n)+" · "+pct(n.spelers?g.n/n.spelers:0),`${g.n} spelâhs met ${g.naam} punte`)).join("");
}

let snRsz;addEventListener("resize",()=>{clearTimeout(snRsz);snRsz=setTimeout(()=>{if(sectie==="apps")renderSneek()},150)});
