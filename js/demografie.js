/* =====================================================================
   Wie kijkt d'r? — leeftijd, geslacht, land en stad van je publiek (12-10-2026, chat 13)
   Eén stuk code voor Insta (ig_demografie, 30_demografie.sql, elke nacht) en Threads (th_demografie, 19_threads.sql, 1x per week).
   - Rijen uit de database: {wie, soort, dag, data, fout}. wie = 'volgers' | 'reageert' | 'bereik' (Threads: alleen 'volgers').
   - Meta telt alleen wie het kent en geeft per lijstje de top 45 → percentages zijn van "wie Meta kent".
     Leeftijd/geslacht/land: % van het totaal van dat lijstje. Stad en Den Haag + omgeving: % van het landen-totaal
     (steden buiten de top 45 ontbreken, dus dat zijn ondergrenzen; Haagse plaatsen staan altijd in de top 45).
   - Verandering = t.o.v. de meting van ± een week eerder (de nieuwste van ≥ 6 dagen terug), in procentpunten.
   - Alleen verdelingen, nooit losse personen. Alleen Mac/iPad (kaart class pc).
   ===================================================================== */
// Den Haag + omgeving (keuze Marnix 12-10): naam vóór de komma zoals Meta hem schrijft, kleine letters
const DEMO_HAAG=new Set(["the hague","den haag","'s-gravenhage","voorburg","leidschendam","leidschendam-voorburg","rijswijk","delft",
  "wassenaar","zoetermeer","pijnacker","nootdorp","pijnacker-nootdorp","westland","naaldwijk","monster","'s-gravenzande","wateringen"]);
const DEMO_WIE={volgers:{knop:"Volgâhs",wie:"je volgâhs",lang:"wie je volgt"},
  reageert:{knop:"Reageert",wie:"wie reageerde",lang:"wie likete, reageerde, deelde of bewaarde"},
  bereik:{knop:"Zag je",wie:"wie je zag",lang:"wie je posts, reels of stories zag"}};
const DEMO_LEEFTIJD=["13-17","18-24","25-34","35-44","45-54","55-64","65+"];
const DEMO_PP=0.5;   // verandering pas tonen vanaf een halve procentpunt
const demoNf1=new Intl.NumberFormat("nl-NL",{minimumFractionDigits:1,maximumFractionDigits:1});
let igDemoWie="volgers";

async function demoLaden(tabel){   // tabel bestaat nog nie → {fout}; anders de rijen van de laatste 45 dagen
  try{
    const since=new Date(Date.now()-45*864e5).toISOString().slice(0,10);
    const r=await sb.from(tabel).select("wie,soort,dag,data,fout").gte("dag",since).order("dag",{ascending:false}).range(0,999);
    if(r.error)return {rijen:[],fout:r.error.message||String(r.error)};
    return {rijen:(r.data||[]).map(x=>({...x,dag:String(x.dag).slice(0,10)})),fout:null};
  }catch(e){return {rijen:[],fout:e.message||String(e)}}
}
const demoStad=k=>String(k).split(",")[0].trim();
const demoIsHaag=k=>DEMO_HAAG.has(demoStad(k).toLowerCase());
function demoNaam(soort,k){
  if(soort==="country")return cName(k);
  if(soort==="gender")return {F:"Vrouw",M:"Man",U:"Onbekend"}[k]||k;
  if(soort==="city"){const s=demoStad(k);return /^the hague$/i.test(s)?"Den Haag":s}
  return k}
// één momentopname: per soort de goede meting van díe dag (of de nieuwste goede van die soort vóór/op die dag)
function demoOp(rijen,wie,totDag){
  const st={dag:null,soort:{},fout:null};
  for(const s of ["age","gender","country","city"]){
    const r=rijen.find(x=>x.wie===wie&&x.soort===s&&!x.fout&&x.data&&Object.keys(x.data).length&&(!totDag||x.dag<=totDag));
    if(r){st.soort[s]=r.data;if(!st.dag||r.dag>st.dag)st.dag=r.dag}}
  if(!st.dag){const f=rijen.find(x=>x.wie===wie&&x.fout);st.fout=f?f.fout:null;return st}
  const som=o=>o?Object.values(o).reduce((a,v)=>a+(+v||0),0):0;
  st.tot={age:som(st.soort.age),gender:som(st.soort.gender),country:som(st.soort.country)};
  st.tot.city=st.tot.country||som(st.soort.city);
  const stad=st.soort.city||{};
  st.haag=Object.entries(stad).filter(([k])=>demoIsHaag(k)).reduce((a,[,v])=>a+(+v||0),0);
  st.dh=Object.entries(stad).filter(([k])=>/^the hague$/i.test(demoStad(k))).reduce((a,[,v])=>a+(+v||0),0);
  st.aandeel=(s,k)=>{const o=st.soort[s],t=st.tot[s];return o&&t&&o[k]!=null?(+o[k])/t:(o&&t?0:null)};
  st.haagA=st.soort.city&&st.tot.city?st.haag/st.tot.city:null;
  st.dhA=st.soort.city&&st.tot.city?st.dh/st.tot.city:null;
  return st;
}
function demoStand(rijen,wie){
  const nu=demoOp(rijen,wie);if(!nu.dag)return {nu,vorig:null};
  const grens=dagMin(nu.dag,6);   // ± een week eerder
  const vorig=demoOp(rijen,wie,grens);
  return {nu,vorig:vorig.dag?vorig:null};
}
// verschil in procentpunten → "↑ 1,2" (groen) of "↓ 0,8" (rood), of niks
function demoDelta(a,b){
  if(a==null||b==null)return "";
  const d=(a-b)*100;if(Math.abs(d)<DEMO_PP)return "";
  return ` <span class="demod ${d>0?"op":"neer"}" title="t.o.v. een week eerder, in procentpunten">${d>0?"↑":"↓"}${demoNf1.format(Math.abs(d))}</span>`;
}
function demoBlok(titel,soort,st,vorig,opties){
  const o=st.soort[soort];if(!o)return `<div class="demoblok"><h3>${titel}</h3><p class="sub">Geen cijfâhs.</p></div>`;
  let rijen=Object.entries(o).map(([k,v])=>[k,+v]);
  if(soort==="age")rijen.sort((a,b)=>(DEMO_LEEFTIJD.indexOf(a[0])+99*(DEMO_LEEFTIJD.indexOf(a[0])<0))-(DEMO_LEEFTIJD.indexOf(b[0])+99*(DEMO_LEEFTIJD.indexOf(b[0])<0)));
  else if(soort==="gender")rijen.sort((a,b)=>"FMU".indexOf(a[0])-"FMU".indexOf(b[0]));
  else rijen.sort((a,b)=>b[1]-a[1]);
  if(opties.max)rijen=rijen.slice(0,opties.max);
  const tot=st.tot[soort],max=Math.max(1,...rijen.map(x=>x[1]));
  const html=rijen.map(([k,v],i)=>{
    const a=tot?v/tot:0,va=vorig?vorig.aandeel(soort,k):null;
    const kleur=soort==="city"&&demoIsHaag(k)?"groen":"hy";
    return bar(demoNaam(soort,k),[{v,c:kleur}],max,`<span class="demov">${pct(a)}${demoDelta(a,va)}</span>`,`${demoNaam(soort,k)}: ${nf0.format(v)} (${pct(a)})`,opties.rank?i+1:"");
  }).join("");
  return `<div class="demoblok"><h3>${titel}</h3><div class="bars">${html}</div></div>`;
}
// kaart-inhoud voor één groep. opties: {wie:"volgers", bron:"insta"|"threads"}
function demoKaartHTML(stand,opties){
  const {nu,vorig}=stand,W=DEMO_WIE[opties.wie];
  if(!nu.dag)return `<p class="sub" style="margin:0">${nu.fout
    ?"Meta gaf dit (nog) nie: "+esc(String(nu.fout).replace(/^(Instagram|Threads) fout \d+ bij [^:]+:\s*/,""))+". Meta geeft het pas vanaf 100 volgâhs (of 100 mensen die reageerden)."
    :(opties.bron==="threads"?"Nog nie gemeten (1x per week, in de nacht).":"Nog nie gemeten: Supabase haalt het elke nacht op (± 07:45).")}</p>`;
  const haag=nu.haagA==null?"":`<div class="demohaag"><span class="demogroot">${pct(nu.haagA)}${demoDelta(nu.haagA,vorig&&vorig.haagA)}</span>
    <span>van ${W.wie} woont in <b>Den Haag + omgeving</b>${nu.dhA!=null?` · Den Haag zelf ${pct(nu.dhA)}`:""}</span></div>`;
  return haag+`<div class="demo">`
    +demoBlok("Leeftijd","age",nu,vorig,{})
    +demoBlok("Man of vrouw","gender",nu,vorig,{})
    +demoBlok("Landen · top 5","country",nu,vorig,{max:5,rank:1})
    +demoBlok("Steden · top 8","city",nu,vorig,{max:8,rank:1})
    +`</div>`;
}
function demoSubTekst(stand,opties){
  const {nu,vorig}=stand;if(!nu.dag)return "";
  const W=DEMO_WIE[opties.wie],tot=nu.tot.age||nu.tot.gender||nu.tot.country;
  const periode=opties.bron==="threads"
    ?"Je volgâhs van nu (Threads geeft alleen volgâhs, 1x per week gemeten)."
    :(opties.wie==="volgers"?"Je volgâhs van nu.":`${W.lang[0].toUpperCase()+W.lang.slice(1)}, opgeteld over de laatste 30 dagen: geen dagcijfer.`);
  return `Gemeten ${dLabel(nu.dag,1)}. ${periode} Meta telt alleen wie het kent (${nf0.format(tot)} mensen) en geeft per lijstje de top 45; de cijfâhs lopen tot 2 dagen achter. `
    +`<span class="demogroen">Groen</span> = Den Haag + omgeving (Den Haag, Voorburg, Leidschendam, Rijswijk, Delft, Wassenaar, Zoetermeer, Pijnacker, Nootdorp en Westland). `
    +(vorig?`Pijltjes = verschil in procentpunten t.o.v. ${dLabel(vorig.dag,1)}.`:"Pijltjes met de verandering komen er na een week metingen bij.");
}
// "Wat valt op": vergelijk wie je zag / wie reageert met wie je volgt (alleen Insta, alleen als het verschil ≥ 3 punten is)
function demoOpvallend(rijen){
  const V=demoOp(rijen,"volgers"),B=demoOp(rijen,"bereik"),R=demoOp(rijen,"reageert");
  if(!V.dag)return [];
  const uit=[],pt=d=>nf0.format(Math.abs(d*100))+" punten";
  const groot=(X)=>{let best=null;
    for(const k of DEMO_LEEFTIJD){const a=X.aandeel("age",k),b=V.aandeel("age",k);if(a==null||b==null)continue;
      const d=a-b;if(!best||d>best.d)best={k,d,a,b}}return best&&best.d>=0.03?best:null};
  if(B.dag){const g=groot(B);
    if(g)uit.push(`<b>${g.k} jaar</b> ziet je vaak (${pct(g.a)} van wie je zag), maar is maar ${pct(g.b)} van je volgâhs: daar zitten je nieuwe volgâhs.`);
    if(B.haagA!=null&&V.haagA!=null&&Math.abs(B.haagA-V.haagA)>=0.03)
      uit.push(B.haagA<V.haagA?`Je bereik gaat verdèr dan Den Haag: ${pct(B.haagA)} van wie je zag woont in Den Haag + omgeving, tegen ${pct(V.haagA)} van je volgâhs.`
        :`Je bereik is Haagsâh dan je volgâhs: ${pct(B.haagA)} van wie je zag woont in Den Haag + omgeving, tegen ${pct(V.haagA)} van je volgâhs.`);}
  if(R.dag){const g=groot(R);
    if(g)uit.push(`<b>${g.k} jaar</b> reageert relatief veel: ${pct(g.a)} van wie reageerde, tegen ${pct(g.b)} van je volgâhs (${pt(g.d)} meer).`);}
  return uit;
}

/* ---------- Insta ---------- */
function renderIgDemo(){
  if(!$("igDemo"))return;
  document.querySelectorAll("#igDemoWie button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igDemoWie));
  const D=IG.demo||{rijen:[],fout:null};
  if(D.fout&&!D.rijen.length){
    $("igDemoSub").textContent="";
    $("igDemo").innerHTML=`<p class="sub" style="margin:0">${/ig_demografie|relation|schema cache|does not exist/i.test(D.fout)
      ?"Komt d'r an: draai eerst <code>supabase/30_demografie.sql</code> in Supabase."
      :"Ophale lukte nie: "+esc(D.fout)}</p>`;return}
  const st=demoStand(D.rijen,igDemoWie);
  $("igDemoSub").innerHTML=demoSubTekst(st,{wie:igDemoWie,bron:"insta"});
  const op=demoOpvallend(D.rijen);
  $("igDemo").innerHTML=demoKaartHTML(st,{wie:igDemoWie,bron:"insta"})
    +(op.length?`<div class="demoop"><h3>Wat valt op</h3><ul>${op.map(x=>`<li>${x}</li>`).join("")}</ul></div>`:"");
}
/* ---------- Threads (zelfde kaart, alleen volgâhs) ---------- */
function renderThDemo(){
  if(!$("thDemo"))return;
  const rijen=(TH.demo||[]).map(x=>({...x,wie:"volgers",dag:String(x.dag).slice(0,10)}));
  const st=demoStand(rijen,"volgers");
  $("thDemoSub").innerHTML=demoSubTekst(st,{wie:"volgers",bron:"threads"});
  $("thDemo").innerHTML=demoKaartHTML(st,{wie:"volgers",bron:"threads"});
}
document.addEventListener("click",e=>{
  const b=e.target.closest&&e.target.closest("#igDemoWie button");if(!b)return;
  igDemoWie=b.dataset.v;renderIgDemo();
});
