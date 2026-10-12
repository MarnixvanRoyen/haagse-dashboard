// samenwerking.js — kaart "Samenwerkinge" (menu Partnâhs → Insta, sinds 03-10; was in de Insta-tab) + waarschuwing voor de Facebook-sleutel.
// Data: ig_partner / ig_partner_post / ig_partner_info / fb_token (supabase/12_samenwerkingen.sql)
//       + de cijfers per post uit IG.posts (ig_post_stats, insta.js).
// Rekenregels (afgesproken 30-09):
//   - Alleen partners die je uitnodiging AANNAMEN (Accepted) tellen; Pending = post staat niet op hun profiel.
//   - Partner X vergelijken met al je ANDERE samenwerkingsposts (zonder X).
//   - Goed voor je  = meer nieuwe volgers per post dan een gewone samenwerkingspost (≥ 25% én ≥ 2 volgers extra in totaal).
//   - Alleen bereik = niet meer volgers, wel meer kijkers (mediaan ≥ 1,25× je andere samenwerkingen).
//   - Levert niks op = geen van beide.  Oordeel pas vanaf 3 posts, daarvoor "te vroeg" (grijs).
//   - Per 1.000 kijkers: eerst per post uitrekenen, dan gemiddelde (elke post telt even zwaar, één virale post overheerst niet).
//   - Laat aangenomen (> 3 dagen na de post, 12b) telt niet mee voor die partner: de post had zijn kijkers toen al.
//     Posts waarop álle aangenomen partners laat waren, tellen nergens mee. Weggehaalde partners (weg) tellen niet mee.
//   - Laat aangenomen mét nulmeting (12b, view ig_partner_laat_effect): erbij na aannemen min de eigen groei van de post
//     (tempo vlak vóór het aannemen, doorgetrokken) = effect van de partner. Telt mee in Extra volgâhs, niet in het oordeel.
//   - Eigen effect (30-09, "manier 1", plus-minus zoals in de sport): over álle bruikbare posts tegelijk
//     ln(kijkers) en ln(1+volgers) = basis + soort post + som van de effecten van de partners die erop staan.
//     Ridge (λ=1): effect van een partner krimpt naar 0 bij weinig posts (3 posts ± 75%, 10 posts ± 90%).
//     Partners met precies dezelfde posts = niet te scheiden → effect van het duo. "Leunt op 1 post" = zonder de
//     beste post van die partner valt het effect weg. Staat naast het oordeel; het oordeel zelf is (nog) niet veranderd.
//   - Partnergegevens (30-09, 12c): kolom "Partnâh zelf" (volgers, posts/week, groei, reel-weergaven, reacties, likes) uit
//     ig_partner_info + ig_partner_info_dag. Eigen effect met "verwacht bij z'n grootte" zodra ≥ IGS_GR_MIN partners een
//     bekende grootte hebben: effect = α + γ·ln(volgers) + δ; δ = doet meer/minder dan z'n grootte (alleen als ± 95% zeker).

let IGS={partners:[],posts:[],info:[],hist:[],laat:[],fb:null,err:null,tags:[],tagStand:null,tagErr:null,keuze:new Map(),keuzeErr:null};
let igsPeriode="365";     // "365" (laatste jaar) of "alles"
let igsSorteer="extra";   // volgorde uit igSamen() (sinds chat 19 sorteer je met de kolomkoppen, zie igsKop)
let igsAlles=false;       // alle partners tonen of de eerste 12
let IGS_S=null;           // laatste uitkomst van igSamen() (voor de bedankkaart, bedankkaart.js)
const IGS_MIN=3;          // vanaf zoveel posts een oordeel
const IGS_WACHT=3;        // posts jonger dan zoveel dagen tellen nog niet mee (cijfers groeien nog)
const IGS_LAAT=3*864e5;   // aangenomen meer dan 3 dagen na de post = laat (we checken elke 3 uur, dus ± 2½–3 dagen echt)
const IGS_LAMBDA=1;       // voorzichtigheid eigen effect: telt als "1 post zonder effect" extra per partner
const IGS_GR_MIN=8;       // vanaf zoveel partners met bekende grootte (en ≥ IGS_MIN posts) rekent het eigen effect met "verwacht bij z'n grootte"

async function igSamenLaden(){
  // lukt de uitgebreide vraag niet (12c nog niet gedraaid: kolom bestaat niet), dan de oude
  const ofAnders=(a,b)=>a.then(r=>r&&r.error?b():r);
  try{
    const [p,pp,i,h,f,l]=await Promise.all([
      igAlles(()=>sb.from("ig_partner").select("media_id,partner,status,aangenomen_om,weg,weg_om").order("media_id").order("partner")),
      igAlles(()=>sb.from("ig_partner_post").select("media_id,gepost_om,aangenomen,uitgenodigd").order("media_id")),
      ofAnders(sb.from("ig_partner_info").select("partner,naam,volgers,volgend,posts,reacties_med,likes_med,likes_verborgen,reel_views_med,n_gemeten,n_reels,per_week,laatste_post,gelukt_om,bijgewerkt_om,fout").range(0,4999),
               ()=>sb.from("ig_partner_info").select("partner,volgers,fout").range(0,4999)),
      igAlles(()=>sb.from("ig_partner_info_dag").select("partner,dag,volgers").order("partner").order("dag")).catch(()=>[]),
      ofAnders(sb.from("fb_token").select("verloopt_op,data_verloopt_op,gelukt_om,fout,fout_om,grootte_gelukt_om,grootte_fout,grootte_fout_om").eq("naam","facebook_access_token").limit(1),
               ()=>sb.from("fb_token").select("verloopt_op,data_verloopt_op,gelukt_om,fout,fout_om").eq("naam","facebook_access_token").limit(1)),
      sb.from("ig_partner_laat_effect").select("media_id,partner,gepost_om,aangenomen_om,basis_om,basis,na_om,na,voor_om,voor").range(0,1999).then(r=>r,()=>({data:[]}))]);
    for(const r of [i,f])if(r.error)throw r.error;
    IGS={partners:p,posts:pp,info:i.data||[],hist:h||[],laat:(l&&!l.error&&l.data)||[],fb:(f.data&&f.data[0])||null,err:null,tags:[],tagStand:null,tagErr:null,keuze:new Map(),keuzeErr:null};
  }catch(e){IGS={partners:[],posts:[],info:[],hist:[],laat:[],fb:null,err:e.message||String(e),tags:[],tagStand:null,tagErr:null,keuze:new Map(),keuzeErr:null}}
  await Promise.all([igsTagsLaden(),igsKeuzeLaden()]);
}
// jouw eigen keuzes per partner (29_partner_keuze.sql): nie mee samenwerke + reden, "klopt, is oké"
async function igsKeuzeLaden(){
  try{const r=await sb.from("ig_partner_keuze").select("partner,stop,reden,stop_om,oke,oke_om").range(0,4999);
    if(r.error)throw r.error;IGS.keuze=new Map((r.data||[]).map(x=>[x.partner,x]));IGS.keuzeErr=null}
  catch(e){IGS.keuze=new Map();IGS.keuzeErr=e.message||String(e)}
}
// wie tagt jou (26_tags.sql); los van de rest, zodat de samenwerkingen ook werken als 26 nog nie gedraaid is
async function igsTagsLaden(){
  try{
    const [t,st]=await Promise.all([
      igAlles(()=>sb.from("ig_tag").select("media_id,maker,gepost_om,soort,likes,reacties,link,weg").order("media_id")),
      sb.from("ig_tag_stand").select("gelukt_om,volledig_om,aantal,fout,fout_om,melding").limit(1)]);
    if(st.error)throw st.error;
    IGS.tags=t;IGS.tagStand=(st.data&&st.data[0])||null;IGS.tagErr=null;
  }catch(e){IGS.tags=[];IGS.tagStand=null;IGS.tagErr=e.message||String(e)}
}

/* ---------- rekenen ---------- */
// Effect van een laat aangenomen partner: wat kwam erbij na het aannemen, min wat de post in zijn eigen tempo nog zou doen.
function igsLaatEffect(r){
  const g=(o,k)=>o&&o[k]!=null&&!isNaN(+o[k])?+o[k]:null;
  const uit={partner:r.partner,media_id:r.media_id,post:r.gepost_om,meet:true,dagen:0};
  if(!r.na||g(r.na,"reach")==null||g(r.basis,"reach")==null)return uit;               // nog geen meting na het aannemen
  const dagen=(Date.parse(r.na_om)-Date.parse(r.basis_om))/864e5;if(dagen<0.5)return uit;
  let tb=0,tv=0,trend=false;                                                          // eigen tempo per dag vlak ervóór
  if(r.voor&&r.voor_om){const d=(Date.parse(r.basis_om)-Date.parse(r.voor_om))/864e5;
    if(d>0.25&&g(r.voor,"reach")!=null){tb=Math.max(0,(g(r.basis,"reach")-g(r.voor,"reach"))/d);
      tv=g(r.voor,"follows")!=null&&g(r.basis,"follows")!=null?Math.max(0,(g(r.basis,"follows")-g(r.voor,"follows"))/d):0;trend=true}}
  const dB=g(r.na,"reach")-g(r.basis,"reach");
  const dV=g(r.na,"follows")!=null&&g(r.basis,"follows")!=null?g(r.na,"follows")-g(r.basis,"follows"):null;
  return {...uit,meet:dagen<13.5,dagen,trend,dB,dV,extraB:dB-tb*dagen,extraV:dV==null?null:dV-tv*dagen};
}

/* ---------- eigen effect per partner (plus-minus over alle posts) ---------- */
// Inverse van A (Gauss-Jordan met pivot); null als het niet lukt.
function igsInv(A){
  const n=A.length,M=A.map((r,i)=>{const e=new Array(n).fill(0);e[i]=1;return r.concat(e)});
  for(let k=0;k<n;k++){
    let p=k;for(let i=k+1;i<n;i++)if(Math.abs(M[i][k])>Math.abs(M[p][k]))p=i;
    if(!(Math.abs(M[p][k])>1e-12))return null;
    if(p!==k)[M[k],M[p]]=[M[p],M[k]];
    const d=M[k][k];for(let j=k;j<2*n;j++)M[k][j]/=d;
    for(let i=0;i<n;i++){if(i===k)continue;const f=M[i][k];if(!f)continue;const Mi=M[i],Mk=M[k];for(let j=k;j<2*n;j++)Mi[j]-=f*Mk[j]}}
  return M.map(r=>r.slice(n));
}
// Ridge op dunne rijen: r.x = [[kolom,waarde],…], r.yB, r.yV. pen = straf per kolom.
// Geeft ook een snelle "zonder rij i"-versie (formule voor één rij weglaten, zonder alles opnieuw uit te rekenen).
function igsFit(rijen,p,pen){
  const A=Array.from({length:p},()=>new Array(p).fill(0)),bB=new Array(p).fill(0),bV=new Array(p).fill(0);
  for(const r of rijen)for(const [i,vi] of r.x){bB[i]+=vi*r.yB;bV[i]+=vi*r.yV;const Ai=A[i];for(const [j,vj] of r.x)Ai[j]+=vi*vj}
  for(let i=0;i<p;i++)A[i][i]+=pen[i];
  const Q=igsInv(A);if(!Q)return null;
  const mul=b=>Q.map(r=>r.reduce((s,q,j)=>s+q*b[j],0));
  const B=mul(bB),V=mul(bV),dot=(x,w)=>x.reduce((s,[i,v])=>s+v*w[i],0);
  // ruis: hoe ver zitten de posts gemiddeld naast de voorspelling (voor "hoe zeker is een afwijking")
  const df=Math.max(1,rijen.length-p);
  const sB=Math.sqrt(rijen.reduce((t,r)=>t+(r.yB-dot(r.x,B))**2,0)/df),sV=Math.sqrt(rijen.reduce((t,r)=>t+(r.yV-dot(r.x,V))**2,0)/df);
  const zonder=ri=>{const r=rijen[ri],u=new Array(p).fill(0);
    for(let k=0;k<p;k++){let s=0;for(const [j,v] of r.x)s+=Q[k][j]*v;u[k]=s}
    const h=dot(r.x,u);if(!(1-h>1e-9))return null;
    const fB=(r.yB-dot(r.x,B))/(1-h),fV=(r.yV-dot(r.x,V))/(1-h);
    return {B:B.map((b,k)=>b-u[k]*fB),V:V.map((v,k)=>v-u[k]*fV)}};
  return {B,V,zonder,Q,sB,sV};
}
// posts: [{id,b,v,soort,wie:[partners]}] → Map partner → eigen effect
// gr(partner, post) = volgers van de partner rond de datum van de post (of null). Als genoeg partners een bekende grootte
// hebben (IGS_GR_MIN met ≥ IGS_MIN posts), rekent het model met "verwacht bij deze grootte":
//   effect partner = α (gewone partner) + γ·(ln volgers − gemiddelde) + δ (eigen afwijking).
//   De voorzichtigheid (ridge) trekt nu δ naar 0, dus een partner met weinig posts naar "wat je bij zijn grootte verwacht".
//   δ = doet meer/minder dan zijn grootte. Zonder genoeg grootte-gegevens: precies zoals v3 (effect naar 0).
function igsEigen(posts,gr){
  const uit=new Map();if(posts.length<4)return {per:uit,solo:0,groot:null};
  gr=gr||(()=>null);
  // kolommen: 0 = basis, dan soort post (vanaf 3 posts, meest voorkomende = referentie), dan partners.
  // Bewust géén tijd-kolom: wanneer je met wie samenwerkte hangt sterk samen met de tijd, dan pikt "tijd" het partner-effect in.
  const soortTel=new Map();posts.forEach(x=>soortTel.set(x.soort,(soortTel.get(x.soort)||0)+1));
  const soorten=[...soortTel].sort((a,b)=>b[1]-a[1]).slice(1).filter(([,n])=>n>=3).map(([s])=>s);
  const kol=new Map();let p=1;soorten.forEach(s=>kol.set("s:"+s,p++));
  const namen=[...new Set(posts.flatMap(x=>x.wie))];
  const postsVan=new Map(namen.map(n=>[n,[]]));posts.forEach((x,i)=>x.wie.forEach(n=>postsVan.get(n).push(i)));
  // grootte per partner per post (ln volgers); gemiddelde over de partners met een bekende grootte
  const lnGr=posts.map(x=>new Map(x.wie.map(n=>{const g=gr(n,x);return [n,g>0?Math.log(g):null]})));
  const lnP=new Map(namen.map(n=>{const l=postsVan.get(n).map(i=>lnGr[i].get(n)).filter(v=>v!=null);return [n,l.length?igsGem(l):null]}));
  const bekend=namen.filter(n=>lnP.get(n)!=null&&postsVan.get(n).length>=IGS_MIN);
  const lnB=bekend.map(n=>lnP.get(n)),mid=lnB.length?igsGem(lnB):0;
  const spreiding=lnB.length>1?Math.sqrt(igsGem(lnB.map(v=>(v-mid)**2))):0;
  const metGr=bekend.length>=IGS_GR_MIN&&spreiding>0.3;
  let cA=-1,cG=-1;if(metGr){cA=p++;cG=p++}
  namen.forEach(n=>kol.set(n,p++));
  const pen=new Array(p).fill(1e-6);namen.forEach(n=>pen[kol.get(n)]=IGS_LAMBDA);if(metGr){pen[cA]=0.01;pen[cG]=0.01}
  const z=(i,n)=>{const l=lnGr[i].get(n);return l==null?0:l-mid};           // onbekende grootte = gemiddelde grootte
  const rijen=posts.map((x,i)=>({x:[[0,1],...(kol.has("s:"+x.soort)?[[kol.get("s:"+x.soort),1]]:[]),
      ...(metGr&&x.wie.length?[[cA,x.wie.length],[cG,x.wie.reduce((s,n)=>s+z(i,n),0)]]:[]),
      ...x.wie.map(n=>[kol.get(n),1])],
    yB:Math.log(x.b),yV:Math.log(1+Math.max(0,x.v))}));
  const fit=igsFit(rijen,p,pen);if(!fit)return {per:uit,solo:0,groot:null};
  const voorsp=(r,w)=>r.x.reduce((s,[i,v])=>s+v*w[i],0);
  // effect van partner m in model w: verwacht (α + γ·z, gemiddeld over zijn posts) + eigen afwijking δ
  const zGem=m=>{const l=postsVan.get(m);return l.length?igsGem(l.map(i=>z(i,m))):0};
  const verw=(w,m)=>metGr?w[cA]+w[cG]*zGem(m):0;
  const tot=(w,m)=>verw(w,m)+w[kol.get(m)];
  // wat de partner(s) toevoegden aan volgers (met − zonder), bij de middelste van die posts; e = effect op log-schaal
  // (mediaan: anders telt het extra van een virale post van een medepartner toch weer mee)
  const plusOp=(idx,somV,e,w)=>med(idx.map(i=>Math.exp(voorsp(rijen[i],w)-somV)*(Math.exp(e)-1)));
  const sleutel=n=>postsVan.get(n).join(",");
  const groepen=new Map();namen.forEach(n=>{const k=sleutel(n);if(!groepen.has(k))groepen.set(k,[]);groepen.get(k).push(n)});
  const cat=(f,pl)=>[f>=1.25?1:f<=0.8?-1:0,pl>=1?1:pl<=-1?-1:0];
  for(const n of namen){
    const idx=postsVan.get(n),set=new Set(idx),groep=groepen.get(sleutel(n));
    const leden=groep.length>1?groep:[n];
    const som=(w,f)=>leden.reduce((s,m)=>s+f(w,m),0);
    const somB=som(fit.B,tot),somV=som(fit.V,tot);
    const e={n:idx.length,fB:Math.exp(somB),plus:plusOp(idx,somV,somV,fit.V),met:leden.filter(m=>m!==n),leunt:false,moeilijk:null,verw:null};
    // verwacht bij de grootte (alleen als het model met grootte rekent én de grootte van álle leden bekend is)
    if(metGr&&leden.every(m=>lnP.get(m)!=null)){
      const vB=som(fit.B,verw),vV=som(fit.V,verw),plusV=plusOp(idx,somV,vV,fit.V);
      const tB=Math.exp(somB-vB),tV=e.plus-plusV;
      // hoe zeker is de afwijking? (afwijking gedeeld door zijn onzekerheid; ≥ 1,96 = ± 95% zeker, anders "zoals verwacht")
      const ks=leden.map(m=>kol.get(m));let q=0;ks.forEach(j=>ks.forEach(k=>q+=fit.Q[j][k]));
      const zB=(somB-vB)/(fit.sB*Math.sqrt(Math.max(q,1e-12))),zV=(somV-vV)/(fit.sV*Math.sqrt(Math.max(q,1e-12)));
      const oordeel=zV>=1.96&&tV>=0.5?"meer":zV<=-1.96&&tV<=-0.5?"minder"
        :zB>=1.96&&tB>=1.25&&zV>-1?"meer":zB<=-1.96&&tB<=0.8&&zV<1?"minder":"gelijk";
      e.verw={fB:Math.exp(vB),plus:plusV,tB,tV,zB,zV,oordeel,volgers:Math.round(Math.exp(igsGem(leden.map(m=>lnP.get(m)))))};
    }
    // moeilijk te scheiden: hooguit 2 posts waar de een zonder de ander staat
    if(!e.met.length){let best=null;
      for(const m of namen){if(m===n)continue;const pm=postsVan.get(m);let samen=0;pm.forEach(i=>{if(set.has(i))samen++});
        const verschil=(idx.length-samen)+(pm.length-samen);if(samen>=2&&verschil<=2&&(!best||verschil<best.v))best={m,v:verschil}}
      if(best)e.moeilijk=best.m}
    // leunt op 1 post: haal de beste post (meeste kijkers / meeste volgers) weg en reken opnieuw
    if(idx.length>=IGS_MIN){
      const [cB,cV]=cat(e.fB,e.plus);
      const test=(beste,welke)=>{const f2=fit.zonder(beste);if(!f2)return false;
        const s2=som(f2[welke],tot),s1=welke==="B"?somB:somV;
        const rest=idx.filter(i=>i!==beste);
        const [k2B,k2V]=cat(Math.exp(welke==="B"?s2:somB),welke==="V"?plusOp(rest,s2,s2,f2.V):e.plus);
        return (welke==="B"?k2B!==cB:k2V!==cV)&&(Math.sign(s2)!==Math.sign(s1)||Math.abs(s2)<0.5*Math.abs(s1))};
      const topB=idx.reduce((a,i)=>posts[i].b>posts[a].b?i:a,idx[0]),topV=idx.reduce((a,i)=>posts[i].v>posts[a].v?i:a,idx[0]);
      e.leunt=(cB!==0&&test(topB,"B"))||(cV!==0&&test(topV,"V"));
    }
    uit.set(n,e);
  }
  // hoe sterk telt grootte? (per 10× meer volgers: × kijkers en × (1+volgers))
  const groot=metGr?{n:bekend.length,x10B:Math.exp(fit.B[cG]*Math.LN10),x10V:Math.exp(fit.V[cG]*Math.LN10)}
    :{n:bekend.length,nodig:IGS_GR_MIN};
  return {per:uit,solo:posts.filter(x=>!x.wie.length).length,groot};
}

const igsGem=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
function igsKort(v){return v==null?"—":v>=1e6?igNf1.format(v/1e6)+"M":v>=1e4?nf0.format(v/1e3)+"k":v>=1e3?igNf1.format(v/1e3)+"k":nf0.format(v)}

function igSamen(){
  const stats=new Map(IG.posts.map(p=>[p.media_id,p]));
  // partnergegevens (12c): laatste stand + geschiedenis (volgers per meetdag)
  const info=new Map(IGS.info.map(x=>[x.partner,x]));
  const hist=new Map();IGS.hist.forEach(r=>{if(r.volgers==null)return;if(!hist.has(r.partner))hist.set(r.partner,[]);hist.get(r.partner).push([Date.parse(r.dag),r.volgers])});
  // grootte van partner n rond de post: de meting die het dichtst bij de postdatum ligt (geschiedenis begint 30-09-2026), anders de laatste stand
  const grBij=(n,x)=>{const h=hist.get(n),t=Date.parse(x.d);
    if(h&&h.length&&!isNaN(t)){let best=h[0];for(const m of h)if(Math.abs(m[0]-t)<Math.abs(best[0]-t))best=m;return best[1]}
    const i=info.get(n);return i&&i.volgers!=null?i.volgers:null};
  const groei=n=>{const h=hist.get(n);if(!h||h.length<2)return null;const a=h[0],b=h[h.length-1],dagen=(b[0]-a[0])/864e5;
    return dagen>=7&&a[1]>0?{pct:b[1]/a[1]-1,dagen}:null};
  const grens=igsPeriode==="alles"?0:Date.now()-365*864e5, jong=Date.now()-IGS_WACHT*864e5;
  const pp=IGS.posts.filter(x=>x.gepost_om&&Date.parse(x.gepost_om)>=grens);
  const datum=new Map(pp.map(x=>[x.media_id,x.gepost_om]));
  const actief=IGS.partners.filter(r=>!r.weg&&datum.has(r.media_id));
  const isLaat=r=>r.status==="Accepted"&&!!r.aangenomen_om&&Date.parse(r.aangenomen_om)-Date.parse(datum.get(r.media_id))>IGS_LAAT;
  const perPost=new Map();   // media_id -> {opTijd, laat}: aangenomen partners per post
  actief.forEach(r=>{if(r.status!=="Accepted")return;const x=perPost.get(r.media_id)||{opTijd:0,laat:0,wie:[]};if(isLaat(r))x.laat++;else{x.opTijd++;x.wie.push(r.partner)}perPost.set(r.media_id,x)});

  // posts met bruikbare cijfers (bereik + nieuwe volgers bekend, minstens 3 dagen oud)
  const bruik=new Map();
  pp.forEach(x=>{const s=stats.get(x.media_id);
    if(!s||!(s.bereik>0)||s.nieuwe_volgers==null||Date.parse(x.gepost_om)>jong)return;
    const a=perPost.get(x.media_id)||{opTijd:0,laat:0,wie:[]};
    if(!a.opTijd&&a.laat)return;                        // alleen late partners: geen solo en geen gewone samenwerking
    bruik.set(x.media_id,{id:x.media_id,d:x.gepost_om,aan:a.opTijd,b:s.bereik,v:s.nieuwe_volgers,pr:s.profielbezoeken,lk:(s.likes||0)+(s.gedeeld||0),
      wie:[...new Set(a.wie)],soort:soortNaam(s)})});
  const collab=[...bruik.values()].filter(x=>x.aan>0), solo=[...bruik.values()].filter(x=>x.aan===0);
  const kwal=l=>({v1k:igsGem(l.map(x=>x.v*1000/x.b)),pr1k:igsGem(l.filter(x=>x.pr!=null).map(x=>x.pr*1000/x.b)),lk:igsGem(l.map(x=>x.lk/x.b))});

  // uitnodigingen per partner (alle posts in de periode, ook zonder cijfers) + posts met cijfers waar hij aannam
  const uit=new Map(),metX=new Map();
  actief.forEach(r=>{
    const u=uit.get(r.partner)||{aan:0,alles:0,laat:0,laatst:null};u.alles++;
    if(r.status==="Accepted"){u.aan++;const d=datum.get(r.media_id);if(!u.laatst||d>u.laatst)u.laatst=d;
      if(isLaat(r))u.laat++;
      else{const b=bruik.get(r.media_id);if(b){if(!metX.has(r.partner))metX.set(r.partner,[]);metX.get(r.partner).push(b)}}}
    uit.set(r.partner,u)});

  const rijen=[...metX].map(([naam,P])=>{
    const ids=new Set(P.map(x=>x.id)),O=collab.filter(x=>!ids.has(x.id));
    // mediaan aan beide kanten: de middelste post mét X tegen de middelste post zonder X.
    // (Gemiddelde ging mis: een partner die toevallig op een virale post van een ándere partner meedeed, kreeg die volgers ook.)
    const n=P.length,vpp=med(P.map(x=>x.v));
    const gewoonV=med(O.map(x=>x.v)),gewoonB=med(O.map(x=>x.b));      // een gewone andere samenwerkingspost
    const extra=gewoonV==null?null:n*(vpp-gewoonV);                    // ± zoveel volgers meer dan evenveel gewone posts
    const bx=gewoonB?med(P.map(x=>x.b))/gewoonB:null;
    const goed=extra!=null&&extra>=2&&vpp>=1.25*gewoonV;
    const oordeel=goed?"goed":bx!=null&&bx>=1.25?"bereik":"niks";
    return {naam,n,vpp,gewoonV,extra,bx,q:kwal(P),qo:kwal(O),oordeel,zeker:n>=IGS_MIN,u:uit.get(naam),info:info.get(naam),groei:groei(naam)};
  });
  const eigen=igsEigen([...bruik.values()],grBij);
  rijen.forEach(r=>r.eigen=eigen.per.get(r.naam)||null);
  rijen.forEach(r=>r.bedank=igsBedank(r));
  if(igsSorteer==="vaak")rijen.sort((a,b)=>b.n-a.n||(b.extra??-1e9)-(a.extra??-1e9));
  else rijen.sort((a,b)=>(b.extra??-1e9)-(a.extra??-1e9)||b.n-a.n);

  const tel={goed:0,bereik:0,niks:0};rijen.forEach(r=>{if(r.zeker)tel[r.oordeel]++});
  let aan=0,alles=0;uit.forEach(u=>{aan+=u.aan;alles+=u.alles});
  const nooit=[...uit].filter(([,u])=>u.aan===0&&u.alles>=3).sort((a,b)=>b[1].alles-a[1].alles);
  const zelden=[...uit].filter(([,u])=>u.aan>0&&u.alles>=5&&u.aan/u.alles<0.3).sort((a,b)=>b[1].alles-a[1].alles);
  const laat=[...uit].filter(([,u])=>u.laat>0).sort((a,b)=>b[1].laat-a[1].laat);
  // gemeten effect van laat aannemen, per partner
  const effect=new Map();
  IGS.laat.map(igsLaatEffect).forEach(e=>{if(!effect.has(e.partner))effect.set(e.partner,[]);effect.get(e.partner).push(e)});
  const extraLaat=n=>(effect.get(n)||[]).reduce((a,e)=>a+(e.extraV??0),0);
  rijen.forEach(r=>{const l=effect.get(r.naam)||[];r.laatN=l.filter(e=>e.dV!=null).length;r.extraLaat=r.laatN?extraLaat(r.naam):0;
    r.totaal=r.extra==null?null:r.extra+r.extraLaat});
  if(igsSorteer==="extra")rijen.sort((a,b)=>(b.totaal??-1e9)-(a.totaal??-1e9)||b.n-a.n);
  if(igsSorteer==="grootte")rijen.sort((a,b)=>(b.eigen?.verw?.tV??-1e9)-(a.eigen?.verw?.tV??-1e9)||(b.eigen?.verw?.tB??0)-(a.eigen?.verw?.tB??0)||b.n-a.n);
  if(igsSorteer==="eigen")rijen.sort((a,b)=>(b.eigen?.plus??-1e9)-(a.eigen?.plus??-1e9)||(b.eigen?.fB??0)-(a.eigen?.fB??0)||b.n-a.n);
  // weggehaald in de laatste 90 dagen (alle posts, ook buiten de periode)
  const alleDatum=new Map(IGS.posts.map(x=>[x.media_id,x.gepost_om]));
  const weg=IGS.partners.filter(r=>r.weg&&r.weg_om&&Date.parse(r.weg_om)>Date.now()-90*864e5)
    .map(r=>({naam:r.partner,post:alleDatum.get(r.media_id),om:r.weg_om,was:r.status})).sort((a,b)=>a.om<b.om?1:-1);
  // stand van het ophalen van partnergegevens (alle partners, ook zonder cijfers)
  const allePartners=new Set(IGS.partners.map(r=>r.partner));
  const gegevens={totaal:allePartners.size,gemeten:IGS.info.filter(x=>x.volgers!=null&&allePartners.has(x.partner)).length,
    nieTeZien:IGS.info.filter(x=>x.volgers==null&&x.fout&&IGS_NIETEZIEN.test(x.fout)&&allePartners.has(x.partner)).length};
  return {rijen,uitn:uit,tel,aan,alles,nooit,zelden,laat,weg,effect,eigenSolo:eigen.solo,groot:eigen.groot,gegevens,
    collab:{n:collab.length,medB:med(collab.map(x=>x.b)),medV:med(collab.map(x=>x.v)),...kwal(collab)},
    solo:{n:solo.length,medB:med(solo.map(x=>x.b)),medV:med(solo.map(x=>x.v)),...kwal(solo)},
    zonderCijfers:pp.filter(x=>(perPost.get(x.media_id)||{}).opTijd>0&&!bruik.has(x.media_id)).length,
    gecheckt:IGS.posts.length,metGrootte:rijen.some(r=>r.info&&r.info.volgers!=null)};
}

// Mag deze partner een bedankkaart krijgen? (afspraak 03-10: goed + kansrijk)
//   "goed"     = oordeel Goed voor je (≥ IGS_MIN posts)
//   "kansrijk" = nog te vroeg, maar volgens dezelfde regel al goed (≥ 1,25× volgers per post én ≥ 2 extra),
//                of het eigen effect laat duidelijk plus zien (≥ 1 volger per post erbij, niet minder kijkers, leunt niet op 1 post)
function igsBedank(r){
  if(r.zeker&&r.oordeel==="goed")return "goed";
  const regel=!r.zeker&&r.extra!=null&&r.extra>=2&&r.gewoonV!=null&&r.vpp>=1.25*r.gewoonV;
  const eigen=r.eigen&&!r.eigen.leunt&&r.eigen.plus>=1&&r.eigen.fB>=1;
  return regel||eigen?"kansrijk":null;
}
const IGS_HART='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
function igsBedankKnop(r){
  return r.bedank?`<button type="button" class="bkknop" data-bk="${esc(r.naam)}" title="Bedankkaart maken voâh @${esc(r.naam)} (${r.bedank==="goed"?"goed voor je":"kansrijk"})" aria-label="Bedankkaart maken voor @${esc(r.naam)}">${IGS_HART}</button>`
    :`<button type="button" class="bkknop" data-bk="${esc(r.naam)}" disabled title="Bedankkaart kan alleen bij goede of kansrijke partners" aria-label="Bedankkaart (alleen bij goede of kansrijke partners)">${IGS_HART}</button>`;
}

/* ---------- tekenen ---------- */
const IGS_OORDEEL={goed:["good","Goed voor je"],bereik:["warn","Alleen bereik"],niks:["niks","Levert niks op"]};
function igsOordeel(r){const [k,t]=IGS_OORDEEL[r.oordeel];
  return r.zeker?`<span class="chip ${k}">${t}</span>`
    :`<span class="chip mute" title="Pas vanaf ${IGS_MIN} posts een oordeel">te vroeg</span> <span class="igsvlg">lijkt: ${t.toLowerCase()}</span>`}
function igsVs(a,b,fmt){if(a==null)return "—";const s=fmt(a);if(b==null)return s;
  const d=b?a/b-1:0,pijl=d>0.1?' <span class="up">↑</span>':d<-0.1?' <span class="down">↓</span>':"";
  return `${s}${pijl}<span class="igsvs">andere ${fmt(b)}</span>`}
const igsNf2=new Intl.NumberFormat("nl-NL",{minimumFractionDigits:1,maximumFractionDigits:2});
// cel "Eigen effect": × kijkers en + volgers per post, met hoe zeker (+ verwacht bij z'n grootte)
const igsF=f=>f>=10?nf0.format(f):igNf1.format(f);
const igsPl=pl=>Math.abs(pl)<0.05?"±0":(pl>0?"+":"−")+(Math.abs(pl)>=10?nf0.format(Math.abs(pl)):igNf1.format(Math.abs(pl)));
const IGS_GR={meer:["good","doet meer dan z'n grootte"],minder:["niks","doet minder dan z'n grootte"],gelijk:["mute","zoals verwacht bij z'n grootte"]};
function igsEigenCel(r){
  const e=r.eigen;if(!e)return "—";
  const f=e.fB,pl=e.plus,kl=(x,op,neer)=>x>=op?"up":x<=neer?"down":"";
  const noot=[];
  if(e.met.length)noot.push(`nie te scheiden: altijd samen`);
  if(e.n<IGS_MIN)noot.push(`te vroeg: ${e.n} post${e.n===1?"":"s"}`);
  else{if(e.leunt)noot.push("leunt op 1 post");
    if(e.moeilijk)noot.push(`moeilijk te scheiden van @${esc(e.moeilijk)}`);
    noot.push(e.n<6?`nog onzeker: ${e.n} posts`:`${e.n} posts`)}
  const v=e.verw;
  const gr=v?`<span class="igsvs">verwacht bij z'n grootte: ×${igsF(v.fB)} · ${igsPl(v.plus)}</span>`
    +`<span class="chip ${e.n<IGS_MIN?"mute":IGS_GR[v.oordeel][0]} igsgr">${e.n<IGS_MIN?"lijkt: ":""}${IGS_GR[v.oordeel][1]}</span>`:"";
  return `${e.met.length?`<span class="igsvs">samen met ${e.met.map(m=>"@"+esc(m)).join(" + ")}:</span>`:""}`
    +`<b class="${kl(f,1.25,0.8)}">×${igsF(f)}</b> kijkâhs<br><b class="${kl(pl,1,-1)}">${igsPl(pl)}</b> volgâhs/post`
    +gr+noot.map(t=>`<span class="igsvs">${t}</span>`).join("");
}
// cel "Partnâh zelf": hun eigen account (Business Discovery, 12c)
// Meta kan persoonlijke/privé-accounts niet laten zien ("Invalid user id"); andere fouten = ophalen lukte (nog) nie
const IGS_NIETEZIEN=/Invalid user id|cannot be found|geen gegevens|\(#110\)/i;
function igsZelfCel(r){
  const i=r.info;if(!i)return `—<span class="igsvs">nog nie gemeten</span>`;
  if(i.volgers==null)return i.fout?`—<span class="igsvs" title="${esc(i.fout)}">${IGS_NIETEZIEN.test(i.fout)?"nie te zien: geen zakelijk account":"ophalen lukte nie"}</span>`:"—";
  const l=[];
  if(i.per_week!=null)l.push(`± ${igNf1.format(+i.per_week)} posts/week`);
  if(r.groei)l.push(`groei ${r.groei.pct>=0?"+":"−"}${igNf1.format(Math.abs(r.groei.pct)*100)}% (${nf0.format(r.groei.dagen)} d)`);
  if(i.reel_views_med!=null&&i.volgers>0)l.push(`reels ± ${igsKort(+i.reel_views_med)} weergaven (${pct(i.reel_views_med/i.volgers)})`);
  if(i.reacties_med!=null)l.push(`${igsKort(+i.reacties_med)} reacties/post`+(i.likes_med!=null?` · ${igsKort(+i.likes_med)} likes`:i.likes_verborgen?" · likes verborgen":""));
  return `<b>${igsKort(i.volgers)}</b> volgâhs`+l.map(t=>`<span class="igsvs">${t}</span>`).join("");
}

/* ---------- Let op: automatische signalen per partner/tagger (chat 19, 12-10-2026) ----------
   Gaat alleen over ECHTHEID van hun account ("let op", nooit "nep"); of het jou iets oplevert staat in "Helpt 't?".
   Alles uit gegevens die het dashboard al heeft (ig_partner_info, ig_partner_info_dag): geen extra Meta-vragen.
   - likes_hoog / likes_laag: hun likes per post passen nie bij hun grootte. "Normaal" = rechte lijn door ln(likes) tegen
     ln(volgers) van álle gemeten partners en taggers; afwijking ≥ 2× de gewone spreiding (± de 5% grootste afwijkers).
   - gesprek: ≥ 100 likes per post maar minder dan 0,5 reactie per 100 likes.
   - sprong: ≥ 10% én ≥ 200 volgers erbij tussen 2 metingen (pas vanaf 2 metingen).
   - volgt_veel (zwak): volgt ≥ 1,5× zoveel als z'n eigen volgers én ≥ 1.000. Vaak gewoon "volg jij mij, dan volg ik jou",
     dus in z'n eentje nooit geel; telt alleen mee voor rood samen met een ander signaal.
   Geel = 1 signaal, rood = 2 of meer. Privé, nog nie gemeten of onder 300 volgers = onbekend (nooit rood).
   Jouw keuze (29_partner_keuze.sql) gaat altijd voor: "nie mee samenwerke" = altijd zichtbaar;
   "klopt, is oké" klikt de signalen van dat moment weg, een nieuw signaal brengt de kleur terug.
   Droog gedraaid op 12-10 (chat 19): 1 rood, 13 geel (waarvan 8 alleen volgt veel), 140 niks, 70 onbekend. */
const IGS_IKZELF="the_hague_beachlife";
const IGS_LET={minVolgers:300,volgtX:1.5,volgtMin:1000,likesSd:2,likesN:20,gesprekLikes:100,gesprekPer100:0.5,sprongPct:0.10,sprongMin:200,nieuwDagen:3};
const IGS_SIG_KORT={likes_hoog:"likes passen nie",likes_laag:"likes passen nie",gesprek:"weinig gesprek",sprong:"sprong in volgâhs",volgt_veel:"volgt veel"};
const igsNf=new Intl.NumberFormat("nl-NL",{maximumFractionDigits:1});
let IGS_LIJN=null;
function igsLijn(){
  if(IGS_LIJN&&IGS_LIJN.bron===IGS.info)return IGS_LIJN;
  const p=IGS.info.filter(i=>i.partner!==IGS_IKZELF&&i.volgers>=IGS_LET.minVolgers&&+i.likes_med>0).map(i=>[Math.log(i.volgers),Math.log(+i.likes_med)]);
  let l={bron:IGS.info,ok:false,n:p.length};
  if(p.length>=IGS_LET.likesN){
    const mx=igsGem(p.map(x=>x[0])),my=igsGem(p.map(x=>x[1]));
    const sxx=p.reduce((t,x)=>t+(x[0]-mx)**2,0),sxy=p.reduce((t,x)=>t+(x[0]-mx)*(x[1]-my),0);
    if(sxx>0){const a=sxy/sxx,b=my-a*mx,sd=Math.sqrt(p.reduce((t,x)=>t+(x[1]-(a*x[0]+b))**2,0)/(p.length-1));
      l={...l,ok:sd>0,a,b,sd}}
  }
  return IGS_LIJN=l;
}
let IGS_HISTP=null;
function igsSprong(naam){
  if(!IGS_HISTP||IGS_HISTP.bron!==IGS.hist){const m=new Map();
    IGS.hist.forEach(r=>{if(r.volgers==null)return;if(!m.has(r.partner))m.set(r.partner,[]);m.get(r.partner).push([Date.parse(r.dag),+r.volgers])});
    m.forEach(l=>l.sort((a,b)=>a[0]-b[0]));IGS_HISTP={bron:IGS.hist,m}}
  const h=IGS_HISTP.m.get(naam);if(!h||h.length<2)return null;
  let best=null;
  for(let j=1;j<h.length;j++){const [t0,v0]=h[j-1],[t1,v1]=h[j],erbij=v1-v0,p=v0>0?erbij/v0:0;
    if(erbij>=IGS_LET.sprongMin&&p>=IGS_LET.sprongPct&&(!best||p>best.pct))best={erbij,pct:p,dagen:Math.max(1,Math.round((t1-t0)/864e5))}}
  return best;
}
// kleur: "stop" (jouw keuze) · "rood" · "geel" · "oke" (weggeklikt) · "ok" (niks) · "onbekend"
function igsLetOp(naam){
  const k=IGS.keuze.get(naam)||null,i=(IGS_INFO_M()).get(naam)||null;
  const uit={naam,sig:[],kleur:"ok",keuze:k,volgers:i&&i.volgers!=null?+i.volgers:null,onbekend:null};
  if(!i||i.volgers==null||i.volgers<IGS_LET.minVolgers){
    uit.onbekend=!i?"nog nie gemeten":i.volgers==null?(i.fout&&IGS_NIETEZIEN.test(i.fout)?"privé of persoonlijk account":"nog nie gemeten"):`te klein (onder ${nf0.format(IGS_LET.minVolgers)} volgâhs)`;
    uit.kleur=k&&k.stop?"stop":"onbekend";return uit}
  const v=+i.volgers,L=igsLijn(),lk=i.likes_med!=null?+i.likes_med:null;
  if(lk>0&&L.ok){const norm=L.a*Math.log(v)+L.b,d=Math.log(lk)-norm;
    if(d>=IGS_LET.likesSd*L.sd)uit.sig.push({k:"likes_hoog",t:`veel meer likes dan normaal bij z'n grootte: ${nf0.format(lk)} per post, normaal ± ${nf0.format(Math.exp(norm))}`});
    else if(d<=-IGS_LET.likesSd*L.sd)uit.sig.push({k:"likes_laag",t:`heel weinig likes bij z'n grootte: ${nf0.format(lk)} per post, normaal ± ${nf0.format(Math.exp(norm))}`})}
  if(lk>=IGS_LET.gesprekLikes&&i.reacties_med!=null&&+i.reacties_med*100<IGS_LET.gesprekPer100*lk)
    uit.sig.push({k:"gesprek",t:`veel likes, bijna geen gesprek: ${nf0.format(lk)} likes en ${igsNf.format(+i.reacties_med)} reacties per post`});
  const sp=igsSprong(naam);
  if(sp)uit.sig.push({k:"sprong",t:`sprong in volgâhs: +${nf0.format(sp.erbij)} (${pct(sp.pct)}) in ${sp.dagen} dagen`});
  if(i.volgend!=null&&+i.volgend>=IGS_LET.volgtMin&&+i.volgend>=IGS_LET.volgtX*v)
    uit.sig.push({k:"volgt_veel",zwak:true,t:`volgt veel: ${nf0.format(+i.volgend)} volgend bij ${nf0.format(v)} volgâhs (vaak gewoon volg-terug; telt alleen mee samen met een ander signaal)`});
  if(k&&k.stop){uit.kleur="stop";return uit}
  const sterk=uit.sig.filter(x=>!x.zwak).length,tel=sterk+(sterk&&uit.sig.some(x=>x.zwak)?1:0);
  if(!tel)return uit;
  const oke=(k&&k.oke)||[];
  if(uit.sig.every(x=>oke.includes(x.k))){uit.kleur="oke";return uit}
  uit.kleur=tel>=2?"rood":"geel";return uit;
}
let IGS_INFO_MAP=null;
function IGS_INFO_M(){if(!IGS_INFO_MAP||IGS_INFO_MAP.bron!==IGS.info)IGS_INFO_MAP={bron:IGS.info,m:new Map(IGS.info.map(x=>[x.partner,x]))};return IGS_INFO_MAP.m}
// iedereen die we kennen: partners (nie weggehaald) + wie jou tagt
function igsIedereen(){
  const m=new Map();
  IGS.partners.forEach(r=>{if(r.weg||r.partner===IGS_IKZELF)return;const x=m.get(r.partner)||{naam:r.partner,partner:false,uitgenodigd:true,tagt:false,nieuw:false};
    if(r.status==="Accepted")x.partner=true;m.set(r.partner,x)});
  (IGS.tags||[]).forEach(t=>{if(t.weg||t.maker===IGS_IKZELF)return;const x=m.get(t.maker)||{naam:t.maker,partner:false,uitgenodigd:false,tagt:false,nieuw:false};x.tagt=true;m.set(t.maker,x)});
  // nieuw = aangenomen in de laatste dagen (of op een post van de laatste dagen), of voor het eerst getagd in de laatste dagen
  const grens=Date.now()-IGS_LET.nieuwDagen*864e5,postDatum=new Map(IGS.posts.map(x=>[x.media_id,x.gepost_om]));
  const eerder=new Set();IGS.partners.forEach(r=>{if(r.status!=="Accepted"||r.weg)return;const t=Date.parse(r.aangenomen_om||postDatum.get(r.media_id)||0);
    if(t&&t<grens)eerder.add(r.partner)});
  IGS.partners.forEach(r=>{if(r.status!=="Accepted"||r.weg||eerder.has(r.partner))return;const t=Date.parse(r.aangenomen_om||postDatum.get(r.media_id)||0);
    const x=m.get(r.partner);if(x&&t>=grens)x.nieuw="partner"});
  const eersteTag=new Map();(IGS.tags||[]).forEach(t=>{if(t.weg||!t.gepost_om)return;const v=eersteTag.get(t.maker);if(!v||t.gepost_om<v)eersteTag.set(t.maker,t.gepost_om)});
  eersteTag.forEach((d,n)=>{const x=m.get(n);if(x&&!x.nieuw&&Date.parse(d)>=grens)x.nieuw="tagt"});
  m.forEach(x=>x.let=igsLetOp(x.naam));
  return m;
}
const IGS_KLEUR_RANG={stop:0,rood:1,geel:2,onbekend:4,oke:5,ok:6};
function igsVertrouweCel(l){
  const kort=l.sig.filter(x=>!x.zwak).map(x=>IGS_SIG_KORT[x.k]),zwak=l.sig.filter(x=>x.zwak).map(x=>IGS_SIG_KORT[x.k]);
  const uniek=a=>[...new Set(a)];
  if(l.kleur==="stop")return `<span class="chip letstop">Nie mee samenwerke</span>${l.keuze&&l.keuze.reden?`<span class="igsvs igsreden">${esc(l.keuze.reden)}</span>`:""}`;
  if(l.kleur==="rood"||l.kleur==="geel")return `<span class="chip let${l.kleur}"><span class="letdot" aria-hidden="true"></span>let op</span><span class="igsvs">${esc(uniek(kort.concat(zwak)).join(" · "))}</span>`;
  if(l.kleur==="oke")return `<span class="letok" aria-label="in orde">✓</span><span class="igsvs">weggeklikt: klopt, is oké</span>`;
  if(l.kleur==="onbekend")return `<span class="igsleeg">—</span><span class="igsvs">onbekend: ${esc(l.onbekend)}</span>`;
  return `<span class="letok" aria-label="in orde">✓</span>${zwak.length?`<span class="igsvs">${esc(zwak.join(" · "))}</span>`:""}`;
}
// uitklapblok "Vertrouwe": alle redenen + jouw knoppen
function igsVertrouweBlok(l){
  const k=l.keuze,stopOpen=IGS_STOPFORM===l.naam;
  const regels=l.sig.length?`<ul class="igslijst">${l.sig.map(x=>`<li>${esc(x.t)}</li>`).join("")}</ul>`
    :`<p class="igsvs igswrap">${l.onbekend?"Onbekend: "+esc(l.onbekend)+". Dan kunnen we nie kijken of hun account klopt.":"Geen signalen: hun account ziet er gewoon uit."}</p>`;
  let knoppen="";
  if(IGS.keuzeErr)knoppen=`<p class="igsvs igswrap">Je eigen keuzes bewaren kan pas na <code>supabase/29_partner_keuze.sql</code>.</p>`;
  else if(k&&k.stop)knoppen=`<p class="igsvs igswrap">Jij zette deze op <b>nie mee samenwerke</b>${k.stop_om?` (${dLabel(dagNL(k.stop_om),1)})`:""}${k.reden?`: “${esc(k.reden)}”`:""}.</p><button class="btn" type="button" data-igsk="terug" data-naam="${esc(l.naam)}">Weer samenwerke</button>`;
  else if(stopOpen)knoppen=`<div class="igsstopform"><label for="igsReden">Waarom nie? (alleen jij ziet dit)</label><input id="igsReden" type="text" maxlength="500" placeholder="bijv. nep likes, vraagt geld, past nie bij mij"><div class="igsknoppen"><button class="btn yellow" type="button" data-igsk="stop" data-naam="${esc(l.naam)}">Bewaar</button><button class="btn" type="button" data-igsk="annuleer">Laat maar</button></div></div>`;
  else knoppen=`<div class="igsknoppen"><button class="btn" type="button" data-igsk="stopvraag" data-naam="${esc(l.naam)}">Nie mee samenwerke</button>`
    +(l.kleur==="rood"||l.kleur==="geel"?`<button class="btn" type="button" data-igsk="oke" data-naam="${esc(l.naam)}" data-sig="${esc(l.sig.map(x=>x.k).join(","))}">Klopt, is oké</button>`:"")
    +(l.kleur==="oke"?`<button class="btn" type="button" data-igsk="oke_weg" data-naam="${esc(l.naam)}">Toch weer let op</button>`:"")+`</div>`;
  return `<div class="igsblok"><h4>Vertrouwe?</h4>${regels}${knoppen}${IGS_KEUZEFOUT&&IGS_KEUZEFOUT.naam===l.naam?`<p class="igsvs igswrap igsfout">Bewaren lukte nie: ${esc(IGS_KEUZEFOUT.fout)}</p>`:""}</div>`;
}
let IGS_STOPFORM=null,IGS_KEUZEFOUT=null;
async function igsKeuzeZet(naam,wat,reden,sig){
  IGS_KEUZEFOUT=null;
  try{const r=await sb.rpc("ig_partner_keuze_zet",{p_partner:naam,p_wat:wat,p_reden:reden||null,p_signalen:sig||null});
    if(r.error)throw r.error;if(r.data&&r.data.partner)IGS.keuze.set(r.data.partner,r.data);IGS_STOPFORM=null}
  catch(e){IGS_KEUZEFOUT={naam,fout:e.message||String(e)}}
  renderIgSamen();
}

/* ---------- filter en sorteren (chat 19) ---------- */
let igsFilter="alles";
let igsSort={jij:{kol:"helpt",af:true},tagt:{kol:"samen",af:true}};
let igsOpen=new Set();            // uitgeklapte partners
const IGS_FILTERS=[["alles","Alles"],["letop","Let op"],["volgt_veel","Volgt veel"],["likes","Likes passen nie"],["gesprek","Weinig gesprek"],["sprong","Sprong in volgâhs"],["niks","Levert niks op"],["minder","Doet minder dan z'n grootte"],["stop","Nie mee samenwerke"]];
function igsFilterSet(l,extra){
  const f=new Set(["alles"]);
  if(l.kleur==="rood"||l.kleur==="geel")f.add("letop");
  if(l.kleur==="stop")f.add("stop");
  l.sig.forEach(x=>f.add(x.k==="likes_hoog"||x.k==="likes_laag"?"likes":x.k));
  (extra||[]).forEach(x=>f.add(x));
  return f;
}
function igsFilterHTML(rijen){
  const tel=new Map(IGS_FILTERS.map(([k])=>[k,0]));rijen.forEach(r=>r.f.forEach(k=>tel.set(k,(tel.get(k)||0)+1)));
  if(igsFilter!=="alles"&&!tel.get(igsFilter))igsFilter="alles";
  return IGS_FILTERS.filter(([k])=>k==="alles"||k==="letop"||tel.get(k)).map(([k,t])=>
    `<button type="button" data-igsf="${k}" aria-pressed="${igsFilter===k}">${t} <span class="seg-n">${nf0.format(tel.get(k))}</span></button>`).join("");
}
// kolomkop die sorteert (tik nog een keer = andersom)
function igsKop(kol,tekst,cls,titel){
  const st=igsSort[igsKant],aan=st.kol===kol;
  return `<th class="${cls||""}${aan?" igsaan":""}"${titel?` title="${esc(titel)}"`:""}${aan?` aria-sort="${st.af?"descending":"ascending"}"`:""}><button type="button" class="igskop" data-igss="${kol}">${tekst}</button></th>`;
}
function igsSorteerRijen(rijen,sleutels){
  const st=igsSort[igsKant],f=sleutels[st.kol]||sleutels.helpt;
  return [...rijen].sort((a,b)=>{const x=f(a),y=f(b);
    if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;   // leeg altijd onderaan
    const c=typeof x==="string"?x.localeCompare(y,"nl"):x-y;return st.af?-c:c});
}
function igsNaamCel(naam,extra){
  return `<a href="https://www.instagram.com/${encodeURIComponent(naam)}/" target="_blank" rel="noopener">@${esc(naam)}</a>${extra||""}`;
}
function igsTabelHTML(koppen,rijen,celFn,detailFn,leegTekst){
  if(!rijen.length)return `<tbody><tr><td class="sub">${leegTekst}</td></tr></tbody>`;
  return `<thead><tr>${koppen}<th class="igspijl" aria-hidden="true"></th></tr></thead><tbody>`+rijen.map(r=>{
    const open=igsOpen.has(r.naam);
    return `<tr class="igsrij${open?" open":""}" data-igsrij="${esc(r.naam)}" tabindex="0" aria-expanded="${open}">${celFn(r)}<td class="igspijl" aria-hidden="true">${open?"▴":"▾"}</td></tr>`
      +(open?`<tr class="igsdetail"><td colspan="6"><div class="igsdet">${detailFn(r)}</div></td></tr>`:"")}).join("")+"</tbody>";
}
function igsWieCel(r,eigen){
  const i=r.info;
  if(!i||i.volgers==null)return `<span class="igsleeg">—</span><span class="igsvs">${i&&i.fout&&IGS_NIETEZIEN.test(i.fout)?"nie te zien":"nog nie gemeten"}</span>`;
  let s=`<b>${igsKort(+i.volgers)}</b> volgâhs`;
  const v=eigen&&eigen.verw;
  if(v&&eigen.n>=IGS_MIN)s+=`<span class="chip ${IGS_GR[v.oordeel][0]} igsgr">${IGS_GR[v.oordeel][1]}</span>`;
  else if(i.per_week!=null)s+=`<span class="igsvs">± ${igNf1.format(+i.per_week)} posts/week</span>`;
  return s;
}

/* ---------- Jij tagt: tekenen ---------- */
function renderIgSamen(){
  if(!$("igSamen"))return;
  document.querySelectorAll("#igsKant button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igsKant));
  document.querySelectorAll("#igsPeriode button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igsPeriode));
  if($("igsKop"))$("igsKop").textContent=igsKant==="tagt"?"Wie tagt jou?":"Samenwerkinge: wie helpt je groeie?";
  if(igsKant==="tagt")return renderIgTags();
  const leeg=msg=>{$("igsSub").innerHTML=msg;$("igsStats").innerHTML="";$("igSamen").innerHTML="";$("igsOnder").innerHTML="";$("igsFilter").innerHTML="";$("igsMeer").hidden=true};
  if(IGS.err)return leeg(/relation|schema cache|does not exist/i.test(IGS.err)
    ?"Nog niet klaar: draai eerst <code>supabase/12_samenwerkingen.sql</code> in Supabase."
    :"Samenwerkingen ophalen lukte niet: "+esc(IGS.err));
  if(!IGS.posts.length)return leeg("Nog geen partners opgehaald. Dat gebeurt elke nacht vanzelf (07:05), of draai <code>select public.ig_partners_refresh(45);</code> in Supabase.");

  const s=igSamen();IGS_S=s;
  const metVerw=!!(s.groot&&s.groot.x10B),c=s.collab,o=s.solo;
  const ied=igsIedereen();
  // rijen: partners met cijfers + wie je uitnodigde maar nooit aannam en toch "let op" of "nie mee samenwerke" is (dan weet je dat vóór je opnieuw uitnodigt)
  const rijen=s.rijen.map(r=>({...r,let:(ied.get(r.naam)||{let:igsLetOp(r.naam)}).let,soortRij:"partner"}));
  const al=new Set(rijen.map(r=>r.naam));
  ied.forEach(x=>{if(al.has(x.naam)||!x.uitgenodigd)return;if(!["rood","geel","stop"].includes(x.let.kleur))return;
    const u=s.uitn.get(x.naam);if(!u)return;
    rijen.push({naam:x.naam,let:x.let,soortRij:"uitgenodigd",u,info:IGS_INFO_M().get(x.naam)||null,n:0,eigen:null,totaal:null,zeker:false})});
  rijen.forEach(r=>{const e=[];if(r.zeker&&r.oordeel==="niks")e.push("niks");
    if(r.eigen&&r.eigen.verw&&r.eigen.n>=IGS_MIN&&r.eigen.verw.oordeel==="minder")e.push("minder");r.f=igsFilterSet(r.let,e)});
  const letop=[...ied.values()].filter(x=>x.uitgenodigd||x.partner);
  const nR=letop.filter(x=>x.let.kleur==="rood").length,nG=letop.filter(x=>x.let.kleur==="geel").length;

  $("igsSub").innerHTML=`Per partner vier vragen: <b>helpt 't</b> je groeien, kun je 'm <b>vertrouwe</b>, hoe vaak doen jullie het <b>samen</b>, en <b>wie is 't</b>. Tik op een partner voor alle cijfers en je eigen keuze. Alleen posts waarop de partner je uitnodiging <b>aannam</b> tellen${igsPeriode==="365"?" (laatste jaar)":""}.`;
  $("igsStats").innerHTML=[
    igStat("Goed voor je",nf0.format(s.tel.goed),`partners met meer nieuwe volgâhs per post · ${nf0.format(s.tel.bereik)} alleen bereik, ${nf0.format(s.tel.niks)} levert niks op`),
    igStat("Let op",nR||nG?`<span class="letrood-t">${nf0.format(nR)}</span> · <span class="letgeel-t">${nf0.format(nG)}</span>`:"0",nR||nG?`rood · geel, van ${nf0.format(letop.length)} partners en uitgenodigden · tik op <b>Let op</b> hieronder`:`niemand met signalen, van ${nf0.format(letop.length)} partners en uitgenodigden`),
    igStat("Neme aan",s.alles?pct(s.aan/s.alles):"—",`${nf0.format(s.aan)} van ${nf0.format(s.alles)} uitnodigingen aangenomen`)
  ].join("");
  $("igsFilter").innerHTML=igsFilterHTML(rijen);

  const zicht=igsSorteerRijen(rijen.filter(r=>r.f.has(igsFilter)),{
    naam:r=>r.naam,helpt:r=>r.totaal,vertrouwe:r=>-IGS_KLEUR_RANG[r.let.kleur],samen:r=>r.n||null,wie:r=>r.info&&r.info.volgers!=null?+r.info.volgers:null});
  const toon=igsAlles||igsFilter!=="alles"?zicht:zicht.slice(0,12);
  const koppen=igsKop("naam","Partnâh")+igsKop("helpt","Helpt 't?","","Oordeel en extra nieuwe volgâhs t.o.v. je andere samenwerkingen")
    +igsKop("vertrouwe","Vertrouwe?","","Let op-signalen over hun account (geen oordeel over of het jou iets oplevert)")
    +igsKop("samen","Samen","n","Posts samen waarop ze aannamen, en hoe vaak ze je uitnodiging aannemen")
    +igsKop("wie","Wie is 't?","","Hun volgâhs, en of ze bij jou meer of minder doen dan je bij hun grootte verwacht");
  $("igSamen").innerHTML=igsTabelHTML(koppen,toon,r=>{
    const helpt=r.soortRij==="uitgenodigd"?`<span class="igsleeg">—</span><span class="igsvs">${r.u.aan?"nog geen cijfâhs (post te jong)":"nam nooit aan"}</span>`
      :`${igsOordeel(r)}${r.totaal!=null?`<span class="igsvs"><b class="${r.totaal>=2?"up":r.totaal<=-2?"down":""}">${plus(Math.round(r.totaal))}</b> extra volgâhs</span>`:""}`;
    const samen=r.soortRij==="uitgenodigd"?`0<span class="igsvs">${nf0.format(r.u.aan)} van ${nf0.format(r.u.alles)} aangenomen</span>`
      :`<b>${nf0.format(r.n)}</b> post${r.n===1?"":"s"}<span class="igsvs">neemt ${nf0.format(r.u.aan)} van ${nf0.format(r.u.alles)} aan${r.u.laat?` · ${r.u.laat}× te laat`:""}</span>`;
    return `<td>${igsNaamCel(r.naam,r.soortRij==="partner"?igsBedankKnop(r):"")}${r.u&&r.u.laatst?`<span class="igsvs">laatst ${dLabel(dagNL(r.u.laatst),1)}</span>`:""}</td>
      <td>${helpt}</td><td>${igsVertrouweCel(r.let)}</td><td class="n">${samen}</td><td>${igsWieCel(r,r.eigen)}</td>`},
    r=>{
      const b=[igsVertrouweBlok(r.let)];
      if(r.soortRij==="partner"){
        b.push(`<div class="igsblok"><h4>Cijfers samen</h4><dl class="igsdl">
          <dt>Kijkâhs</dt><dd>${r.bx==null?"—":igNf1.format(r.bx)+"×"}<span class="igsvs">t.o.v. je andere samenwerkingen</span></dd>
          <dt>Volgâhs per post</dt><dd>${igsVs(r.vpp,r.gewoonV,v=>igNf1.format(v))}</dd>
          <dt>Extra volgâhs</dt><dd>${r.totaal==null?"—":`<b>${plus(Math.round(r.totaal))}</b>`}${r.laatN?`<span class="igsvs">waarvan ${plus(Math.round(r.extraLaat))} na laat aannemen</span>`:""}</dd>
          <dt>Volgâhs per 1.000</dt><dd>${igsVs(r.q.v1k,r.qo.v1k,v=>igsNf2.format(v))}</dd>
          <dt>Profielbezoek per 1.000</dt><dd>${igsVs(r.q.pr1k,r.qo.pr1k,v=>igNf1.format(v))}</dd>
          <dt>Likes + delen per kijkâh</dt><dd>${igsVs(r.q.lk,r.qo.lk,v=>pct(v))}</dd></dl></div>`);
        b.push(`<div class="igsblok"><h4>Eigen effect</h4><div class="igseigen">${igsEigenCel(r)}</div></div>`);
      }
      b.push(`<div class="igsblok"><h4>Partnâh zelf</h4><div class="igszelfblok">${igsZelfCel({...r,groei:r.groei||igsGroei(r.naam)})}</div></div>`);
      return b.join("")},
    igsFilter==="alles"?"Nog geen samenwerkingen met cijfers in deze periode.":"Niemand in dit filter.");
  $("igsMeer").hidden=igsFilter!=="alles"||zicht.length<=12;$("igsMeer").textContent=igsAlles?"Minder tonen":`Alle ${nf0.format(zicht.length)} partners tonen`;

  // onder de tabel: twee uitklapblokken (was een lange lap tekst)
  const meer=[];
  if(o.n)meer.push(`<p><b>Zonder partnâh</b> (niemand nam aan): ${nf0.format(o.n)} posts. Kijkers ${c.medB&&o.medB!=null?igNf1.format(o.medB/c.medB)+"×":"—"} een samenwerking, `
    +`maar ${o.v1k==null?"—":igsNf2.format(o.v1k)} volgers per 1.000 kijkers (samenwerkingen ${c.v1k==null?"—":igsNf2.format(c.v1k)}). `
    +`Per post ${o.medV==null?"—":igNf1.format(o.medV)} nieuwe volgers, bij een samenwerking ${c.medV==null?"—":igNf1.format(c.medV)}. Dit is je controlegroep: zo zie je wat een partner extra doet.</p>`);
  if(s.nooit.length)meer.push(`<p><b>Neme nooit aan</b> (3 of meer uitnodigingen): ${s.nooit.slice(0,15).map(([n,u])=>`<a class="chip mute" href="https://www.instagram.com/${encodeURIComponent(n)}/" target="_blank" rel="noopener">@${esc(n)} · 0 van ${u.alles}</a>`).join(" ")}${s.nooit.length>15?` en nog ${s.nooit.length-15}`:""}. Uitnodigen mag, maar reken er niet op.</p>`);
  if(s.zelden.length)meer.push(`<p><b>Neme zelden aan</b>: ${s.zelden.slice(0,10).map(([n,u])=>`@${esc(n)} (${u.aan} van ${u.alles})`).join(", ")}. Als ze wél aannemen kan het veel opleveren: kijk hierboven bij hun rij.</p>`);
  if(s.laat.length){
    const eff=n=>{const l=(s.effect.get(n)||[]);if(!l.length)return "";
      const klaar=l.filter(e=>e.dV!=null||e.dB!=null);
      if(!klaar.length)return " · meet nog";
      const bb=klaar.reduce((a,e)=>a+(e.extraB||0),0),v=klaar.reduce((a,e)=>a+(e.extraV||0),0),bezig=l.some(e=>e.meet);
      return ` · na aannemen ${plus(Math.round(bb))} kijkers, ${plus(Math.round(v))} volgers${bezig?` (meet nog, dag ${nf0.format(Math.max(...l.map(e=>e.dagen||0)))} van 14)`:""}`};
    meer.push(`<p><b>Laat aangenomen</b> (meer dan ± 3 dagen na je post): ${s.laat.slice(0,12).map(([n,u])=>`@${esc(n)} (${u.laat}×${eff(n)})`).join(", ")}${s.laat.length>12?` en nog ${s.laat.length-12}`:""}. Zulke posts tellen niet mee in het oordeel; wat de partner daarna nog opleverde telt mee in <b>Extra volgâhs</b>.</p>`)}
  if(s.weg.length)meer.push(`<p><b>Weggehaald</b> (laatste 90 dagen): ${s.weg.slice(0,12).map(w=>`@${esc(w.naam)}${w.post?` bij post van ${dLabel(dagNL(w.post))}`:""}${w.was==="Accepted"?" (had aangenomen)":""}`).join(", ")}${s.weg.length>12?` en nog ${s.weg.length-12}`:""}. Bewaard als geschiedenis; ze tellen niet mee.</p>`);
  const uitleg=[];
  uitleg.push(`<p><b>Helpt 't?</b> Per partner de middelste post mét deze partner tegen de middelste van je andere samenwerkingen. <b>Goed voor je</b> = meer nieuwe volgers per post (≥ 25% én ≥ 2 extra in totaal); <b>alleen bereik</b> = wel meer kijkers (≥ 1,25×), nie meer volgers; vanaf ${IGS_MIN} posts, daarvoor "te vroeg". <b>Extra volgâhs</b> = ongeveer hoeveel volgers de posts met deze partner meer (of minder) opleverden dan evenveel gewone samenwerkingsposts. Posts jonger dan ${IGS_WACHT} dagen tellen nog nie mee; nam een partner pas later aan, dan telt die post niet voor die partner.`
    +(s.zonderCijfers?` ${nf0.format(s.zonderCijfers)} samenwerkingen hebben nog geen cijfers; het archief vult zich elke nacht aan.`:"")+`</p>`);
  uitleg.push(igsLetOpUitleg());
  uitleg.push(`<p><b>Eigen effect</b> (uitklappen) = wat deze partner zelf toevoegt, los van de andere partners op dezelfde post (zoals plus-minus in de sport). <b>×</b> = zoveel keer meer kijkers dan dezelfde post zonder deze partner; <b>volgâhs/post</b> = zoveel nieuwe volgers kwamen er gemiddeld bij door deze partner. Bij weinig posts is het bewust voorzichtig. <b>Nie te scheiden</b> = altijd samen op dezelfde posts; <b>leunt op 1 post</b> = zonder de beste post blijft er weinig van over. Samenhang is geen bewijs.`
    +(s.eigenSolo<5?` Je hebt weinig posts zonder partner (${nf0.format(s.eigenSolo)}), dus het effect is vooral t.o.v. je andere samenwerkingen.`:"")+`</p>`);
  if(metVerw)uitleg.push(`<p><b>Wie is 't?</b> <b>Doet meer / minder dan z'n grootte</b> = duidelijk meer of minder nieuwe volgers (of kijkers) dan je bij een partner van dat formaat verwacht, en zo vaak dat het geen toeval lijkt. Geleerd uit al je partners samen (${nf0.format(s.groot.n)} met bekende grootte en ${IGS_MIN}+ posts): nu 10× meer volgers bij de partner ≈ ×${igNf1.format(s.groot.x10B)} kijkers en ×${igNf1.format(s.groot.x10V)} nieuwe volgers. Grootte zegt nie of hun publiek bij jou past.</p>`);
  else if(s.groot)uitleg.push(`<p><b>Doet meer / minder dan z'n grootte</b> komt erbij zodra ${nf0.format(s.groot.nodig)} partners met ${IGS_MIN}+ posts een bekende grootte hebben (nu ${nf0.format(s.groot.n)}).</p>`);
  const g=s.gegevens,fb=IGS.fb||{};
  const gFout=fb.grootte_fout&&(!fb.grootte_gelukt_om||Date.parse(fb.grootte_fout_om||0)>Date.parse(fb.grootte_gelukt_om));
  if(g.totaal)uitleg.push(`<p><b>Partnâh zelf</b> = hun eigen account, via Meta: volgers, hoe vaak ze posten, en hoe actief hun publiek is op hun eigen laatste posts. Bereik van hun posts en waar hun volgers wonen geeft Meta niet. `
    +`${nf0.format(g.gemeten)} van ${nf0.format(g.totaal)} partners gemeten${g.nieTeZien?`, ${nf0.format(g.nieTeZien)} nie te zien (persoonlijk of privé-account)`:""}. Elk uur komen er tot 15 bij; wie aannam wordt elke week opnieuw gemeten.`
    +(gFout?` <b>Ophalen lukte laatst nie:</b> ${esc(fb.grootte_fout)}${/\(#10\)|permission/i.test(fb.grootte_fout)?" (de Facebook-sleutel mist het recht <code>instagram_manage_insights</code>)":""}.`:"")+`</p>`);
  $("igsOnder").innerHTML=(meer.length?`<details class="igsuit"><summary>Meer ovâh je uitnodigingen</summary>${meer.join("")}</details>`:"")
    +`<details class="igsuit"><summary>Hoe rekent dit?</summary>${uitleg.join("")}</details>`;
}
function igsLetOpUitleg(){
  const L=igsLijn();
  return `<p><b>Vertrouwe?</b> Kijkt alleen of hun account echt lijkt ("let op", nooit "nep"), met gegevens die we al hebben. Signalen: `
    +`<b>likes passen nie</b> (veel meer of heel weinig likes dan normaal bij hun grootte${L.ok?`; normaal geleerd uit ${nf0.format(L.n)} gemeten accounts`:", komt zodra genoeg accounts gemeten zijn"}), `
    +`<b>weinig gesprek</b> (≥ ${nf0.format(IGS_LET.gesprekLikes)} likes per post maar minder dan ${igsNf.format(IGS_LET.gesprekPer100)} reactie per 100 likes), `
    +`<b>sprong in volgâhs</b> (≥ ${pct(IGS_LET.sprongPct)} én ≥ ${nf0.format(IGS_LET.sprongMin)} erbij tussen 2 metingen) en `
    +`<b>volgt veel</b> (volgt ≥ ${igsNf.format(IGS_LET.volgtX)}× zoveel als z'n volgâhs; telt alleen mee samen met een ander signaal, want volg-terug is heel gewoon). `
    +`<b>Geel</b> = 1 signaal, <b>rood</b> = 2 of meer. Privé, nog nie gemeten of onder ${nf0.format(IGS_LET.minVolgers)} volgâhs = onbekend. `
    +`Jouw eigen keuze gaat altijd voor: <b>Nie mee samenwerke</b> blijft staan tot je hem terugzet; <b>Klopt, is oké</b> klikt de signalen van nu weg (komt er een nieuw signaal bij, dan komt de kleur terug).</p>`;
}

/* ---------- Tagt jou (06-10, 26_tags.sql): posts van anderen waarin jij getagd bent ----------
   Meta geeft per tag-post: maker, datum, soort, likes (nie als ze die verbergen), reacties, link.
   Nooit: bereik, bewaard of gedeeld van hún post, @jou in hun tekst of stories, wie jouw foto deelt.
   - Hun post vs hun normaal = likes (en reacties) van de tag-post ÷ de middelste van hun eigen laatste posts
     (Business Discovery, ig_partner_info; hun tag-posts tellen daar nie in mee). Alleen tags van ≥ IGS_WACHT dagen oud
     (cijfers groeien nog) en van het laatste jaar (hun normaal is van nu).
   - Rond hun post bij jou = jouw nieuwe volgers (en bereik) op de Meta-dag van de tag + de dag erna, tegen de middelste dag
     van de 14 dagen ervóór. Signaal, geen bewijs: op zo'n dag kan ook je eigen post goed lopen (dat zetten we erbij). */
let igsKant="jij";               // "jij" = jij tagt (samenwerkingen), "tagt" = wie tagt jou
const IGS_TAG_VOOR=14;           // je normaal: de 14 Meta-dagen vóór de tag
const IGS_TAG_VOOR_MIN=7;        // minstens zoveel van die dagen mét volgers-cijfer
const IGS_TAG_OUD=365;           // hun post vs hun normaal alleen voor tags van het laatste jaar
const igsLaDag=t=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles"}).format(new Date(t));   // Meta-dag
const igsDagPlus=(d,n)=>new Date(Date.parse(d+"T12:00:00Z")+n*864e5).toISOString().slice(0,10);
function igsGroei(n){
  const h=IGS.hist.filter(r=>r.partner===n&&r.volgers!=null).map(r=>[Date.parse(r.dag),r.volgers]).sort((a,b)=>a[0]-b[0]);
  if(h.length<2)return null;const a=h[0],b=h[h.length-1],dagen=(b[0]-a[0])/864e5;
  return dagen>=7&&a[1]>0?{pct:b[1]/a[1]-1,dagen}:null;
}
// jouw volgers en bereik rond één tag (null = geen eerlijke vergelijking mogelijk)
function igsRondTag(t,dag,eigenDagen,vandaag){
  const d0=igsLaDag(t.gepost_om),d1=igsDagPlus(d0,1);
  if(d1>=vandaag)return null;                                    // dag erna loopt nog (of nog nie begonnen)
  const a=dag.get(d0),b=dag.get(d1);
  if(!a||!b||a.follows==null||b.follows==null)return null;
  const voor=[];for(let i=1;i<=IGS_TAG_VOOR;i++){const x=dag.get(igsDagPlus(d0,-i));if(x&&x.follows!=null)voor.push(x)}
  if(voor.length<IGS_TAG_VOOR_MIN)return null;
  const nV=med(voor.map(x=>x.follows)),rb=voor.filter(x=>x.reach>0).map(x=>x.reach),nB=rb.length>=IGS_TAG_VOOR_MIN?med(rb):null;
  return {d0,maker:t.maker,v:a.follows+b.follows,normV:2*nV,extraV:a.follows+b.follows-2*nV,
    bx:nB&&a.reach!=null&&b.reach!=null?(a.reach+b.reach)/(2*nB):null,zelf:eigenDagen.has(d0)||eigenDagen.has(d1)};
}
function igTags(){
  const nu=Date.now(),grens=igsPeriode==="alles"?0:nu-365*864e5,jong=nu-IGS_WACHT*864e5,oud=nu-IGS_TAG_OUD*864e5;
  const info=new Map(IGS.info.map(x=>[x.partner,x]));
  const dag=new Map(((typeof IG!=="undefined"&&IG.dag)||[]).map(x=>[x.dag,{follows:x.c&&x.c.follows!=null?+x.c.follows:null,reach:x.c&&x.c.reach!=null?+x.c.reach:null}]));
  const eersteDag=[...dag].filter(([,x])=>x.follows!=null).map(([d])=>d).sort()[0]||null;
  const vandaag=igsLaDag(nu);
  const eigenDagen=new Set(((typeof IG!=="undefined"&&IG.posts)||[]).filter(p=>p.gepost_om).map(p=>igsLaDag(p.gepost_om)));
  const tags=IGS.tags.filter(t=>!t.weg&&t.gepost_om&&Date.parse(t.gepost_om)>=grens).sort((a,b)=>a.gepost_om<b.gepost_om?1:-1);
  // ook partnâh bij jouw samenwerkingen? (aangenomen, nie weggehaald) + oordeel uit "Jij tagt"
  const samen=new Map();IGS.partners.forEach(r=>{if(r.status==="Accepted"&&!r.weg)samen.set(r.partner,(samen.get(r.partner)||0)+1)});
  let sj=null;try{sj=IGS.posts.length?igSamen():null}catch(e){sj=null}
  const oordeel=new Map(((sj&&sj.rijen)||[]).map(r=>[r.naam,r]));
  const per=new Map();
  tags.forEach(t=>{const m=per.get(t.maker)||{naam:t.maker,tags:[]};m.tags.push(t);per.set(t.maker,m)});
  const alleXl=[],alleRond=[];
  const rijen=[...per.values()].map(m=>{
    const i=info.get(m.naam),gr=i&&i.volgers!=null;
    const perf=m.tags.filter(t=>Date.parse(t.gepost_om)<=jong&&Date.parse(t.gepost_om)>=oud);
    const xl=gr&&i.likes_med>0?perf.filter(t=>t.likes!=null).map(t=>t.likes/i.likes_med):[];
    const xr=gr&&i.reacties_med>0?perf.filter(t=>t.reacties!=null).map(t=>t.reacties/i.reacties_med):[];
    alleXl.push(...xl);
    const rond=m.tags.map(t=>igsRondTag(t,dag,eigenDagen,vandaag)).filter(Boolean);alleRond.push(...rond);
    m.rond=rond;
    return {naam:m.naam,n:m.tags.length,n90:m.tags.filter(t=>Date.parse(t.gepost_om)>nu-90*864e5).length,laatst:m.tags[0].gepost_om,
      info:i||null,groei:igsGroei(m.naam),nPerf:perf.length,xl:med(xl),nL:xl.length,xr:med(xr),nR:xr.length,
      verborgen:perf.filter(t=>t.likes==null).length,
      rond:rond.length?{n:rond.length,extraV:rond.reduce((a,x)=>a+x.extraV,0),bx:med(rond.map(x=>x.bx).filter(v=>v!=null)),zelf:rond.filter(x=>x.zelf).length,ook:[]}:null,
      samen:samen.get(m.naam)||0,oordeel:oordeel.get(m.naam)||null};
  }).sort((a,b)=>b.n-a.n||(a.laatst<b.laatst?1:-1));
  // tags van verschillende makers op (bijna) dezelfde dagen: dan delen ze dezelfde volgers → erbij zeggen, nie dubbel tellen
  rijen.forEach(r=>{if(!r.rond)return;const eigen=per.get(r.naam).rond,ook=new Set();
    eigen.forEach(x=>alleRond.forEach(y=>{if(y.maker!==r.naam&&Math.abs(Date.parse(y.d0)-Date.parse(x.d0))<=864e5)ook.add(y.maker)}));
    r.rond.ook=[...ook]});
  const n90=tags.filter(t=>Date.parse(t.gepost_om)>nu-90*864e5).length;
  // per tag-dag 1× tellen (twee makers op dezelfde dag = dezelfde volgers)
  const perDag=new Map();alleRond.forEach(x=>perDag.set(x.d0,x));
  return {rijen,tags,n90,xl:med(alleXl),nXl:alleXl.length,rond:[...perDag.values()],eersteDag,
    ookPartner:rijen.filter(r=>r.samen>0).length,
    metGrootte:rijen.filter(r=>r.info&&r.info.volgers!=null).length,
    nieTeZien:rijen.filter(r=>r.info&&r.info.volgers==null&&r.info.fout&&IGS_NIETEZIEN.test(r.info.fout)).length};
}
const igsX=(f,woord)=>`<b class="${f>=1.25?"up":f<=0.8?"down":""}">×${igsF(f)}</b> ${woord}`;
const igsDatum=t=>{const d=dagNL(t);return Date.parse(t)>Date.now()-300*864e5?dKort(d):dLabel(d,1)};
function igsTagPerfCel(r){
  const i=r.info;
  if(!i||i.volgers==null)return `—<span class="igsvs">${i&&i.fout&&IGS_NIETEZIEN.test(i.fout)?"hun normaal nie te zien":"hun normaal nog nie gemeten"}</span>`;
  if(!r.nPerf)return `—<span class="igsvs">geen tag van ≥ ${IGS_WACHT} dagen in het laatste jaar</span>`;
  const l=[];
  if(r.xl!=null)l.push(igsX(r.xl,"likes"));
  if(r.xr!=null)l.push(igsX(r.xr,"reacties"));
  if(!l.length)return `—<span class="igsvs">${i.likes_verborgen||r.verborgen?"likes verborgen":"te weinig cijfers"}</span>`;
  return l.join("<br>")+`<span class="igsvs">${r.nPerf} tag${r.nPerf===1?"":"s"} t.o.v. hun eigen posts</span>`
    +(r.verborgen?`<span class="igsvs">likes verborgen bij ${r.verborgen}</span>`:"");
}
function igsTagRondCel(r,eersteDag){
  const e=r.rond;
  if(!e)return `—<span class="igsvs">${eersteDag?"geen dagcijfers rond hun tag":"nog geen dagcijfers"}</span>`;
  return `<b class="${e.extraV>=2?"up":e.extraV<=-2?"down":""}">${plus(Math.round(e.extraV))}</b> volgâhs`
    +(e.bx!=null?`<br>${igsX(e.bx,"bereik")}`:"")
    +`<span class="igsvs">${e.n} tag${e.n===1?"":"s"} · t.o.v. je normaal</span>`
    +(e.zelf?`<span class="igsvs">je postte zelf ook (${e.zelf}×)</span>`:"")
    +(e.ook.length?`<span class="igsvs">zelfde dagen als ${e.ook.slice(0,2).map(n=>"@"+esc(n)).join(", ")}${e.ook.length>2?` +${e.ook.length-2}`:""}</span>`:"");
}
function igsTagPartnerCel(r){
  if(r.oordeel){const o=r.oordeel;const [k,t]=IGS_OORDEEL[o.oordeel];
    return `<span class="chip ${o.zeker?k:"mute"}">${o.zeker?t:"te vroeg"}</span><span class="igsvs">${r.samen}× samen aangenomen</span>`}
  return r.samen?`${r.samen}× samen<span class="igsvs">nog geen cijfers</span>`:`—<span class="igsvs">alleen tags</span>`;
}
function renderIgTags(){
  const leeg=msg=>{$("igsSub").innerHTML=msg;$("igsStats").innerHTML="";$("igSamen").innerHTML="";$("igsOnder").innerHTML="";$("igsFilter").innerHTML="";$("igsMeer").hidden=true};
  if(IGS.tagErr)return leeg(/relation|schema cache|does not exist/i.test(IGS.tagErr)
    ?"Nog niet klaar: draai eerst <code>supabase/26_tags.sql</code> in Supabase."
    :"Tags ophalen lukte niet: "+esc(IGS.tagErr));
  const st=IGS.tagStand||{};
  const fout=st.fout&&(!st.gelukt_om||Date.parse(st.fout_om||0)>Date.parse(st.gelukt_om))
    ?`<p class="sub"><b>Ophalen lukte laatst nie:</b> ${esc(st.fout)}${/\(#10\)|permission/i.test(st.fout)?" (de Facebook-sleutel mist het recht <code>instagram_manage_comments</code>)":""}.</p>`:"";
  if(!IGS.tags.length)return leeg("Nog geen tags opgehaald. Dat gebeurt elke nacht vanzelf (07:22), of draai <code>select public.ig_tags_refresh(true);</code> in Supabase."+fout);
  const s=igTags();
  const rijen=s.rijen.filter(r=>r.naam!==IGS_IKZELF).map(r=>{const l=igsLetOp(r.naam),o=r.oordeel,e=[];
    if(o&&o.zeker&&o.oordeel==="niks")e.push("niks");
    if(o&&o.eigen&&o.eigen.verw&&o.eigen.n>=IGS_MIN&&o.eigen.verw.oordeel==="minder")e.push("minder");
    return {...r,let:l,f:igsFilterSet(l,e)}});
  const nR=rijen.filter(r=>r.let.kleur==="rood").length,nG=rijen.filter(r=>r.let.kleur==="geel").length;
  $("igsSub").innerHTML=`Wie tagt jou in hún post? Per maker dezelfde vier vragen: <b>helpt 't</b> (wat er rond hun post bij jou gebeurde), kun je 'm <b>vertrouwe</b>, hoe vaak <b>samen</b>, en <b>wie is 't</b>. Tik op een maker voor alle cijfers${igsPeriode==="365"?" (laatste jaar)":""}.`;
  const rMid=med(s.rond.map(x=>x.extraV));
  $("igsStats").innerHTML=[
    igStat("Tags",nf0.format(s.tags.length),`door ${nf0.format(s.rijen.length)} makers · laatste 90 dagen ${nf0.format(s.n90)} (± ${igNf1.format(s.n90/13)} per week)`),
    igStat("Let op",nR||nG?`<span class="letrood-t">${nf0.format(nR)}</span> · <span class="letgeel-t">${nf0.format(nG)}</span>`:"0",nR||nG?`rood · geel, van ${nf0.format(rijen.length)} makers · tik op <b>Let op</b> hieronder`:`niemand met signalen, van ${nf0.format(rijen.length)} makers`),
    igStat("Rond hun post",s.rond.length?plus(Math.round(rMid)):"—",s.rond.length?`volgâhs bij jou per tag-dag (middelste van ${nf0.format(s.rond.length)}), t.o.v. je normaal · signaal, geen bewijs`:"nog geen tags met jouw dagcijfers erbij")
  ].join("");
  $("igsFilter").innerHTML=igsFilterHTML(rijen);
  const zicht=igsSorteerRijen(rijen.filter(r=>r.f.has(igsFilter)),{
    naam:r=>r.naam,helpt:r=>r.rond?r.rond.extraV:null,vertrouwe:r=>-IGS_KLEUR_RANG[r.let.kleur],samen:r=>r.n,wie:r=>r.info&&r.info.volgers!=null?+r.info.volgers:null});
  const toon=igsAlles||igsFilter!=="alles"?zicht:zicht.slice(0,12);
  const koppen=igsKop("naam","Wie tagt jou")+igsKop("helpt","Helpt 't?","","Jouw nieuwe volgâhs op de dag van hun post + de dag erna, t.o.v. je normaal (signaal, geen bewijs)")
    +igsKop("vertrouwe","Vertrouwe?","","Let op-signalen over hun account")+igsKop("samen","Samen","n","Hoe vaak ze je tagden")
    +igsKop("wie","Wie is 't?","","Hun volgâhs");
  $("igSamen").innerHTML=igsTabelHTML(koppen,toon,r=>{
    const e=r.rond,o=r.oordeel;
    const helpt=(e?`<b class="${e.extraV>=2?"up":e.extraV<=-2?"down":""}">${plus(Math.round(e.extraV))}</b> volgâhs<span class="igsvs">rond ${e.n} tag${e.n===1?"":"s"}</span>`
      :`<span class="igsleeg">—</span><span class="igsvs">geen dagcijfers rond hun tag</span>`)
      +(o?`<span class="igsvs">ook partnâh: ${o.zeker?IGS_OORDEEL[o.oordeel][1].toLowerCase():"te vroeg"}</span>`:r.samen?`<span class="igsvs">ook partnâh (${r.samen}×)</span>`:"");
    return `<td>${igsNaamCel(r.naam)}</td><td>${helpt}</td><td>${igsVertrouweCel(r.let)}</td>
      <td class="n"><b>${nf0.format(r.n)}</b> tag${r.n===1?"":"s"}<span class="igsvs">laatst ${igsDatum(r.laatst)}${r.n90?` · ${r.n90} in 90 d`:""}</span></td>
      <td>${igsWieCel(r,o&&o.eigen)}</td>`},
    r=>[igsVertrouweBlok(r.let),
      `<div class="igsblok"><h4>Hun post vs hun normaal</h4><div class="igseigen">${igsTagPerfCel(r)}</div></div>`,
      `<div class="igsblok"><h4>Rond hun post bij jou</h4><div class="igseigen">${igsTagRondCel(r,s.eersteDag)}</div></div>`,
      `<div class="igsblok"><h4>Ook partnâh?</h4>${igsTagPartnerCel(r)}</div>`,
      `<div class="igsblok"><h4>Partnâh zelf</h4><div class="igszelfblok">${igsZelfCel(r)}</div></div>`].join(""),
    igsFilter==="alles"?"Geen tags in deze periode.":"Niemand in dit filter.");
  $("igsMeer").hidden=igsFilter!=="alles"||zicht.length<=12;$("igsMeer").textContent=igsAlles?"Minder tonen":`Alle ${nf0.format(zicht.length)} makers tonen`;
  const laatste=s.tags.slice(0,10);
  const uitleg=[];
  uitleg.push(`<p><b>Wat je wel en nie ziet.</b> Meta geeft per post waarin jij getagd bent: wie, wanneer, reel of post, likes (nie als ze die verbergen), reacties en de link. `
    +`Bereik, bewaard en gedeeld van hún post krijg je nooit. @jou in hun tekst of in hun story, en wie jouw foto deelt, kan Meta ook nie laten zien.</p>`);
  uitleg.push(`<p><b>Helpt 't?</b> = jouw nieuwe volgers op de dag van hun post en de dag erna, min wat je op twee gewone dagen krijgt (de middelste dag van de ${IGS_TAG_VOOR} dagen ervóór). `
    +`Een <b>signaal, geen bewijs</b>: op die dag kan ook je eigen post goed lopen ("je postte zelf ook"), en twee makers op dezelfde dagen delen dezelfde volgers. De tegel bovenaan telt elke dag maar 1×. `
    +`${s.eersteDag?`Jouw dagcijfers beginnen op ${dLabel(s.eersteDag,1)}: oudere tags hebben hier geen cijfer.`:""}</p>`);
  uitleg.push(`<p><b>Hun post vs hun normaal</b> (uitklappen) = likes (en reacties) van hun post met jouw tag, gedeeld door de middelste van hun eigen laatste posts. ×2 = twee keer zoveel likes als normaal bij hen. Alleen tags van minstens ${IGS_WACHT} dagen oud en van het laatste jaar.${s.xl!=null?` Over alle makers: ×${igsF(s.xl)} (${nf0.format(s.nXl)} tags).`:""}</p>`);
  uitleg.push(igsLetOpUitleg());
  uitleg.push(`<p><b>Partnâh zelf</b>: ${nf0.format(s.metGrootte)} van ${nf0.format(s.rijen.length)} makers gemeten${s.nieTeZien?`, ${nf0.format(s.nieTeZien)} nie te zien (persoonlijk of privé-account)`:""}. `
    +`Tags ophalen: elke nacht de nieuwste, 1× per week de hele lijst${st.volledig_om?` (laatst ${igTijd(Date.parse(st.volledig_om))}, ${nf0.format(st.aantal||0)} posts)`:""}. Verdwijnt een post of tag, dan telt hij nie meer mee.`
    +(st.melding?` <i>${esc(st.melding)}</i>`:"")+`</p>`);
  $("igsOnder").innerHTML=(laatste.length?`<details class="igsuit"><summary>Laatste ${laatste.length} tags</summary><p>${laatste.map(t=>`<a class="chip mute" href="${esc(t.link||("https://www.instagram.com/"+encodeURIComponent(t.maker)+"/"))}" target="_blank" rel="noopener">${igsDatum(t.gepost_om)} · @${esc(t.maker)} · ${t.soort==="REELS"?"reel":"post"}${t.likes!=null?` · ${igsKort(t.likes)} likes`:" · likes verborgen"}</a>`).join(" ")}</p></details>`:"")
    +`<details class="igsuit"><summary>Hoe rekent dit?</summary>${uitleg.join("")}</details>`+fout;
}

/* ---------- waarschuwing: Facebook-sleutel (verlengt zichzelf niet, 60 dagen) ---------- */
const FB_SLEUTELFOUT=/access token|oauth|session has expired|not authori[sz]ed|\(#190\)|Vault/i;
function fbKoppeling(){
  const t=IGS.fb;if(!t)return null;
  const gelukt=t.gelukt_om?Date.parse(t.gelukt_om):0,vo=t.verloopt_op?Date.parse(t.verloopt_op):0;
  if(t.fout&&FB_SLEUTELFOUT.test(t.fout)&&(!t.fout_om||Date.parse(t.fout_om)>gelukt))
    return {kop:"Facebook-sleutel werkt nie meer",tekst:"De samenwerkingen worden niet meer bijgewerkt. Je bent niks kwijt: na een nieuwe sleutel haalt de nacht-ronde alles opnieuw op.",detail:t.fout};
  if(vo&&vo<Date.now())return {kop:"Facebook-sleutel is verlopen",tekst:`De sleutel voor de samenwerkingen is verlopen op <b>${igTijd(vo)}</b>. Je bent niks kwijt: maak een nieuwe en alles wordt weer bijgewerkt.`};
  if(vo&&vo-Date.now()<7*864e5)return {kop:"Facebook-sleutel verloopt bijna",tekst:`De sleutel voor de samenwerkingen verloopt op <b>${igTijd(vo)}</b>. Hij verlengt zichzelf niet: maak op tijd een nieuwe (5 minuten).`};
  return null;
}
function fbAlarmHTML(){
  const k=fbKoppeling();if(!k)return "";
  return `<div class="alarm oud" role="status">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">!</span><h2>${k.kop}</h2></div>
    <p>${k.tekst}</p>
    <details><summary>Zo maak je een nieuwe sleutel (5 minuten)</summary><ol>
      <li>Ga naar de <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a>. Rechts: <b>Meta App</b> = haagse-dashboard, <b>User or Page</b> = User Token, en bij Permissions <code>instagram_basic</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>instagram_manage_insights</code> (voor de partnergegevens) en <code>instagram_manage_comments</code> (voor wie jou tagt; wordt alleen gelezen). Dat zijn er 5.</li>
      <li>Klik <b>Generate Access Token</b>. Kies in het venster "<b>current Pages only</b>" (The Hague Beachlife) en "<b>current Instagram accounts only</b>" (the_hague_beachlife).</li>
      <li>Klik op het blauwe <b>i</b>-rondje links in het sleutelvak → <b>Open in Access Token Tool</b> → <b>Extend Access Token</b> → <b>Debug</b>. Bij <i>Expires</i> moet nu "in about 2 months" staan, en bij <i>Scopes</i> alle 5 rechten.</li>
      <li>Kopieer de sleutel uit het vak bovenaan (klik erin, Cmd+A, Cmd+C). Plak hem nergens anders dan in de Vault.</li>
      <li>Supabase → <b>Integrations</b> → <b>Vault</b> → <code>facebook_access_token</code> → <b>Edit</b> → plakken → <b>Save</b>.</li>
      <li>Wil je niet tot vannacht wachten: SQL Editor → <code>select public.fb_token_check(), public.ig_partners_refresh(45);</code> → Run. Daarna verdwijnt deze melding.</li>
      <li>Staat bij <i>Expires</i> dezelfde datum als bij de vorige sleutel? Dat gebeurde op 30-09 bij een sleutel van dezelfde dag. Probeer het dan een dag later opnieuw.</li>
    </ol>${k.detail?`<p class="sub">Melding van Meta: ${esc(k.detail)}</p>`:""}</details>
  </div>`;
}

/* ---------- menu-onderdeel Partnâhs (sinds 03-10): tabjes per kanaal, nu alleen Insta ---------- */
let ptTab="insta";
function renderPartners(){
  if(!$("s-partners"))return;
  document.querySelectorAll("#ptTabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.pt===ptTab));
  document.querySelectorAll('#s-partners [id^="pt-"]').forEach(d=>d.hidden=d.id!=="pt-"+ptTab);
  $("ptAlarm").innerHTML=fbAlarmHTML();   // Facebook-sleutel: ook hier, want daar draait alles op
  if(ptTab==="insta")renderIgSamen();
}

/* ---------- Ovâhzicht (chat 19): alleen een melding als er iets te melden is ----------
   - een nieuwe partner (aangenomen in de laatste 3 dagen) of nieuwe tagger die geel/rood is (of op "nie mee samenwerke" staat)
   - partners/taggers met rood */
function igsLetOpHTML(){
  if(typeof IGS==="undefined"||IGS.err||(!IGS.partners.length&&!(IGS.tags||[]).length))return "";
  const ied=[...igsIedereen().values()];
  const nieuw=ied.filter(x=>x.nieuw&&["geel","rood","stop"].includes(x.let.kleur));
  const rood=ied.filter(x=>x.let.kleur==="rood"&&!nieuw.includes(x));
  const lijst=[...nieuw,...rood];if(!lijst.length)return "";
  const rol=x=>x.nieuw==="partner"?"nieuwe partnâh":x.nieuw==="tagt"?"tagt je voor het eerst":x.partner?"partnâh":x.tagt?"tagt jou":"uitgenodigd";
  const kop=nieuw.length&&rood.length?"Partnâhs: let op":nieuw.length?(nieuw.length===1?"Nieuwe partnâh: let op":`${nieuw.length} nieuwe partnâhs: let op`)
    :`${rood.length} partnâh${rood.length===1?"":"s"} om op te lette`;
  const kant=lijst[0].partner||!lijst[0].tagt?"jij":"tagt";
  return `<div class="alarm oud letop" role="status"><div class="alarmkop"><span class="alarmicoon" aria-hidden="true">!</span><h2>${kop}</h2></div>
    <p>${lijst.slice(0,4).map(x=>`<span class="chip let${x.let.kleur}">@${esc(x.naam)}</span> ${rol(x)}: ${esc([...new Set(x.let.sig.filter(s=>!s.zwak||x.let.kleur==="rood").map(s=>IGS_SIG_KORT[s.k]))].join(" · ")||"nie mee samenwerke")}`).join("<br>")}${lijst.length>4?`<br>en nog ${lijst.length-4}`:""}</p>
    <p class="pc"><button class="btn" type="button" data-ga="partners" data-igsnaar="${kant}">Kèk bè Partnâhs</button></p></div>`;
}
function igsToggle(naam){
  if(igsOpen.has(naam))igsOpen.delete(naam);else igsOpen.add(naam);
  if(IGS_STOPFORM===naam&&!igsOpen.has(naam))IGS_STOPFORM=null;
  renderIgSamen();
  const r=document.querySelector(`tr[data-igsrij="${CSS.escape(naam)}"]`);if(r)r.focus({preventScroll:true});
}

document.addEventListener("click",e=>{
  const t=e.target.closest("#ptTabs button");if(t){ptTab=t.dataset.pt;renderPartners();return}
  const p=e.target.closest("#igsPeriode button");if(p){igsPeriode=p.dataset.v;renderIgSamen();return}
  const k=e.target.closest("#igsKant button");if(k){igsKant=k.dataset.v;igsAlles=false;IGS_STOPFORM=null;igsOpen.clear();renderIgSamen();return}
  const f=e.target.closest("#igsFilter button");if(f){igsFilter=f.dataset.igsf;renderIgSamen();return}
  const ks=e.target.closest("[data-igss]");if(ks){const st=igsSort[igsKant],kol=ks.dataset.igss;
    if(st.kol===kol)st.af=!st.af;else{st.kol=kol;st.af=kol!=="naam"}renderIgSamen();return}
  const kz=e.target.closest("[data-igsk]");if(kz){const w=kz.dataset.igsk,n=kz.dataset.naam;
    if(w==="stopvraag"){IGS_STOPFORM=n;renderIgSamen();const i=$("igsReden");if(i)i.focus();return}
    if(w==="annuleer"){IGS_STOPFORM=null;renderIgSamen();return}
    kz.disabled=true;
    igsKeuzeZet(n,w,w==="stop"?(($("igsReden")||{}).value||""):null,w==="oke"?(kz.dataset.sig||"").split(",").filter(Boolean):null);return}
  const nr=e.target.closest("[data-igsnaar]");if(nr){igsKant=nr.dataset.igsnaar;igsFilter="letop";igsAlles=false;renderIgSamen();return}
  if(e.target.closest("#igsMeer")){igsAlles=!igsAlles;renderIgSamen();return}
  const rij=e.target.closest("tr[data-igsrij]");if(rij&&!e.target.closest("a,button,input,label")){igsToggle(rij.dataset.igsrij)}
});
document.addEventListener("keydown",e=>{
  if(e.target&&e.target.id==="igsReden"&&e.key==="Enter"){e.preventDefault();const b=document.querySelector('[data-igsk="stop"]');if(b)b.click();return}
  if(e.target&&e.target.matches&&e.target.matches("tr[data-igsrij]")&&(e.key==="Enter"||e.key===" ")){e.preventDefault();igsToggle(e.target.dataset.igsrij)}
});
