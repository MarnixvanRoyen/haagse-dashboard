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
function kolommen(el,data,kleur,aria="Nieuwe spelers per dag",eenheid="nieuw"){
  const W=Math.max(300,Math.round(el.clientWidth||1000)),H=W<600?180:220,ml=30,mr=6,mt=10,mb=26,iw=W-ml-mr,ih=H-mt-mb;
  const sch=schaal(Math.max(...data.map(d=>d.v)),3),top=sch.top, bw=iw/data.length;
  const y=v=>mt+ih-v/top*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`;
  sch.lijnen.forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml-6}" y="${y(t)+4}" text-anchor="end">${nf0.format(t)}</text>`});
  data.forEach((d,i)=>{const h=d.v/top*ih,x=ml+i*bw+bw*.15;
    if(d.v)s+=`<path d="${roundTop(x,y(d.v),bw*.7,h,3)}" fill="var(--${kleur})"/>`;
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${ih}"${staafGetal(ml+i*bw+bw/2,y(d.v),nf0.format(d.v))}><title>${dLabel(d.d,1)}: ${d.v} ${eenheid}</title></rect>`;
    if((data.length-1-i)%7===0)s+=`<text x="${ml+i*bw+bw/2}" y="${H-8}" text-anchor="middle">${dLabel(d.d)}</text>`});
  el.innerHTML=s+"</svg>";
}

function renderSneek(){
  renderGC();
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


/* ---------- GoatCounter: bezoekers en gebeurtenissen (tabellen gc_dag en gc_bronnen, zie 06_goatcounter.sql) ---------- */
let GC={dag:[],bronnen:[],uur:null,err:null};

async function loadGC(){
  try{
    const since=new Date(Date.now()-70*864e5).toISOString().slice(0,10);
    const [d,b]=await Promise.all([
      sb.from("gc_dag").select("dag,pad,event,titel,aantal").gte("dag",since).order("dag").range(0,4999),
      sb.from("gc_bronnen").select("dag,bron,aantal").gte("dag",since).order("dag").range(0,4999)]);
    if(d.error)throw d.error;if(b.error)throw b.error;
    GC={dag:d.data,bronnen:b.data,uur:null,err:null};
    // per uur (08_goatcounter_live.sql): nodig om "vandaag" op Haagse tijd te tellen; ontbreekt de tabel, dan UTC-dag
    const u=await sb.from("gc_uur").select("uur,pad,event,aantal").gte("uur",new Date(Date.now()-3*864e5).toISOString()).range(0,4999);
    if(!u.error)GC.uur=u.data;
  }catch(e){GC={dag:[],bronnen:[],uur:null,err:e.message}}
}
// vandaag (Haagse tijd): bezoekâhs, hoeveel daarvan een potje speelden, en gedeelde scoâhs
function gcVandaag(){
  const vandaag=vandaagAms();let rows,exact=true;
  if(GC.uur)rows=GC.uur.filter(r=>dagNL(r.uur)===vandaag);
  else{exact=false;const d=dagUTC(Date.now());rows=GC.dag.filter(r=>String(r.dag).slice(0,10)===d)}
  const som=f=>rows.filter(f).reduce((a,r)=>a+(+r.aantal||0),0);
  return {bezoek:som(r=>!r.event),speelden:som(r=>r.pad==="potje-gestart"),gedeeld:som(r=>r.pad==="score-gedeeld"),exact};
}

const dagUTC=t=>new Date(t).toISOString().slice(0,10);   // GoatCounter telt in UTC-dagen

function gcCompute(){
  const dagen=[];for(let i=29;i>=0;i--)dagen.push(dagUTC(Date.now()-i*864e5));
  const leeg=()=>Object.fromEntries(dagen.map(d=>[d,0]));
  const bezoek=leeg(),potjes=leeg(),gedeeld=leeg();
  GC.dag.forEach(r=>{const d=String(r.dag).slice(0,10);if(!(d in bezoek))return;
    if(!r.event)bezoek[d]+=+r.aantal;
    else if(r.pad==="potje-gestart")potjes[d]+=+r.aantal;
    else if(r.pad==="score-gedeeld")gedeeld[d]+=+r.aantal});
  const som=(o,a,b)=>dagen.slice(a,b).reduce((s,d)=>s+o[d],0);
  const bron=new Map();GC.bronnen.forEach(r=>{if(!dagen.includes(String(r.dag).slice(0,10)))return;const k=bronNaam(r.bron);bron.set(k,(bron.get(k)||0)+ +r.aantal)});  // facebook.com + www.facebook.com = Facebook
  const bronnen=[...bron].map(([naam,n])=>({naam,n})).sort((a,b)=>b.n-a.n);
  const nieuw30=SNEEK.rows.filter(x=>dagen.includes(dagNL(x.eerst))).length;
  return {dagen:dagen.map(d=>({d,v:bezoek[d]})),
    b7:som(bezoek,-7),b7v:som(bezoek,-14,-7),p7:som(potjes,-7),p7v:som(potjes,-14,-7),g7:som(gedeeld,-7),g7v:som(gedeeld,-14,-7),
    b30:som(bezoek,0),p30:som(potjes,0),g30:som(gedeeld,0),nieuw30,bronnen,
    laatste:GC.dag.reduce((a,r)=>r.dag>a?r.dag:a,"")};
}

// mooie namen voor bronnen
function bronNaam(n){const l=n.toLowerCase();
  if(l==="(direct)")return "Direct";
  if(/instagram/.test(l))return "Instagram";if(/whatsapp/.test(l))return "WhatsApp";
  if(/facebook|fb\.|m\.facebook/.test(l))return "Facebook";if(/^(www\.)?haagsesneek\.nl/.test(l))return "Eigen site";if(/google/.test(l))return "Google";return n}

function renderGC(){
  if(!$("gcBlok"))return;   // oude index.html in de cache? dan niet vastlopen
  const kanNie=GC.err||!GC.dag.length;
  $("gcBlok").hidden=!!kanNie;$("gcNog").hidden=!kanNie;
  if(kanNie){$("gcNogTekst").innerHTML=GC.err&&/gc_dag|relation|schema cache/i.test(GC.err)
      ?"De GoatCounter-tabellen bestaan nog niet. Zet de sleutel in de Vault en draai <code>supabase/06_goatcounter.sql</code>."
      :GC.err?"GoatCounter-cijfâhs ophale lukte nie: "+esc(GC.err):"Nog geen metingen. Draai <code>select public.gc_refresh(14);</code> in Supabase of wacht tot vannacht.";return}
  const g=gcCompute();
  const vs=(a,b)=>`vorige week ${nf0.format(b)}${a>b?' <span class="up">↑</span>':""}`;
  const top=g.bronnen.find(b=>b.naam!=="Direct")||g.bronnen[0];
  const v=gcVandaag();
  $("gcStats").innerHTML=[
    ["Vandaag",nf0.format(v.bezoek)+" bezoekâhs",`${nf0.format(v.speelden)} speelden een potje${v.bezoek?" ("+pct(Math.min(1,v.speelden/v.bezoek))+")":""}${v.gedeeld?" · "+nf0.format(v.gedeeld)+" scoâhs gedeeld":""}${liveStatus("gc","08_goatcounter_live.sql")}`],
    ["Bezoekâhs",nf0.format(g.b7),"laatste 7 dagen · "+vs(g.b7,g.b7v)],
    ["Speelden een potje",nf0.format(g.p7),g.b7?`${pct(Math.min(1,g.p7/g.b7))} van de bezoekâhs · `+vs(g.p7,g.p7v):vs(g.p7,g.p7v)],
    ["Scoâhs gedeeld",nf0.format(g.g7),"in een story · "+vs(g.g7,g.g7v)],
    ["Beste bron",top?esc(bronNaam(top.naam)):"—",top&&g.b30?pct(top.n/g.bronnen.reduce((a,b)=>a+b.n,0))+" van de bezoekâhs (30 dagen)":""]
  ].map(([k,v,s])=>`<div class="ytstat"><span class="k">${k}</span><span class="v" title="${v}">${v}</span><span class="s">${s}</span></div>`).join("");
  $("gcSub").textContent="Uit GoatCounter, ververst zodra je het dashboard opent (hooguit 1x per 10 min)"+(g.laatste?" · laatste meting "+dLabel(String(g.laatste).slice(0,10),1):"");
  kolommen($("gcChart"),g.dagen,"hy","Bezoekers per dag","bezoekâhs");
  const mb=Math.max(1,...g.bronnen.map(b=>b.n)),tb=g.bronnen.reduce((a,b)=>a+b.n,0);
  $("gcBronnen").innerHTML=g.bronnen.length?g.bronnen.slice(0,8).map((b,i)=>bar(bronNaam(b.naam),[{v:b.n,c:"hy"}],mb,nf0.format(b.n)+" · "+pct(tb?b.n/tb:0),"",i+1)).join(""):'<p class="sub">Nog geen bronnen gemeten.</p>';
  const stappen=[["Bezoekâhs",g.b30],["Speelden een potje",g.p30],["Nieuw op de lèst",g.nieuw30],["Scoâh gedeeld",g.g30]];
  const mt=Math.max(1,...stappen.map(s=>s[1]));
  $("gcTrechter").innerHTML=stappen.map(([n,v],i)=>bar(n,[{v,c:i?"groen":"hy"}],mt,nf0.format(v)+(i&&g.b30?" · "+pct(v/g.b30):""),"",i+1)).join("")+
    '<p class="sub" style="margin:10px 0 0">Percentages t.o.v. het aantal bezoekâhs. GoatCounter telt elke bezoekâh 1 keer per 8 uur, ook als die meerdere potjes speelt.</p>';
}
$("gcRefresh").addEventListener("click",async e=>{const b=e.target;b.disabled=true;b.textContent="Effe geduld…";
  const {error}=await sb.rpc("gc_refresh",{dagen:3});
  if(error)showMsg("GoatCounter verversen lukte nie: "+error.message);else{LIVE.gc={...(LIVE.gc||{}),om:new Date().toISOString(),fout:null};await loadGC();renderSneek();showMsg("GoatCounter bijgewerkt, âhwe!",true)}
  b.disabled=false;b.textContent="Nâh ververse"});

let snRsz;addEventListener("resize",()=>{clearTimeout(snRsz);snRsz=setTimeout(()=>{if(sectie==="apps")renderSneek()},150)});
