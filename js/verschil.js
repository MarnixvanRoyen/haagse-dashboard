// verschil.js — tabblad "Wat is d'r nieuw?": nieuwste upload (SoundCloud-CSV / DJ·World-PDF) vs de vorige.
// De momentopnames staan in Supabase-tabel muziek_imports (zie supabase/11_import_historie.sql).

let IMP={lijst:[],data:{},err:null};
const VS={sc:{nieuw:null,oud:null},label:{nieuw:null,oud:null},dim:"nummer",alles:false};

async function loadImports(){
  try{
    const {data,error}=await sb.from("muziek_imports").select("id,bron,bestand,stand_van,samenvatting").order("stand_van").order("id");
    if(error)throw error;
    IMP={lijst:data,data:IMP.data,err:null};
  }catch(e){IMP={lijst:[],data:{},err:e.message}}
}
async function impData(id){
  if(IMP.data[id])return IMP.data[id];
  const {data,error}=await sb.from("muziek_imports").select("data").eq("id",id).single();
  if(error)throw error;
  return IMP.data[id]=data.data;
}

/* ---------- hulpjes ---------- */
const vsEur=usd=>eur(ex(usd));
function vsPlus(v,fmt){const a=Math.abs(v);if(a<1e-9)return "0";return (v>0?"+":"−")+fmt(a)}
const vsPlusEur=usd=>vsPlus(ex(usd),x=>x<0.005?"< € 0,01":"€ "+nf2.format(x));
const vsPlusN=n=>vsPlus(n,x=>nf0.format(x));
function vsDatum(i){return new Date(i.stand_van).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}
function vsNaam(i){return `${vsDatum(i)}${i.bestand?" · "+i.bestand:""}`}
const vsKey=s=>String(s||"").toLowerCase().replace(/\s+/g," ").trim();
function vsKlasse(v){return v>1e-9?"up":v<-1e-9?"down":""}

/* ---------- SoundCloud: twee momentopnames vergelijken ---------- */
// rij = [luistermaand, afrekenmaand, artiest, nummer, platform, soort, land, units, usd]
function scVergelijk(oud,nieuw){
  const groep=(rows,keyF,naamF)=>{const m=new Map();rows.forEach(r=>{const k=keyF(r);let o=m.get(k);if(!o){o={naam:naamF(r),units:0,usd:0};m.set(k,o)}o.units+=+r[7]||0;o.usd+=+r[8]||0});return m};
  const naast=(keyF,naamF)=>{const a=groep(oud,keyF,naamF),b=groep(nieuw,keyF,naamF),out=[];
    new Set([...a.keys(),...b.keys()]).forEach(k=>{const o=a.get(k)||{units:0,usd:0},n=b.get(k)||{units:0,usd:0};
      out.push({key:k,naam:(b.get(k)||a.get(k)).naam,wasU:o.units,nuU:n.units,wasUsd:o.usd,nuUsd:n.usd,dU:n.units-o.units,dUsd:n.usd-o.usd,nieuw:!a.has(k)||o.usd<=0&&n.usd>0})});
    return out};
  const tot=rows=>rows.reduce((a,r)=>({u:a.u+(+r[7]||0),usd:a.usd+(+r[8]||0)}),{u:0,usd:0});
  const maanden=naast(r=>r[0],r=>r[0]).sort((a,b)=>a.key<b.key?-1:1);
  const oudeMaanden=new Set(oud.map(r=>r[0])),oudeAfr=new Set(oud.map(r=>r[1]));
  return {
    was:tot(oud),nu:tot(nieuw),maanden,
    nieuweMaanden:maanden.filter(m=>!oudeMaanden.has(m.key)),
    correcties:maanden.filter(m=>oudeMaanden.has(m.key)&&Math.abs(m.dUsd)>=0.005),
    nieuweAfr:[...new Set(nieuw.map(r=>r[1]))].filter(a=>!oudeAfr.has(a)).sort(),
    nummer:naast(r=>vsKey(r[3])+"|"+normArtist(r[2]),r=>r[3]||"(zonder titel)"),
    platform:naast(r=>r[4],r=>pName(r[4])),
    land:naast(r=>r[6],r=>cName(r[6])),
    soort:naast(r=>r[5],r=>TYPES[r[5]]||r[5]||"Onbekend"),
    subAandeel:rows=>{const t=tot(rows).usd;return t?rows.filter(r=>r[5]==="SUB_STREAM").reduce((a,r)=>a+(+r[8]||0),0)/t:0},
    oud,nieuw
  };
}
function scInzichten(v){
  const uit=[];
  // 1. nieuwe maand(en) binnen, vergeleken met de 3 maanden ervoor
  v.nieuweMaanden.forEach(m=>{
    const eerder=v.maanden.filter(x=>x.key<m.key&&x.nuUsd>0).slice(-3);
    const gem=eerder.length?eerder.reduce((a,x)=>a+x.nuUsd,0)/eerder.length:0;
    const rel=gem?(m.nuUsd-gem)/gem:null;
    uit.push({kop:`${mLabel(m.key,1)} is binnen`,tekst:`${vsEur(m.nuUsd)} uit ${nf0.format(m.nuU)} streams.`+
      (rel!=null?` Dat is ${pct(Math.abs(rel))} ${rel>=0?"meer":"minder"} dan je gemiddelde van de ${eerder.length} maanden ervoor (${vsEur(gem)}).`:""),goed:rel==null||rel>=0});
  });
  // 2. beste groeier (nummer)
  const nr=[...v.nummer].filter(x=>x.dUsd>0).sort((a,b)=>b.dUsd-a.dUsd);
  if(nr[0])uit.push({kop:`${nr[0].naam} deed 't beste`,tekst:`${vsPlusEur(nr[0].dUsd)} erbè (${vsPlusN(nr[0].dU)} streams). `+
    (nr[1]?`Daarna ${nr[1].naam} (${vsPlusEur(nr[1].dUsd)})${nr[2]?" en "+nr[2].naam+" ("+vsPlusEur(nr[2].dUsd)+")":""}.`:""),goed:true});
  // 3. waar kwam het nieuwe geld vandaan (platform)
  const pl=[...v.platform].filter(x=>x.dUsd>0).sort((a,b)=>b.dUsd-a.dUsd),dTot=v.nu.usd-v.was.usd;
  if(pl[0]&&dTot>0)uit.push({kop:`Meeste nieuwe poen via ${pl[0].naam}`,tekst:`${pct(Math.min(1,pl[0].dUsd/dTot))} van wat erbè kwam (${vsPlusEur(pl[0].dUsd)}).`+
    (pl.length>1?` Verder: ${pl.slice(1,4).map(p=>p.naam+" "+vsPlusEur(p.dUsd)).join(", ")}.`:""),goed:true});
  // 4. nummers die voor het eerst geld opleveren
  const nieuwNr=v.nummer.filter(x=>x.nieuw&&x.nuUsd>0).sort((a,b)=>b.nuUsd-a.nuUsd);
  if(nieuwNr.length)uit.push({kop:nieuwNr.length===1?"Eerste poen voor een nummer":`${nieuwNr.length} nummers voor het eerst betaald`,
    tekst:nieuwNr.slice(0,5).map(x=>`${x.naam} (${vsEur(x.nuUsd)})`).join(", ")+(nieuwNr.length>5?", …":"")+".",goed:true});
  // 5. nieuwe landen
  const nieuwLand=v.land.filter(x=>x.nieuw&&x.nuUsd>0&&x.key).sort((a,b)=>b.nuUsd-a.nuUsd);
  if(nieuwLand.length)uit.push({kop:nieuwLand.length===1?"Nieuw land":`${nieuwLand.length} nieuwe landen`,tekst:nieuwLand.slice(0,6).map(x=>x.naam).join(", ")+(nieuwLand.length===1?" luisterde":" luisterden")+" voor het eerst mee.",goed:true});
  // 6. wat levert een stream nu op
  const dU=v.nu.u-v.was.u;
  if(dU>=50&&v.was.u>0){const nu=dTot/dU*1000,eerder=v.was.usd/v.was.u*1000,rel=(nu-eerder)/eerder;
    uit.push({kop:`${eur(ex(nu))} per 1.000 nieuwe streams`,tekst:`Eerder gemiddeld ${eur(ex(eerder))}: ${pct(Math.abs(rel))} ${rel>=0?"meer":"minder"}. `+
      `Aandeel van betalende abonnees in het geld: ${pct(v.subAandeel(v.nieuw))} (was ${pct(v.subAandeel(v.oud))}).`,goed:rel>=0});}
  // 7. correcties in oude maanden
  if(v.correcties.length){const som=v.correcties.reduce((a,m)=>a+m.dUsd,0);
    uit.push({kop:"SoundCloud paste oude maanden aan",tekst:v.correcties.slice(0,4).map(m=>`${mLabel(m.key)} ${vsPlusEur(m.dUsd)}`).join(", ")+(v.correcties.length>4?", …":"")+
      `. Samen ${vsPlusEur(som)}. Dat gebeurt vaker: late meldingen van platforms komen later nog binnen.`,goed:som>=0});}
  // 8. dalers
  const dalers=[...v.nummer].filter(x=>x.dUsd<=-0.005).sort((a,b)=>a.dUsd-b.dUsd);
  if(dalers.length)uit.push({kop:`${dalers.length} nummer${dalers.length>1?"s":""} lager dan eerst`,tekst:dalers.slice(0,4).map(x=>`${x.naam} ${vsPlusEur(x.dUsd)}`).join(", ")+". Meestal een correctie, geen echte daling.",goed:false});
  if(!uit.length)uit.push({kop:"Niks veranderd",tekst:"Deze twee uploads hebben dezelfde bedragen.",goed:true});
  return uit;
}

/* ---------- DJ·World ---------- */
function lbVergelijk(oud,nieuw){
  const per=(a,b,keyF)=>{const A=new Map((a||[]).map(x=>[keyF(x),x])),B=new Map((b||[]).map(x=>[keyF(x),x])),out=[];
    new Set([...A.keys(),...B.keys()]).forEach(k=>out.push({key:k,was:A.get(k)||null,nu:B.get(k)||null}));return out};
  const som=(l,f)=>(l||[]).reduce((a,x)=>a+(+x[f]||0),0);
  return {periodes:per(oud.periodes,nieuw.periodes,p=>p.m+"|"+p.naam).sort((a,b)=>a.key<b.key?-1:1),
    nummers:per(oud.nummers,nieuw.nummers,t=>vsKey(t.t)+"|"+(t.v||"")),
    was:{netto:som(oud.periodes,"netto"),streams:som(oud.nummers,"streams"),downloads:som(oud.nummers,"downloads")},
    nu:{netto:som(nieuw.periodes,"netto"),streams:som(nieuw.nummers,"streams"),downloads:som(nieuw.nummers,"downloads")},
    saldoWas:oud.saldo||{},saldoNu:nieuw.saldo||{}};
}

/* ---------- tekenen ---------- */
function vsKiezer(bron,lijst){
  const opt=sel=>lijst.map(i=>`<option value="${i.id}"${i.id===sel?" selected":""}>${esc(vsNaam(i))}</option>`).slice().reverse().join("");
  return `<div class="vskies"><label>Nieuw <select data-vs="${bron}-nieuw">${opt(VS[bron].nieuw)}</select></label>
    <label>vs <select data-vs="${bron}-oud">${opt(VS[bron].oud)}</select></label></div>`;
}
function vsTegel(k,v,s,kl){return `<div class="ytstat"><span class="k">${k}</span><span class="v${kl?" "+kl:""}">${v}</span><span class="s">${s}</span></div>`}
function vsKiesStandaard(bron,lijst){
  const ids=lijst.map(i=>i.id);
  if(!ids.includes(VS[bron].nieuw))VS[bron].nieuw=ids[ids.length-1]??null;
  if(!ids.includes(VS[bron].oud)||VS[bron].oud===VS[bron].nieuw)VS[bron].oud=ids.length>1?ids[ids.indexOf(VS[bron].nieuw)-1]??ids[0]:null;
}

let vsTeken=0;
async function renderVerschil(){
  const el=$("vsInhoud");if(!el)return;
  if(IMP.err){el.innerHTML=`<div class="card"><p class="sub">${/muziek_imports|schema cache|relation/i.test(IMP.err)?
    "Dit tabblad heeft de tabel <code>muziek_imports</code> nodig. Draai eerst <code>supabase/11_import_historie.sql</code> in Supabase (vóór je een nieuwe CSV uploadt).":"Uploads ophalen lukte nie: "+esc(IMP.err)}</p></div>`;return}
  const sc=IMP.lijst.filter(i=>i.bron==="sc"),lb=IMP.lijst.filter(i=>i.bron==="label");
  vsKiesStandaard("sc",sc);vsKiesStandaard("label",lb);
  const mijn=++vsTeken;
  el.innerHTML=`<div id="vsSc"><div class="card"><p class="sub">Effe lade…</p></div></div><div id="vsLb"></div>`;
  try{
    const [scHtml,lbHtml]=await Promise.all([scBlok(sc),lbBlok(lb)]);
    if(mijn!==vsTeken)return;                     // intussen opnieuw getekend
    $("vsSc").innerHTML=scHtml;$("vsLb").innerHTML=lbHtml;
  }catch(e){if(mijn===vsTeken)el.innerHTML=`<div class="card"><p class="sub">Vergelijken lukte nie: ${esc(e.message)}</p></div>`}
}

async function scBlok(sc){
  const kop=`<div class="cardhead"><div><h2><i class="dot sc"></i> SoundCloud-afrekening</h2><p class="sub">Wat er veranderd is tussen twee uploads van je lifetime earnings report. Bedragen in euro (koers hierboven).</p></div>${sc.length>1?vsKiezer("sc",sc):""}</div>`;
  if(!sc.length)return `<div class="card">${kop}<p class="sub">Nog geen upload bewaard. Upload je SoundCloud-CSV; de volgende upload wordt daarmee vergeleken.</p></div>`;
  if(sc.length<2)return `<div class="card">${kop}<p class="note">Nulmeting staat klaar: <b>${esc(vsNaam(sc[0]))}</b> (${vsEur(+sc[0].samenvatting.usd||0)}, t/m ${sc[0].samenvatting.laatste_maand?mLabel(sc[0].samenvatting.laatste_maand,1):"—"}). Upload nu je nieuwe CSV met de knop <b>SoundCloud-CSV</b> bovenaan; dan zie je hier meteen wat er veranderd is.</p></div>`;
  const iN=sc.find(i=>i.id===VS.sc.nieuw),iO=sc.find(i=>i.id===VS.sc.oud);
  const [dN,dO]=await Promise.all([impData(iN.id),impData(iO.id)]);
  const v=scVergelijk(dO,dN),dUsd=v.nu.usd-v.was.usd,dU=v.nu.u-v.was.u;
  const nieuwM=v.nieuweMaanden,corr=v.correcties.reduce((a,m)=>a+m.dUsd,0);
  const tegels=[
    vsTegel("Erbè",vsPlusEur(dUsd),`van ${vsEur(v.was.usd)} naar ${vsEur(v.nu.usd)} · ${vsPlus(dUsd,x=>"$ "+nf2.format(x))}`,vsKlasse(dUsd)),
    vsTegel("Nieuwe maanden",nieuwM.length?nieuwM.map(m=>mLabel(m.key)).join(", "):"geen",nieuwM.length?`${vsEur(nieuwM.reduce((a,m)=>a+m.nuUsd,0))}${v.nieuweAfr.length?" · afgerekend in "+v.nieuweAfr.map(a=>mLabel(a)).join(", "):""}`:"geen nieuwe luistermaand in deze upload"),
    vsTegel("Streams erbè",vsPlusN(dU),`van ${nf0.format(v.was.u)} naar ${nf0.format(v.nu.u)} afgerekende streams`,vsKlasse(dU)),
    vsTegel("Correcties",v.correcties.length?vsPlusEur(corr):"geen",v.correcties.length?`in ${v.correcties.length} oude maand${v.correcties.length>1?"en":""}`:"oude maanden zijn gelijk gebleven",v.correcties.length?vsKlasse(corr):""),
    vsTegel("Nieuwe nummers",nf0.format(v.nummer.filter(x=>x.nieuw&&x.nuUsd>0).length),"voor het eerst geld")
  ].join("");
  const ins=scInzichten(v).map(i=>`<li class="${i.goed?"goed":"let"}"><b>${esc(i.kop)}</b><span>${esc(i.tekst)}</span></li>`).join("");
  // per maand: wat er al stond + wat erbij kwam
  const toon=v.maanden.filter(m=>m.nuUsd>0||m.wasUsd>0).slice(-12),max=Math.max(0.0001,...toon.map(m=>Math.max(m.nuUsd,m.wasUsd)));
  const maandBars=toon.map(m=>bar(mLabel(m.key)+(nieuwM.includes(m)?" · nieuw":""),[{v:Math.min(m.wasUsd,m.nuUsd),c:"sc"},{v:Math.max(0,m.dUsd),c:"hy"}],max,
    `${vsEur(m.nuUsd)}${Math.abs(m.dUsd)>=0.005?` <span class="${vsKlasse(m.dUsd)}">${vsPlusEur(m.dUsd)}</span>`:""}`,
    `${mLabel(m.key,1)}: was ${vsEur(m.wasUsd)}, nu ${vsEur(m.nuUsd)} (${nf0.format(m.nuU)} streams)`)).join("");
  // detailtabel
  const dims={nummer:"Nummâh",platform:"Platform",land:"Land",soort:"Soort stream"};
  let rows=[...v[VS.dim]].sort((a,b)=>b.dUsd-a.dUsd||b.dU-a.dU);
  const veranderd=rows.filter(r=>Math.abs(r.dUsd)>=0.005||r.dU!==0);
  if(!VS.alles)rows=veranderd;
  const tabel=`<thead><tr><th>${dims[VS.dim]}</th><th class="n">Streams was</th><th class="n">nu</th><th class="n">erbè</th><th class="n">€ was</th><th class="n">nu</th><th class="n">erbè</th></tr></thead><tbody>`+
    (rows.length?rows.slice(0,VS.alles?500:60).map(r=>`<tr><td><b>${esc(r.naam)}</b>${r.nieuw&&r.nuUsd>0?' <span class="chip good">nieuw</span>':""}</td>
      <td class="n">${nf0.format(r.wasU)}</td><td class="n">${nf0.format(r.nuU)}</td><td class="n ${vsKlasse(r.dU)}">${vsPlusN(r.dU)}</td>
      <td class="n">${vsEur(r.wasUsd)}</td><td class="n">${vsEur(r.nuUsd)}</td><td class="n ${vsKlasse(r.dUsd)}">${vsPlusEur(r.dUsd)}</td></tr>`).join("")
      :`<tr><td colspan="7" class="sub">Niks veranderd in deze indeling.</td></tr>`)+
    `</tbody><tfoot><tr><td>Totaal</td><td class="n">${nf0.format(v.was.u)}</td><td class="n">${nf0.format(v.nu.u)}</td><td class="n">${vsPlusN(dU)}</td><td class="n">${vsEur(v.was.usd)}</td><td class="n">${vsEur(v.nu.usd)}</td><td class="n">${vsPlusEur(dUsd)}</td></tr></tfoot>`;
  return `<div class="card">${kop}<div class="ytstats">${tegels}</div></div>
  <div class="grid2">
    <div class="card"><h2>Wat valt op?</h2><p class="sub">Automatisch uitgerekend uit de twee uploads</p><ul class="vslijst">${ins}</ul></div>
    <div class="card"><div class="cardhead"><div><h2>Per maand</h2><p class="sub">Luistermaanden, laatste 12. Geel = erbè gekomen in de nieuwe upload.</p></div>
      <div class="legend"><span><i class="dot sc"></i>Stond er al</span><span><i class="dot hy"></i>Erbè</span></div></div><div class="bars">${maandBars}</div></div>
  </div>
  <div class="card"><div class="cardhead"><div><h2>Waâh zit het verschil?</h2><p class="sub">${VS.alles?"Alles":"Alleen wat veranderd is ("+veranderd.length+")"}, gesorteerd op € erbè</p></div>
    <div class="vsknoppen"><div class="seg" id="vsDim">${Object.entries(dims).map(([k,n])=>`<button type="button" data-v="${k}" aria-pressed="${VS.dim===k}">${n}</button>`).join("")}</div>
    <button class="btn" type="button" id="vsAlles">${VS.alles?"Alleen verschillen":"Toon alles"}</button></div></div>
    <div class="tablewrap"><table>${tabel}</table></div></div>`;
}

async function lbBlok(lb){
  const kop=`<div class="cardhead"><div><h2><i class="dot lb"></i> DJ·World (label)</h2><p class="sub">Verschil tussen twee totaaloverzichten (PDF). Bedragen netto, in euro.</p></div>${lb.length>1?vsKiezer("label",lb):""}</div>`;
  if(!lb.length)return `<div class="card">${kop}<p class="sub">Nog geen overzicht bewaard.</p></div>`;
  if(lb.length<2)return `<div class="card">${kop}<p class="sub">Nulmeting staat klaar: overzicht van ${lb[0].samenvatting.overzicht_van?dLabel(lb[0].samenvatting.overzicht_van,1):vsDatum(lb[0])} (${eur(+lb[0].samenvatting.netto||0)} netto, ${nf0.format(+lb[0].samenvatting.streams||0)} streams). Laad je volgende DJ·World-PDF in; dan zie je hier wat er veranderd is.</p></div>`;
  const iN=lb.find(i=>i.id===VS.label.nieuw),iO=lb.find(i=>i.id===VS.label.oud);
  const [dN,dO]=await Promise.all([impData(iN.id),impData(iO.id)]);
  const v=lbVergelijk(dO,dN),dNet=v.nu.netto-v.was.netto,dS=v.nu.streams-v.was.streams,dD=v.nu.downloads-v.was.downloads;
  const sN=+v.saldoNu.to_book||0,sO=+v.saldoWas.to_book||0,uN=+v.saldoNu.paid_out||0,uO=+v.saldoWas.paid_out||0;
  const pm=x=>vsPlus(x,a=>a<0.005?"< € 0,01":"€ "+nf2.format(a));
  const tegels=[vsTegel("Netto erbè",pm(dNet),`van ${eur(v.was.netto)} naar ${eur(v.nu.netto)}`,vsKlasse(dNet)),
    vsTegel("Streams erbè",vsPlusN(dS),`van ${nf0.format(v.was.streams)} naar ${nf0.format(v.nu.streams)}`,vsKlasse(dS)),
    vsTegel("Downloads erbè",vsPlusN(dD),`nu ${nf0.format(v.nu.downloads)} in totaal`,vsKlasse(dD)),
    vsTegel("Uitbetaald",eur(uN),uN!==uO?`was ${eur(uO)} · ${pm(uN-uO)}`:"niet veranderd"),
    vsTegel("Nog te boeken",eur(sN),sN!==sO?`was ${eur(sO)}`:"niet veranderd")].join("");
  const per=v.periodes.filter(p=>!p.was||!p.nu||+p.was.netto!==+p.nu.netto||p.was.status!==p.nu.status);
  const perT=per.length?`<thead><tr><th>Periode</th><th class="n">Netto was</th><th class="n">nu</th><th>Status</th></tr></thead><tbody>`+per.map(p=>{const x=p.nu||p.was;
    return `<tr><td><b>${esc(x.naam)}</b>${!p.was?' <span class="chip good">nieuw</span>':!p.nu?' <span class="chip mute">weg</span>':""}</td><td class="n">${p.was?eur(+p.was.netto):"—"}</td><td class="n">${p.nu?eur(+p.nu.netto):"—"}</td>
      <td>${p.was&&p.nu&&p.was.status!==p.nu.status?esc(p.was.status||"—")+" → <b>"+esc(p.nu.status||"—")+"</b>":esc(x.status||"")}</td></tr>`}).join("")+"</tbody>":`<tbody><tr><td class="sub">Geen periodes veranderd.</td></tr></tbody>`;
  const nrs=v.nummers.map(n=>({...n,dS:(+(n.nu||{}).streams||0)-(+(n.was||{}).streams||0),dD:(+(n.nu||{}).downloads||0)-(+(n.was||{}).downloads||0),dN:(+(n.nu||{}).netto||0)-(+(n.was||{}).netto||0)}))
    .filter(n=>n.dS||n.dD||Math.abs(n.dN)>=0.005).sort((a,b)=>b.dS-a.dS);
  const nrT=nrs.length?`<thead><tr><th>Nummer</th><th class="n">Streams</th><th class="n">erbè</th><th class="n">Downloads erbè</th><th class="n">Netto erbè</th></tr></thead><tbody>`+nrs.map(n=>{const x=n.nu||n.was;
    return `<tr><td><b>${esc(x.t)}</b>${x.v?" <span class='sub'>("+esc(x.v)+")</span>":""}${!n.was?' <span class="chip good">nieuw</span>':""}</td><td class="n">${nf0.format(+(n.nu||{}).streams||0)}</td>
      <td class="n ${vsKlasse(n.dS)}">${vsPlusN(n.dS)}</td><td class="n ${vsKlasse(n.dD)}">${vsPlusN(n.dD)}</td><td class="n ${vsKlasse(n.dN)}">${pm(n.dN)}</td></tr>`}).join("")+"</tbody>":`<tbody><tr><td class="sub">Geen nummers veranderd.</td></tr></tbody>`;
  return `<div class="card">${kop}<div class="ytstats">${tegels}</div></div>
  <div class="grid2"><div class="card"><h2>Periodes</h2><p class="sub">Nieuw of veranderd (bedrag of status)</p><div class="tablewrap"><table>${perT}</table></div></div>
  <div class="card"><h2>Nummâhs</h2><p class="sub">Streams, downloads en netto erbè per nummer</p><div class="tablewrap"><table>${nrT}</table></div></div></div>`;
}

/* ---------- knoppen ---------- */
document.addEventListener("change",e=>{const s=e.target.closest("select[data-vs]");if(!s)return;
  const [bron,welke]=s.dataset.vs.split("-");VS[bron][welke]=+s.value;renderVerschil()});
document.addEventListener("click",e=>{
  const d=e.target.closest("#vsDim button");if(d){VS.dim=d.dataset.v;renderVerschil();return}
  if(e.target.closest("#vsAlles")){VS.alles=!VS.alles;renderVerschil()}
});
