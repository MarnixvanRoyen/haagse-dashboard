// insta.js — onderdeel Insta (@the_hague_beachlife). Data uit Supabase (09_insta.sql + 09b_insta_extra.sql).
// Let op: Meta rekent dagen in Los Angeles-tijd (9 uur achter op Den Haag). Account-cijfers per dag gebruiken die "Meta-dag".

let IG={acc:null,profiel:[],dag:[],posts:[],stories:[],err:null};
let igKies="soort";            // "Wat werkt": waarop vergelijken
let igLabelAantal=20;          // hoeveel posts in de muziek-lijst
let igAlleenLeeg=false;        // alleen posts zonder muziek-label tonen
let igSorteer="nieuw";         // muziek-lijst: "nieuw" of "bereik"
let igTopPeriode="90";         // toppâhs: "90" (laatste 90 dagen) of "alles" (allâh tijde)
let igTopOp="bereik";          // toppâhs: sorteren op bereik, kwaliteit, volgers, profiel, likes of weergaven (zie IG_TOP_OP)
let igStoryPeriode="7";        // stories: "7", "30" of "alles"
let igStoryWie="eigen";        // stories: "eigen" (zelf gemaakt, + oude die we nie kennen) of "alles" (ook gedeelde posts)

async function igAlles(maak){   // haalt alles op, 1000 per keer (Supabase geeft max 1000 regels per vraag)
  let out=[],from=0;
  for(;;){const {data,error}=await maak().range(from,from+999);if(error)throw error;out=out.concat(data);if(data.length<1000)break;from+=1000}
  return out;
}
async function loadIG(){
  try{
    const since=new Date(Date.now()-120*864e5).toISOString().slice(0,10);
    const [a,p,d,m,s]=await Promise.all([
      sb.from("ig_account").select("ig_id,gebruikersnaam,volgers,volgend,posts,bijgewerkt_om").order("bijgewerkt_om",{ascending:false}).limit(1),
      sb.from("ig_profiel_dag").select("dag,volgers,volgend,posts").gte("dag",since).order("dag"),
      sb.from("ig_account_dag").select("dag,cijfers").gte("dag",since).order("dag"),
      igAlles(()=>sb.from("ig_post_stats").select("media_id,soort,product,gepost_om,permalink,plaatje,bijschrift,bereik,weergaven,likes,reacties,bewaard,gedeeld,nieuwe_volgers,profielbezoeken,kijktijd_sec,kwaliteit,volgers_toen,weekdag,uur,labels").order("gepost_om",{ascending:false})),
      igStoriesLaden()]);   // alle stories: ze blijven bewaard, ook na 24 uur
    for(const r of [a,p,d,s])if(r.error)throw r.error;
    IG={acc:a.data[0]||null,profiel:p.data,dag:d.data.map(x=>({dag:String(x.dag).slice(0,10),c:x.cijfers||{}})),posts:m,stories:s.data,err:null};
  }catch(e){IG={acc:null,profiel:[],dag:[],posts:[],stories:[],err:e.message||String(e)}}
  IG.status=await igStatusLaden();
  await igStoryLabels();
  if(typeof igSamenLaden==="function")await igSamenLaden();   // samenwerkingen + Facebook-sleutel (samenwerking.js)
  igBadge();
}
// stories mét bijschrift (14_story_bijschrift.sql). Is die kolom er nog nie, dan zonder (dan is alles "onbekend").
async function igStoriesLaden(){
  const q=k=>sb.from("ig_story").select(k).order("gepost_om",{ascending:false}).range(0,1999);
  let r=await q("media_id,soort,gepost_om,permalink,cijfers,fout,bijschrift");
  if(r.error&&/bijschrift/i.test(r.error.message||""))r=await q("media_id,soort,gepost_om,permalink,cijfers,fout");
  return r;
}
// muziek-keuzes van stories (posts krijgen hun labels al mee via ig_post_stats)
async function igStoryLabels(){
  if(!IG.stories.length)return;
  let rijen=[];try{rijen=await igAlles(()=>sb.from("ig_media_label").select("media_id,soort,label,bron").eq("soort","muziek").eq("weg",false))}catch(e){}
  const per=new Map();rijen.forEach(r=>{if(!per.has(r.media_id))per.set(r.media_id,[]);per.get(r.media_id).push(r)});
  IG.stories.forEach(s=>s.labels=per.get(s.media_id)||[]);
}
// laatste ververs-poging (ig_ververst) en de sleutel (ig_token); los opgehaald, zodat een ontbrekende tabel niks kapot maakt
async function igStatusLaden(){
  const [v,t]=await Promise.all([
    sb.from("ig_ververst").select("om,fout").limit(1).then(r=>r,()=>({})),
    sb.from("ig_token").select("verloopt_op,fout,gecontroleerd_om").limit(1).then(r=>r,()=>({}))]);
  return {ververst:(v.data&&v.data[0])||null,token:(t.data&&t.data[0])||null};
}

/* ---------- Waarschuwing: werkt de koppeling met Meta nog? ----------
   Een fout telt alleen als hij nieuwer is dan de laatste keer dat het wél lukte (ig_account.bijgewerkt_om),
   zodat een oude fout na het maken van een nieuwe sleutel vanzelf verdwijnt. */
const IG_SLEUTELFOUT=/access token|not authori[sz]ed|OAuthException|session has expired|Error validating|\(#190\)|code 190/i;
function igTijd(ts){return new Date(ts).toLocaleString("nl-NL",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Amsterdam"})}
function igKoppeling(){
  const st=IG.status||{},acc=IG.acc;
  const gelukt=acc&&acc.bijgewerkt_om?Date.parse(acc.bijgewerkt_om):0;
  const fouten=[];
  const zet=(tekst,ts)=>{if(tekst&&IG_SLEUTELFOUT.test(tekst)&&(!ts||Date.parse(ts)>gelukt))fouten.push(tekst)};
  if(LIVE.ig&&LIVE.ig.fout)zet(LIVE.ig.fout,LIVE.ig.om||new Date().toISOString());
  if(st.ververst)zet(st.ververst.fout,st.ververst.om);
  if(st.token)zet(st.token.fout,st.token.gecontroleerd_om);
  const sinds=gelukt?igTijd(gelukt):"onbekend";
  if(fouten.length)return {nivo:"kapot",kop:"Insta-koppeling is stuk",
    tekst:`Meta weigert de sleutel. De laatste keer dat het lukte: <b>${sinds}</b>. Tot je een nieuwe sleutel maakt, komen er geen nieuwe Insta-cijfers binnen.`,
    detail:fouten[0].replace(/^[a-z ]+\d*[-\d]*:\s*/i,"")};
  if(gelukt&&Date.now()-gelukt>30*36e5)return {nivo:"oud",kop:"Geen verse Insta-cijfâhs",
    tekst:`De laatste keer dat het ophalen lukte: <b>${sinds}</b> (meer dan een dag geleden). Tik bovenaan op "Ververse" om het opnieuw te proberen; blijft dit staan, maak dan een nieuwe sleutel.`};
  const vo=st.token&&st.token.verloopt_op?Date.parse(st.token.verloopt_op):0;
  if(vo&&vo-Date.now()<7*864e5)return {nivo:"oud",kop:"Insta-sleutel verloopt bijna",
    tekst:`De sleutel verloopt op <b>${igTijd(vo)}</b> en het automatisch verlengen is niet gelukt. Maak op tijd een nieuwe sleutel.`,detail:st.token.fout||""};
  return null;
}
function igAlarmHTML(){
  const fb=typeof fbAlarmHTML==="function"?fbAlarmHTML():"";   // Facebook-sleutel (samenwerkingen) apart, zie samenwerking.js
  const k=igKoppeling();if(!k)return fb;
  return `<div class="alarm ${k.nivo}" role="alert">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">!</span><h2>${k.kop}</h2></div>
    <p>${k.tekst}</p>
    <details><summary>Zo los je het op (5 minuten)</summary><ol>
      <li>Ga naar <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">developers.facebook.com</a> → <b>My Apps</b> → <b>haagse-dashboard</b> → <b>Use cases</b> → <b>Customize</b> → <b>API setup with Instagram login</b>.</li>
      <li>Klap <b>2. Generate access tokens</b> open en klik bij the_hague_beachlife op <b>Generate token</b> (niet op het prullenbakje).</li>
      <li>Zet alleen <b>Profiel</b> en <b>Statistieken</b> aan, klik <b>Toestaan</b> en kopieer de sleutel.</li>
      <li>Supabase → <b>Integrations</b> → <b>Vault</b> → <code>instagram_access_token</code> → <b>Edit</b> → plakken → <b>Save</b>.</li>
      <li>Tik bovenaan op <b>Ververse</b>. Is het gelukt, dan verdwijnt deze melding vanzelf (lukte het ophalen net nog nie, dan kan het tot 5 minuten duren voordat hij het opnieuw probeert).</li>
    </ol>${k.detail?`<p class="sub">Melding van Meta: ${esc(k.detail)}</p>`:""}</details>
  </div>`+fb;
}

/* ---------- hulpjes ---------- */
const DAGEN_KORT=["ma","di","wo","do","vr","za","zo"];
const DAGEN_LANG=["maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","zondag"];
function vandaagLA(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles"}).format(new Date())}
function dagMin(d,n){const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()-n);return x.toISOString().slice(0,10)}
const med=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
const plus=v=>(v>0?"+":v<0?"−":"")+nf0.format(Math.abs(v));
function soortNaam(p){return p.product==="REELS"||p.soort==="VIDEO"?"Reel":p.soort==="CAROUSEL_ALBUM"?"Carrousel":p.soort==="IMAGE"?"Foto":p.soort||"?"}
function dagdeel(u){return u<6?"Nacht (0–6)":u<12?"Ochtend (6–12)":u<17?"Middag (12–17)":u<21?"Avond (17–21)":"Laat (21–24)"}
const DAGDELEN=["Ochtend (6–12)","Middag (12–17)","Avond (17–21)","Laat (21–24)","Nacht (0–6)"];
function labelsVan(p,soort){return (p.labels||[]).filter(l=>l.soort===soort).map(l=>l.label)}
function zeker(n){return n>=10?'<span class="chip good">betrouwbaar</span>':n>=5?'<span class="chip warn">voorzichtig</span>':'<span class="chip mute">te weinig</span>'}

// account-cijfers opgeteld over een reeks Meta-dagen
function igSom(van,tot){   // van t/m tot (JJJJ-MM-DD)
  const s={dagen:0,nk:{}};   // nk = per cijfer: op hoeveel dagen het er echt is (Meta geeft nie altijd alles)
  IG.dag.forEach(r=>{if(r.dag<van||r.dag>tot)return;s.dagen++;
    for(const [k,v] of Object.entries(r.c))if(typeof v==="number"){s[k]=(s[k]||0)+v;s.nk[k]=(s.nk[k]||0)+1}});
  return s;
}

// nieuwe volgers per 1.000 bereikte niet-volgers over een reeks Meta-dagen (alleen dagen mét opsplitsing volgers/nieuw)
function igPer1kNieuw(van,tot,minDagen){
  const r=IG.dag.filter(x=>x.dag>=van&&x.dag<=tot&&x.c.reach_nieuw!=null&&x.c.follows!=null);   // alleen dagen mét opsplitsing én volgâhs-cijfer
  const n=r.reduce((a,x)=>a+x.c.reach_nieuw,0);
  return r.length>=(minDagen||3)&&n?r.reduce((a,x)=>a+(x.c.follows||0),0)*1000/n:null;   // minstens 3 dagen (vorige week: 5), anders zegt het te weinig
}
// deel van je bereik dat je (nog) nie volgt, over een reeks Meta-dagen (alleen dagen mét opsplitsing).
// Opgeteld over de dagen, dus drukke dagen tellen zwaarder (= deel van al je bereik die week).
function igNieuwPct(van,tot,minDagen){
  const r=IG.dag.filter(x=>x.dag>=van&&x.dag<=tot&&x.c.reach_nieuw!=null);
  const n=r.reduce((a,x)=>a+x.c.reach_nieuw,0),v=r.reduce((a,x)=>a+(x.c.reach_volgers||0),0);
  return r.length>=(minDagen||1)&&n+v?n/(n+v):null;
}
// vergelijking met vorige week voor een percentage: verschil in procentpunten, pijltje vanaf 3 punten
function igVsPct(a,b){if(a==null||b==null)return "";const d=Math.round((a-b)*100);
  return ` · vorige week ${pct(b)}${d>=3?` <span class="up">↑ ${d} punten</span>`:d<=-3?` <span class="down">↓ ${-d} punten</span>`:""}`}
/* ---------- likes per kijkâh (likes ÷ bereik), per post ----------
   Alleen je eigen posts: posts waar een ander de maker is en jij bijdrager, komen niet binnen (me/media = alleen eigen posts).
   Per bereik (verschillende mensen), nie per weergave: weergaven tellen herhalingen mee (reels die doorlopen, carrousels),
   dan zakt het percentage alleen al door de soort post. Posts pas vanaf 2 dagen oud (daarvoor loopt het nog).
   Vergelijken per 10 posts i.p.v. per week: je post ± 2x per week, dan is een week te weinig om iets te zeggen. */
const IG_LIKE_DAGEN=2, IG_LIKE_N=10;
const igPct1=v=>igNf1.format(v*100)+"%";
function igLikes(){
  const grens=Date.now()-IG_LIKE_DAGEN*864e5;
  const ps=IG.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)<=grens&&+p.bereik>0&&p.likes!=null)
    .map(p=>({...p,likePct:(+p.likes)/(+p.bereik)})).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));   // nieuwste eerst
  const nu=ps.slice(0,IG_LIKE_N),voor=ps.slice(IG_LIKE_N,2*IG_LIKE_N);
  return {ps,n:nu.length,nu:nu.length>=3?med(nu.map(p=>p.likePct)):null,
    voor:voor.length>=IG_LIKE_N?med(voor.map(p=>p.likePct)):null};   // vorige 10 alleen als het er echt 10 zijn
}
// vergelijking met de 10 posts daarvoor: verschil in procentpunten, pijltje vanaf een halve punt
function igVsLikes(a,b){if(a==null||b==null)return "";const d=(a-b)*100,t=igNf1.format(Math.abs(d))+(Math.abs(d)<1.05?" punt":" punten");
  return ` · 10 posts daarvoor ${igPct1(b)}${d>=0.5?` <span class="up">↑ ${t}</span>`:d<=-0.5?` <span class="down">↓ ${t}</span>`:""}`}
function igLikesUitleg(l){return l.nu==null?"komt zodra er 3 posts van minstens 2 dagen oud met cijfâhs zijn":
  `van wie je post zag, gaf een like · middelste van je laatste ${l.n} posts`+igVsLikes(l.nu,l.voor)}
/* ---------- kwaliteit per post: (gedeeld + bewaard) per 1.000 kijkâhs ----------
   Zelfde rekensom als "Kwaliteit" bij Wat werkt en Toppâhs, maar dan als trend: middelste van je laatste 10 posts vs de 10 daarvoor.
   Delen en bewaren wegen bij Insta zwaarder dan likes: delen brengt je post bij nieuwe mensen, bewaren = "wil ik terugzien".
   Posts pas vanaf 2 dagen oud (er wordt nog gedeeld) en met minstens 100 bereik (1x gedeeld bij 40 bereik = al 25, dat zegt niks).
   Pijltje pas vanaf 15% verschil: het zijn kleine getallen, dan zegt een klein verschil nog niks. */
const IG_KWAL_MIN_BEREIK=100, IG_KWAL_PIJL=0.15;
const igKwalF=v=>v<10?igNf1.format(v):nf0.format(v);
function igKwal(){
  const grens=Date.now()-IG_LIKE_DAGEN*864e5;
  const ps=IG.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)<=grens&&+p.bereik>=IG_KWAL_MIN_BEREIK&&(p.gedeeld!=null||p.bewaard!=null))
    .map(p=>({...p,kw:((+p.gedeeld||0)+(+p.bewaard||0))*1000/(+p.bereik)})).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));   // nieuwste eerst
  const nu=ps.slice(0,IG_LIKE_N),voor=ps.slice(IG_LIKE_N,2*IG_LIKE_N);
  return {ps,n:nu.length,nu:nu.length>=3?med(nu.map(p=>p.kw)):null,
    voor:voor.length>=IG_LIKE_N?med(voor.map(p=>p.kw)):null};
}
function igVsKwal(a,b){if(a==null||b==null)return "";
  if(!b)return ` · 10 posts daarvoor 0${a>0?' <span class="up">↑</span>':""}`;
  const d=a/b-1;
  return ` · 10 posts daarvoor ${igKwalF(b)}${d>=IG_KWAL_PIJL?' <span class="up">↑ '+pct(d)+"</span>":d<=-IG_KWAL_PIJL?' <span class="down">↓ '+pct(-d)+"</span>":""}`}
function igKwalUitleg(k){return k.nu==null?"komt zodra er 3 posts van minstens 2 dagen oud (en 100+ bereik) met cijfâhs zijn":
  `gedeeld + bewaard per 1.000 kijkâhs · middelste van je laatste ${k.n} posts`+igVsKwal(k.nu,k.voor)}

// de twee maten voor de grafiek per post (knop Likes / Kwaliteit op de Insta-tab)
let igPostMaat="likes";
const IG_MATEN={
  likes:{kop:"Likes per kijkâh",aria:"Likes per kijkâh per post",v:p=>p.likePct*100,as:t=>nf0.format(t)+"%",lbl:p=>igPct1(p.likePct),
    tip:p=>`${nf0.format(+p.likes)} likes ÷ ${nf0.format(+p.bereik)} bereik = ${igPct1(p.likePct)}`,
    sub:n=>`Je laatste ${n} posts van minstens 2 dagen oud. <b>Likes ÷ bereik</b>: welk deel van de mensen die de post zagen, gaf een like.`},
  kwal:{kop:"Kwaliteit per post",aria:"Kwaliteit per post: gedeeld + bewaard per 1.000 kijkâhs",v:p=>p.kw,as:t=>nf0.format(t),lbl:p=>igKwalF(p.kw),
    tip:p=>`${nf0.format(+p.gedeeld||0)} gedeeld + ${nf0.format(+p.bewaard||0)} bewaard per ${nf0.format(+p.bereik)} bereik = ${igKwalF(p.kw)} per 1.000`,
    sub:n=>`Je laatste ${n} posts van minstens 2 dagen oud en met 100+ bereik. <b>Gedeeld + bewaard per 1.000 kijkâhs</b>: hoeveel mensen je post zo goed vonden dat ze hem doorstuurden of bewaarden. Dit weegt bij Insta zwaarder dan likes.`}};
// grafiek: per post een staaf, met een trendlijn = middelste van de laatste 5 posts.
// Eén uitschietâh (virale post) zou de rest plat drukken: dan loopt de schaal tot 3x de middelste post en krijgt die staaf een pijltje ▲ (echte waarde in het getal).
function igPostGrafiek(el,posts,m){   // posts: oud → nieuw; m = IG_MATEN.likes of .kwal
  if(!posts.length){el.innerHTML='<p class="sub">Nog geen posts van minstens 2 dagen oud met cijfâhs.</p>';return}
  const W=Math.max(300,Math.round(el.clientWidth||1000)),ml=40,mr=6,mt=16,mb=26,iw=W-ml-mr,ih=(W<600?170:210)-mt-mb,H=mt+ih+mb;
  const vs=posts.map(m.v),mx=Math.max(...vs),md=med(vs)||0,kap=md>0&&mx>3*md?3*md:mx;
  const sch=schaal(kap,3),top=sch.top,bw=iw/posts.length;
  const y=v=>mt+ih-Math.min(v,top)/top*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${m.aria}">`;
  sch.lijnen.forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml-6}" y="${y(t)+4}" text-anchor="end">${m.as(t)}</text>`});
  const trend=[];
  posts.forEach((p,i)=>{const v=vs[i],x=ml+i*bw+bw*.15,h=Math.min(v,top)/top*ih;
    s+=`<path d="${roundTop(x,y(v),bw*.7,h,3)}" fill="var(--hy)" opacity=".8"/>`;
    if(v>top)s+=`<text x="${ml+i*bw+bw/2}" y="${mt-3}" text-anchor="middle" class="strookgetal">▲</text>`;
    const venster=vs.slice(Math.max(0,i-4),i+1);if(venster.length>=3)trend.push([ml+i*bw+bw/2,y(med(venster))]);
    const tip=`${dLabel(dagNL(p.gepost_om),1)} · ${soortNaam(p)}: ${m.tip(p)}`;
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${ih}"${staafGetal(ml+i*bw+bw/2,y(v),m.lbl(p))}><title>${esc(tip)}</title></rect>`;
    if((posts.length-1-i)%6===0){const xm=ml+i*bw+bw/2,rand=xm>W-mr-24;   // laatste datum nie over de rand laten lopen
      s+=`<text x="${rand?W-mr:xm}" y="${H-8}" text-anchor="${rand?"end":"middle"}">${dLabel(dagNL(p.gepost_om))}</text>`}});
  if(trend.length>1)s+=`<path d="M${trend.map(([a,b])=>a.toFixed(1)+","+b.toFixed(1)).join("L")}" fill="none" stroke="var(--good)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`;
  el.innerHTML=s+"</svg>";
}
function igCompute(){
  const vandaag=vandaagLA(),gist=dagMin(vandaag,1);
  const w=igSom(dagMin(vandaag,7),gist), vw=igSom(dagMin(vandaag,14),dagMin(vandaag,8)), nu=igSom(vandaag,vandaag);
  const vwOk=(vw.nk.reach||0)>=5;   // vorige week pas vergelijken als daar minstens 5 van de 7 dagen gemeten zijn (anders vergelijk je met 1 losse dag)
  const metSplit=IG.dag.filter(r=>r.dag>=dagMin(vandaag,7)&&r.dag<=gist&&r.c.reach_nieuw!=null);
  const nieuw=metSplit.reduce((a,r)=>a+r.c.reach_nieuw,0), volg=metSplit.reduce((a,r)=>a+(r.c.reach_volgers||0),0);
  const vNieuw=metSplit.reduce((a,r)=>a+(r.c.views_nieuw||0),0), vVolg=metSplit.reduce((a,r)=>a+(r.c.views_volgers||0),0);
  const posts7=IG.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>Date.now()-7*864e5);
  return {vandaag,w,vw,nu,
    bereikDag:w.nk.reach?w.reach/w.nk.reach:null, bereikDagV:vwOk?vw.reach/vw.nk.reach:null,   // gedeeld door de dagen mét bereik
    nieuwPct:nieuw+volg?nieuw/(nieuw+volg):null,
    nieuwPctV:igNieuwPct(dagMin(vandaag,14),dagMin(vandaag,8),5),   // week ervoor, pas als daar minstens 5 van de 7 dagen gemeten zijn
    viewsNieuwPct:vNieuw+vVolg?vNieuw/(vNieuw+vVolg):null,
    kwal:w.reach?((w.shares||0)+(w.saves||0))*1000/w.reach:null, kwalV:vwOk&&vw.reach?((vw.shares||0)+(vw.saves||0))*1000/vw.reach:null,
    follows:w.follows||0, unfollows:w.unfollows||0, posts7:posts7.length,
    nettoV:(vw.nk.follows||0)>=5?(vw.follows||0)-(vw.unfollows||0):null,   // netto volgâhs de week ervoor (ook pas bij 5 van de 7 dagen)
    // nieuwe volgers per 1.000 bereik (bereik = opgeteld per dag, net als bij 'Bereik per dag'; zelfde rekensom voor beide weken, dus eerlijk te vergelijken)
    volg1k:w.reach?(w.follows||0)*1000/w.reach:null, volg1kV:vwOk&&(vw.nk.follows||0)>=5&&vw.reach?(vw.follows||0)*1000/vw.reach:null,
    volg1kNieuw:nieuw?metSplit.reduce((a,r)=>a+(r.c.follows||0),0)*1000/nieuw:null,   // alleen niet-volgers kunnen volger worden
    volg1kNieuwV:igPer1kNieuw(dagMin(vandaag,14),dagMin(vandaag,8),5),   // zelfde voor de week ervoor (null als er toen nog geen opsplitsing was)
    laatstePost:IG.posts.find(p=>p.gepost_om)};
}

/* ---------- Sneek via Insta (GoatCounter-bronnen) ---------- */
function igBronGroep(b){const l=String(b).toLowerCase();
  if(/^(bio|story-|post-|reel-)/.test(l))return "link";
  if(/instagram|^ig$/.test(l))return "insta";
  if(/facebook|^fb$|fb\.me|messenger/.test(l))return "fb";
  return "rest"}
function igSneek(){
  const dagen=[];for(let i=29;i>=0;i--)dagen.push(dagUTC(Date.now()-i*864e5));
  const perDag=Object.fromEntries(dagen.map(d=>[d,{insta:0,link:0,fb:0}]));
  const tot={insta:0,link:0,fb:0,rest:0},links=new Map();
  (GC.bronnen||[]).forEach(r=>{const d=String(r.dag).slice(0,10);if(!(d in perDag))return;const g=igBronGroep(r.bron),n=+r.aantal||0;
    tot[g]+=n;if(g!=="rest")perDag[d][g]+=n;
    if(g==="link"){const k=String(r.bron).toLowerCase();const x=links.get(k)||{bron:k,n:0,eerst:d};x.n+=n;if(d<x.eerst)x.eerst=d;links.set(k,x)}});
  const alle=tot.insta+tot.link+tot.fb+tot.rest, meta=tot.insta+tot.link+tot.fb;
  const d7=dagen.slice(-7).reduce((a,d)=>a+perDag[d].insta+perDag[d].link+perDag[d].fb,0);
  return {dagen:dagen.map(d=>({d,parts:[{v:perDag[d].insta+perDag[d].link,c:"hy"},{v:perDag[d].fb,c:"lb"}]})),tot,alle,meta,d7,
    links:[...links.values()].sort((a,b)=>b.eerst.localeCompare(a.eerst)||b.n-a.n)};
}
// nieuwe eigen link: ?ref=story-2909 (tweede op dezelfde dag: -b, -c, ...)
function igNieuweLink(soort){
  if(soort==="bio")return "https://www.haagsesneek.nl/?ref=bio";
  const d=vandaagAms(),basis=soort+"-"+d.slice(8,10)+d.slice(5,7);
  const bekend=new Set((GC.bronnen||[]).map(r=>String(r.bron).toLowerCase()).concat(JSON.parse(store.get("hc_ig_links")||"[]")));
  let ref=basis,i=1;while(bekend.has(ref)){ref=basis+"-"+String.fromCharCode(97+i);i++}
  return "https://www.haagsesneek.nl/?ref="+ref;
}

/* ---------- Wat werkt ---------- */
function igWatWerkt(kies){
  const jaarGeleden=Date.now()-365*864e5;
  const posts=IG.posts.filter(p=>p.bereik!=null&&p.gepost_om&&Date.parse(p.gepost_om)>jaarGeleden);
  const alleMed=med(posts.map(p=>p.bereik));
  const groepen=new Map();const voeg=(g,p)=>{if(!groepen.has(g))groepen.set(g,[]);groepen.get(g).push(p)};
  let volgorde=null,nietGelabeld=0;
  posts.forEach(p=>{
    if(kies==="soort")voeg(soortNaam(p),p);
    else if(kies==="onderwerp"){const l=labelsVan(p,"onderwerp");if(l.length)l.forEach(x=>voeg(x,p));else voeg("(geen onderwerp)",p)}
    else if(kies==="dag")voeg(DAGEN_LANG[(p.weekdag||1)-1],p);
    else if(kies==="tijd")voeg(dagdeel(p.uur??12),p);
    else if(kies==="muziek"){const l=labelsVan(p,"muziek");if(!l.length){nietGelabeld++;return}
      voeg(l[0]==="(geen)"?"Zonder eigen muziek":"Met eigen muziek",p);if(l[0]!=="(geen)")voeg("♪ "+l[0],p)}
  });
  if(kies==="dag")volgorde=DAGEN_LANG;if(kies==="tijd")volgorde=DAGDELEN;
  let rijen=[...groepen].map(([naam,ps])=>({naam,n:ps.length,med:med(ps.map(p=>p.bereik)),
    kw:med(ps.filter(p=>p.kwaliteit!=null).map(p=>+p.kwaliteit)),
    nv:ps.reduce((a,p)=>a+(p.nieuwe_volgers||0),0)}));
  rijen.forEach(r=>r.idx=alleMed?r.med/alleMed:null);
  if(volgorde)rijen.sort((a,b)=>volgorde.indexOf(a.naam)-volgorde.indexOf(b.naam));
  else rijen.sort((a,b)=>(b.n>=5)-(a.n>=5)||b.med-a.med);
  return {rijen,n:posts.length,alleMed,nietGelabeld,alleKw:med(posts.filter(p=>p.kwaliteit!=null).map(p=>+p.kwaliteit))};
}

/* ---------- Muziek: plays van dat nummer na de post ---------- */
// Sleutel om dezelfde titel uit verschillende bronnen samen te voegen:
// hoofdletters, spaties, accenten, leestekens en "(Original Mix)" tellen niet mee; versies (Chilled/Spiced, Remix) wel.
function igTitelKey(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[([]?\s*(original|extended|radio|club) (mix|edit|version)\s*[)\]]?/g," ").replace(/[^a-z0-9]+/g,"")}
// YouTube-titel opschonen: "Marreman Rojas - Nummer (Official Video)" → "Nummer"
function igYtTitel(t){return String(t||"").replace(/^\s*(marreman( rojas)?|beuk)\s*[-–—:|]\s*/i,"")
  .replace(/\s*[([][^)\]]*(official|video|audio|visuali[sz]er|lyric|clip)[^)\]]*[)\]]/gi,"").replace(/\s*\|.*$/,"").trim()}
// Alle nummers uit alle muziekdata. Bij dubbele titels wint de eerste bron in deze volgorde
// (al gebruikte labels eerst, zodat bestaande keuzes precies blijven kloppen).
function igTrackBronnen(){
  const lijst=[];const zet=(titel,bron)=>{titel=String(titel||"").trim();if(titel)lijst.push({titel,bron})};
  (IG.posts||[]).forEach(p=>labelsVan(p,"muziek").forEach(l=>{if(l!=="(geen)"&&l!=="(eigen muziek)")zet(l,"label")}));
  (SCL.tracks||[]).forEach(x=>zet(x.title,"SoundCloud"));
  (SP.snaps||[]).forEach(x=>zet(x.song,"Spotify"));
  (LABEL.tracks||[]).forEach(x=>zet(x.t+(/^((original|extended|radio|club)\s*)?(mix|edit|version)?$/i.test(String(x.v||"").trim())?"":" ("+String(x.v).trim()+")"),"DJ·World"));
  (SC||[]).forEach(r=>zet(r.track,"SoundCloud-rapport"));
  const own=YT.own||[];(YT.videos||[]).forEach(v=>{if(!own.length||own.includes(v.channel_id))zet(igYtTitel(v.title),"YouTube")});
  const per=new Map();
  lijst.forEach(({titel,bron})=>{const k=igTitelKey(titel);if(!k)return;
    let o=per.get(k);if(!o){o={titel,bronnen:new Set()};per.set(k,o)}if(bron!=="label")o.bronnen.add(bron)});
  return per;
}
function igTrackTitels(){
  return [...igTrackBronnen().values()].map(o=>o.titel).sort((a,b)=>a.localeCompare(b,"nl"));
}
// Effect van een post op de plays/weergaven van dat nummer.
// "Normaal" = gemiddeld per dag in de (max.) 14 dagen vóór de post. Daarna vensters van 7, 14 en 30 dagen vanaf de postdag.
// Het venster groeit vanzelf mee: elke nacht komt er een meting bij. Metingen per dag bestaan pas sinds eind sep 2026.
const IG_VENSTERS=[7,14,30];
function igReeks(snaps,ids,veld){   // stand op dag d = som van de laatste meting ≤ d per id (null als een id nog geen meting had)
  const per=new Map();snaps.forEach(x=>{if(!ids.has(x.video_id??x.track_id))return;const id=x.video_id??x.track_id;if(!per.has(id))per.set(id,[]);per.get(id).push(x)});
  per.forEach(r=>r.sort((a,b)=>a.snap_date<b.snap_date?-1:1));
  const eerste=[...per.values()].reduce((m,r)=>!m||r[0].snap_date>m?r[0].snap_date:m,null);   // vanaf hier hebben alle ids een meting
  return {eerste,op:d=>{if(!per.size||!eerste||d<eerste)return null;let t=0;
    for(const r of per.values()){let v=null;for(const x of r){if(x.snap_date<=d)v=+x[veld];else break}if(v==null)return null;t+=v}return t}};
}
function igEffectBron(reeks,postDag){
  const vandaag=vandaagAms(),dag0=dagMin(postDag,1),v0=reeks.op(dag0);
  if(v0==null)return null;
  // normaal: tot 14 dagen terug, zo ver als er metingen zijn (minstens 3 dagen)
  let voorDagen=Math.min(14,Math.round((Date.parse(dag0)-Date.parse(reeks.eerste))/864e5)),voorPerDag=null;
  if(voorDagen>=3){const vB=reeks.op(dagMin(dag0,voorDagen));if(vB!=null)voorPerDag=(v0-vB)/voorDagen}else voorDagen=0;
  const vensters=[];
  for(const w of IG_VENSTERS){const eind=dagMin(postDag,-(w-1));
    if(eind<=vandaag){const v=reeks.op(eind);if(v==null)break;const na=v-v0;
      vensters.push({dagen:w,na,perDag:na/w,x:voorPerDag>0?(na/w)/voorPerDag:null,klaar:true})}
    else{const gedaan=Math.round((Date.parse(vandaag)-Date.parse(postDag))/864e5)+1,v=reeks.op(vandaag);
      if(v!=null&&gedaan>=1)vensters.push({dagen:w,na:v-v0,perDag:(v-v0)/gedaan,x:voorPerDag>0?((v-v0)/gedaan)/voorPerDag:null,klaar:false,gedaan});
      break}}
  return vensters.length?{voorPerDag,voorDagen,vensters}:null;
}
function igPlaysEffect(titel,postDag){
  const t=titel.trim().toLowerCase(),uit={bronnen:[]};
  const tk=igTitelKey(titel),tr=(SCL.tracks||[]).filter(x=>x.title&&igTitelKey(x.title)===tk);
  if(tr.length){const e=igEffectBron(igReeks(SCL.snaps||[],new Set(tr.map(x=>x.track_id)),"plays"),postDag);
    if(e)uit.bronnen.push({bron:"SoundCloud",eenheid:"plays",url:tr[0].permalink_url,...e})}
  const yv=t.length>=4?(YT.videos||[]).filter(v=>v.title&&v.title.toLowerCase().includes(t)):[];
  if(yv.length){const e=igEffectBron(igReeks(YT.snaps||[],new Set(yv.map(v=>v.video_id)),"views"),postDag);
    if(e)uit.bronnen.push({bron:"YouTube",eenheid:"weergaven",...e})}
  if(!uit.bronnen.length)return null;
  // voor de kansen-kaart: SoundCloud (of YouTube) na 7 dagen
  const h=uit.bronnen[0],w7=h.vensters.find(v=>v.dagen===7&&v.klaar);
  uit.x7=w7?w7.x:null;uit.na7=w7?w7.na:null;uit.voorPerDag=h.voorPerDag;
  return uit;
}
const nf1i=new Intl.NumberFormat("nl-NL",{maximumFractionDigits:1});
function igEffectHTML(eff){
  return eff.bronnen.map(b=>{
    const norm=b.voorPerDag!=null?`normaal ${nf1i.format(b.voorPerDag)} ${b.eenheid} per dag (${b.voorDagen} dagen ervoor)`:"nog geen meting van vóór de post, dus geen vergelijking";
    const delen=b.vensters.map(v=>{const x=v.x!=null&&(v.klaar||v.gedaan>=3)?` <b class="${v.x>=1.2?"up":v.x<=0.8?"down":""}">×${nf1i.format(v.x)}</b>`:"";
      return v.klaar?`${v.dagen} d ${plus(v.na)}${x}`:`${v.dagen} d loopt (dag ${v.gedaan}): ${plus(v.na)}${x}`});
    return `<span class="igeff" title="×2 = twee keer zoveel ${b.eenheid} per dag als normaal · ${norm}">♪ ${b.bron}: ${delen.join(" · ")}<span class="ignorm"> · ${b.voorPerDag!=null?"normaal "+nf1i.format(b.voorPerDag)+"/dag":"nog geen 'normaal'"}</span></span>`}).join("");
}

/* ---------- tekenen ---------- */
function igKolommen(el,data,aria,onder){   // gestapelde kolommen: data=[{d,parts:[{v,c}],o}]; onder={naam,c} = strook eronder met één getal per dag (bijv. nieuwe volgers)
  const W=Math.max(300,Math.round(el.clientWidth||1000)),ml=40,mr=6,mt=10,mb=26,iw=W-ml-mr,ih=(W<600?180:220)-mt-mb;
  const og=onder?24:0,oh=onder?(W<600?40:52):0,H=mt+ih+og+oh+mb;   // og = ruimte voor het kopje van de strook, oh = hoogte strook
  const sch=schaal(Math.max(...data.map(d=>d.parts.reduce((a,p)=>a+p.v,0))),3),top=sch.top,bw=iw/data.length;
  const y=v=>mt+ih-v/top*ih;
  const oTop=onder?Math.max(1,...data.map(d=>d.o||0)):1,ob=mt+ih+og+oh,met=bw>=20,oa=oh-(met?13:0);   // ob = onderkant strook, oa = hoogte hoogste staaf (met = ruimte voor getallen)
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`;
  sch.lijnen.forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml-6}" y="${y(t)+4}" text-anchor="end">${nf0.format(t)}</text>`});
  if(onder)s+=`<text x="${ml}" y="${mt+ih+og-6}" text-anchor="start" class="strook">${onder.naam}</text><line class="base" x1="${ml}" x2="${W-mr}" y1="${ob}" y2="${ob}"/>${met?"":`<text x="${ml-6}" y="${ob-oa+4}" text-anchor="end">${nf0.format(oTop)}</text>`}`;
  data.forEach((d,i)=>{let acc=0;const x=ml+i*bw+bw*.15;
    const vis=d.parts.filter(p=>p.v>0);
    vis.forEach((p,j)=>{const h=p.v/top*ih;const yt=y(acc+p.v);
      s+=j===vis.length-1?`<path d="${roundTop(x,yt,bw*.7,h,3)}" fill="var(--${p.c})"/>`:`<rect x="${x}" y="${yt}" width="${bw*.7}" height="${h}" fill="var(--${p.c})"/>`;acc+=p.v});
    let getal=nf0.format(acc);
    if(onder&&d.o!=null){getal+=` · +${nf0.format(d.o)}`;
      if(d.o>0){const h=d.o/oTop*oa;s+=`<path d="${roundTop(x,ob-h,bw*.7,h,2)}" fill="var(--${onder.c})"/>`;
        if(met)s+=`<text x="${ml+i*bw+bw/2}" y="${ob-h-3}" text-anchor="middle" class="strookgetal">${nf0.format(d.o)}</text>`}}
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${ob-mt}"${staafGetal(ml+i*bw+bw/2,y(acc),getal)}><title>${d.tip}</title></rect>`;
    if((data.length-1-i)%7===0)s+=`<text x="${ml+i*bw+bw/2}" y="${H-8}" text-anchor="middle">${dLabel(d.d)}</text>`});
  el.innerHTML=s+"</svg>";
}
/* ---------- Posts: tegel (aantal + trend) en losse grafiek "Posts per dag" (laatste 30 dagen) ----------
   Trend = aantal laatste 7 dagen vs de 7 dagen daarvoor, in aantallen (bij 2 of 3 posts zegt een % niks); pijltje vanaf 1 verschil.
   Alleen je eigen posts en reels (geen stories: die staan in hun eigen kaart). Dagen = Haagse dagen. */
const IG_SOORT_KLEUR={Carrousel:"hy",Reel:"sc",Foto:"lb"};
const IG_SOORT_MEERV={Carrousel:"carrousels",Reel:"reels",Foto:"foto's"};
const igSoortTxt=(n,sn)=>`${n} ${n===1?sn.toLowerCase():IG_SOORT_MEERV[sn]||sn.toLowerCase()}`;
function igPostsPerDag(){   // laatste 30 Haagse dagen: per dag per soort + totaal per soort
  const vandaag=vandaagAms(),dagen=[];for(let i=29;i>=0;i--)dagen.push(dagMin(vandaag,i));
  const per=new Map(dagen.map(x=>[x,{}])),soorten={};
  IG.posts.forEach(p=>{if(!p.gepost_om)return;const x=per.get(dagNL(p.gepost_om));if(!x)return;const sn=soortNaam(p);x[sn]=(x[sn]||0)+1;soorten[sn]=(soorten[sn]||0)+1});
  const volg=["Carrousel","Reel","Foto"].filter(sn=>soorten[sn]).concat(Object.keys(soorten).filter(sn=>!IG_SOORT_KLEUR[sn]));
  return {dagen,per,soorten,volg};
}
function igPostsStat(c){   // alleen aantal + trend (details staan in de grafiek Posts per dag)
  const nu=Date.now(),ps=IG.posts.filter(p=>p.gepost_om);
  const tel=(van,tot)=>ps.filter(p=>{const t=Date.parse(p.gepost_om);return t>nu-van*864e5&&t<=nu-tot*864e5}).length;
  const w=tel(7,0),vw=tel(14,7),d=w-vw;
  const vs=` · vorige week ${nf0.format(vw)}${d>=1?` <span class="up">↑ ${nf0.format(d)} meer</span>`:d<=-1?` <span class="down">↓ ${nf0.format(-d)} minder</span>`:""}`;
  return igStat("Posts",nf0.format(w),`laatste 7 dagen${vs}`);
}
// losse grafiek, net als Bereik per dag: één staaf per dag, gestapeld per soort
function renderIgPostsPerDag(){
  if(!$("igPostChart"))return;
  const {dagen,per,soorten,volg}=igPostsPerDag(),tot=Object.values(soorten).reduce((a,b)=>a+b,0);
  $("igPostSub").innerHTML=`Laatste 30 dagen: <b>${nf0.format(tot)} post${tot===1?"":"s"}</b>`+(tot?" ("+volg.map(sn=>igSoortTxt(soorten[sn],sn)).join(", ")+")":"")+". Per dag hoeveel je postte, per soort. Stories tellen hier nie mee.";
  igKolommen($("igPostChart"),dagen.map(x=>{const v=per.get(x),n=Object.values(v).reduce((a,b)=>a+b,0);
    return {d:x,parts:volg.map(sn=>({v:v[sn]||0,c:IG_SOORT_KLEUR[sn]||"muted"})),
      tip:`${igWd(x)} ${dLabel(x,1)}: `+(n?volg.filter(sn=>v[sn]).map(sn=>igSoortTxt(v[sn],sn)).join(" + "):"geen post")}}),"Posts per dag, laatste 30 dagen");
}
function igStat(k,v,s){return `<div class="ytstat"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`}
function igVs(a,b,pctMode){if(a==null||b==null||!b)return "";const d=a/b-1;
  return ` · vorige week ${pctMode?nf0.format(b):nf0.format(b)}${d>0.05?' <span class="up">↑ '+pct(d)+"</span>":d<-0.05?' <span class="down">↓ '+pct(-d)+"</span>":""}`}

const igNf1=new Intl.NumberFormat("nl-NL",{minimumFractionDigits:1,maximumFractionDigits:1});
function igVs1(a,b){if(a==null||b==null)return "";
  if(!b)return ` · vorige week ${igNf1.format(0)}${a>0?' <span class="up">↑</span>':""}`;   // vorige week 0: elke stijging telt, maar een % zegt dan niks
  const d=a/b-1;   // als igVs, maar met 1 cijfer achter de komma
  return ` · vorige week ${igNf1.format(b)}${d>0.05?' <span class="up">↑ '+pct(d)+"</span>":d<-0.05?' <span class="down">↓ '+pct(-d)+"</span>":""}`}
// netto volgâhs t.o.v. de week ervoor: verschil in aantallen (een % van een klein of negatief getal zegt niks), pijltje vanaf 2
function igVsNetto(a,b){if(a==null||b==null)return "";const d=a-b;
  return ` · vorige week ${plus(b)}${d>=2?` <span class="up">↑ ${nf0.format(d)} meer</span>`:d<=-2?` <span class="down">↓ ${nf0.format(-d)} minder</span>`:""}`}
// bereik van één dag t.o.v. dezelfde weekdag een week eerder (zaterdag vs zaterdag: weekdagen verschillen flink)
const IG_WD=["zo","ma","di","wo","do","vr","za"];
function igWd(d){return IG_WD[new Date(d+"T12:00:00Z").getUTCDay()]}
function igPijl(a,b){if(a==null||!b)return "";const d=a/b-1;   // alleen het pijltje (vanaf 5% verschil), zoals in igVs
  return d>0.05?' <span class="up">↑ '+pct(d)+"</span>":d<-0.05?' <span class="down">↓ '+pct(-d)+"</span>":""}

function renderInsta(){
  if(!$("igStats"))return;
  $("igAlarm").innerHTML=igAlarmHTML();igBadge();   // waarschuwing als de koppeling met Meta stuk is
  const leeg=IG.err||!IG.acc;
  $("igBlok").hidden=!!leeg;$("igNog").hidden=!leeg;
  if(leeg){$("igNogTekst").innerHTML=IG.err?(/ig_post_stats|relation|schema cache/i.test(IG.err)
      ?"De Insta-tabellen zijn nog niet compleet. Draai <code>supabase/09_insta.sql</code> en <code>09b_insta_extra.sql</code>."
      :"Insta-cijfâhs ophale lukte nie: "+esc(IG.err)):"Nog geen metingen. Wacht tot vannacht of draai <code>select public.ig_refresh(7, 20);</code> in Supabase.";return}
  const c=igCompute();

  // 1. tegels
  $("igSub").innerHTML=`@${esc(IG.acc.gebruikersnaam||"the_hague_beachlife")} · elke nacht vanzelf bijgewerkt, en als je het dashboard opent (hooguit 1x per 10 min) of bovenaan op Ververse tikt (hooguit 1x per 5 min). Dagen zijn Meta-dagen (Amerikaanse tijd).`;
  if($("igStatus"))$("igStatus").innerHTML=igStatusHTML();
  $("igStats").innerHTML=[
    igStat("Volgâhs",nf0.format(IG.acc.volgers||0),igNieuwWeg(c)),
    ...igVasteRijen(c).map(([k,v,u,extra])=>igStat(k,v,u+(extra||""))),
    // alleen op de Insta-tab
    igStat("Volgâhs per 1.000 bereik",c.volg1k==null?"—":igNf1.format(c.volg1k),"nieuwe volgâhs, laatste 7 dagen"+igVs1(c.volg1k,c.volg1kV)),
    igPostsStat(c)
  ].join("");

  // 2. bereik per dag, volgers vs nieuw
  const dagen=[];for(let i=30;i>=1;i--)dagen.push(dagMin(c.vandaag,i-1));
  const per=new Map(IG.dag.map(r=>[r.dag,r.c]));
  igKolommen($("igChart"),dagen.map(d=>{const x=per.get(d)||{};const split=x.reach_nieuw!=null;
    const parts=split?[{v:x.reach_volgers||0,c:"groen"},{v:x.reach_nieuw||0,c:"hy"}]:[{v:x.reach||0,c:"muted"}];
    return {d,parts,o:x.follows!=null?x.follows:null,tip:`${dLabel(d,1)}${d===c.vandaag?" (tot nu)":""}: bereik ${nf0.format(x.reach||0)}`+(split?` · volgers ${nf0.format(x.reach_volgers)} · nieuw ${nf0.format(x.reach_nieuw)}`:"")+(x.follows!=null?` · +${x.follows} / −${x.unfollows||0} volgâhs`+(x.reach?` (${igNf1.format(x.follows*1000/x.reach)} per 1.000 bereik)`:""):"")}}),"Bereik per dag",{naam:"Nieuwe volgâhs per dag",c:"good"});

  // 2b. likes per kijkâh of kwaliteit per post (laatste 30 posts)
  renderIgPostGrafiek();
  renderIgPostsPerDag();   // 2c. posts per dag (laatste 30 dagen)

  // 3. wat werkt
  document.querySelectorAll("#igKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igKies));
  const ww=igWatWerkt(igKies);
  const maxIdx=Math.max(1,...ww.rijen.map(r=>r.idx||0));
  $("igWwSub").innerHTML=`${nf0.format(ww.n)} posts van het laatste jaar met cijfâhs. <b>Bereik</b> = mediaan (de middelste post, dus één uitschietâh telt niet te zwaar). <b>vs normaal</b> = t.o.v. je middelste post (${ww.alleMed==null?"—":nf0.format(ww.alleMed)}). <b>Kwaliteit</b> = gedeeld + bewaard per 1.000 bereik (normaal ${ww.alleKw==null?"—":nf0.format(ww.alleKw)}).`
    +(igKies==="muziek"?` Nog ${nf0.format(ww.nietGelabeld)} posts zonder muziek-label: label ze hieronder.`:"")
    +(igKies==="onderwerp"?" Onderwerpen komen uit je hashtags; een post kan in meer groepen zitten.":"");
  $("igWw").innerHTML=ww.rijen.length?`<thead><tr><th>Groep</th><th class="n">Posts</th><th class="n">Bereik</th><th>vs normaal</th><th class="n">Kwaliteit</th><th class="n">Volgâhs erbè</th><th>Zekerheid</th></tr></thead><tbody>`+
    ww.rijen.map(r=>{const idx=r.idx==null?"—":(r.idx>=1?"+":"−")+nf0.format(Math.abs(r.idx-1)*100)+"%";
      return `<tr><td>${esc(r.naam)}</td><td class="n">${nf0.format(r.n)}</td><td class="n">${r.med==null?"—":nf0.format(r.med)}</td>
      <td><span class="igidx"><span class="igidxbar"><i style="width:${Math.min(100,(r.idx||0)/maxIdx*100)}%;background:var(--${(r.idx||0)>=1?"groen":"muted"})"></i></span>${idx}</span></td>
      <td class="n">${r.kw==null?"—":nf0.format(r.kw)}</td><td class="n">${nf0.format(r.nv)}</td><td>${zeker(r.n)}</td></tr>`}).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${igKies==="muziek"?"Nog geen posts met een muziek-label. Kies hieronder per post welk nummâh eronder zat.":"Nog geen posts met cijfâhs."}</td></tr></tbody>`;

  // 4. toppâhs (laatste 90 dagen of allâh tijde)
  renderIgTop();
  if(typeof renderIgSamen==="function")renderIgSamen();   // 5. samenwerkingen (samenwerking.js)

  renderIgStories();
  renderIgSneek();
  renderIgMuziek();
}

/* ---------- grafiek per post: likes per kijkâh of kwaliteit (knop) ---------- */
function renderIgPostGrafiek(){
  if(!$("igLikeChart"))return;
  const m=IG_MATEN[igPostMaat],l=igPostMaat==="kwal"?igKwal():igLikes(),laatste=l.ps.slice(0,30).reverse();
  document.querySelectorAll("#igPostMaat button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igPostMaat));
  $("igLikeKop").textContent=m.kop;
  $("igLikeSub").innerHTML=m.sub(laatste.length)+" De groene lijn is de middelste van steeds 5 posts, zo zie je de trend zonder dat één uitschietâh alles bepaalt. Alleen je eigen posts: waar je bijdrager bent telt nie mee.";
  igPostGrafiek($("igLikeChart"),laatste,m);
}

/* ---------- toppâhs: top 10 op bereik, laatste 90 dagen of allâh tijde ---------- */
// waarop je de toppâhs kunt sorteren (knoppen #igTopOp én klikbare kolomkoppen)
const IG_TOP_OP={
  bereik:{kop:"Bereik",v:p=>p.bereik,txt:"op bereik (hoeveel verschillende mensen hem zagen)",f:nf0},
  kwaliteit:{kop:"Kwaliteit",v:p=>p.kwaliteit!=null?+p.kwaliteit:+p.bereik>0&&(p.gedeeld!=null||p.bewaard!=null)?((+p.gedeeld||0)+(+p.bewaard||0))*1000/(+p.bereik):null,txt:"op kwaliteit (gedeeld + bewaard per 1.000 bereik)",f:igNf1},
  volgers:{kop:"Volgâhs erbè",v:p=>p.nieuwe_volgers,txt:"op nieuwe volgâhs door de post",f:nf0},
  profiel:{kop:"Profielbezoek",v:p=>p.profielbezoeken,txt:"op profielbezoeken door de post",f:nf0},
  likes:{kop:"Likes",v:p=>p.likes,txt:"op likes",f:nf0},
  weergaven:{kop:"Weergaven",v:p=>p.weergaven,txt:"op weergaven (ook herhaald kijken telt mee)",f:nf0}};
function renderIgTop(){
  if(!$("igTop"))return;
  if(!IG_TOP_OP[igTopOp])igTopOp="bereik";
  const alles=igTopPeriode==="alles",op=IG_TOP_OP[igTopOp],opKw=igTopOp==="kwaliteit";
  const metCijfers=IG.posts.filter(p=>p.bereik!=null);
  const periode=alles?metCijfers:metCijfers.filter(p=>Date.parse(p.gepost_om)>Date.now()-90*864e5);
  // op kwaliteit: posts met heel weinig bereik tellen niet mee (1x bewaard bij 40 bereik = al 25, dat zegt niks)
  const drempel=opKw?Math.max(100,Math.round((med(periode.map(p=>p.bereik))||0)/2)):0;
  const bruikbaar=periode.filter(p=>op.v(p)!=null&&p.bereik>=drempel);
  const zonderCijfer=periode.filter(p=>op.v(p)==null).length;   // bijv. reels: daar geeft Meta geen volgâhs/profielbezoek per post
  const lijst=bruikbaar.sort((a,b)=>(+op.v(b))-(+op.v(a))||b.bereik-a.bereik||(a.gepost_om<b.gepost_om?-1:1)).slice(0,10);   // gelijk: meeste bereik, dan oudste eerst
  document.querySelectorAll("#igTopKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igTopPeriode));
  document.querySelectorAll("#igTopOp button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igTopOp));
  if($("igTopSub")){
    const oudste=metCijfers.reduce((m,p)=>!m||p.gepost_om<m?p.gepost_om:m,null);
    const zonder=IG.posts.length-metCijfers.length;
    const optxt=op.txt+(opKw?`. Alleen posts met minstens ${nf0.format(drempel)} bereik tellen mee, anders kan een post die bijna niemand zag bovenaan komen`:"")
      +(zonderCijfer?`. ${nf0.format(zonderCijfer)} post${zonderCijfer===1?"":"s"} zonder dit cijfâh (Meta geeft het nie voor elke soort, bijv. reels) tellen hier nie mee`:"");
    $("igTopSub").innerHTML=alles
      ?`Je 10 beste posts ooit, ${optxt}. Gekeken naâh ${nf0.format(metCijfers.length)} posts met cijfâhs${oudste?`, de oudste van ${dLabel(dagNL(oudste),1)}`:""}.`
        +(zonder?(zonder===1?" 1 post heb (nog) geen cijfâhs en telt nie mee.":` ${nf0.format(zonder)} posts hebbe (nog) geen cijfâhs en telle nie mee.`):"")
        +" Het archief vult zich elke nacht verder aan, dus oude toppâhs kunne d'r nog bij komme."
      :`Beste posts van de laatste 90 dagen, ${optxt}. Klik op een post om hem te openen, of op een kolomkop om daarop te sorteren.`;
  }
  const kop=k=>`<th class="n${igTopOp===k?" gesorteerd":""}"><button type="button" class="igtopkop" data-igtop="${k}">${IG_TOP_OP[k].kop}${igTopOp===k?" ↓":""}</button></th>`;
  const cel=(p,k)=>{const v=IG_TOP_OP[k].v(p);return `<td class="n${igTopOp===k?" gesorteerd":""}">${v==null?"—":IG_TOP_OP[k].f.format(v)}</td>`};
  const kols=Object.keys(IG_TOP_OP);
  $("igTop").innerHTML=lijst.length?`<thead><tr><th class="n">#</th><th>Post</th>${kols.map(kop).join("")}</tr></thead><tbody>`+
    lijst.map((p,i)=>`<tr><td class="n">${i+1}</td><td><div class="igtoprij"><a class="igthumb klein" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</a><div style="min-width:0"><a href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${dLabel(dagNL(p.gepost_om),alles)} · ${soortNaam(p)}</a> <span class="igcap">${esc((p.bijschrift||"").replace(/^Oh oh #thehague,?\s*/i,"").slice(0,70))}</span></div></div></td>
      ${kols.map(k=>cel(p,k)).join("")}</tr>`).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${periode.length?`Nog geen posts met een cijfâh voor ${op.kop.toLowerCase()}${alles?"":" in de laatste 90 dagen"}.`:alles?"Nog geen posts met cijfâhs.":"Nog geen posts met cijfâhs in de laatste 90 dagen."}</td></tr></tbody>`;
}

function renderIgStories(){
  document.querySelectorAll("#igStoryKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igStoryPeriode));
  document.querySelectorAll("#igStoryWie button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igStoryWie));
  const dagen=igStoryPeriode==="alles"?null:+igStoryPeriode;
  const inPeriode=IG.stories.filter(s=>!dagen||Date.parse(s.gepost_om)>Date.now()-dagen*864e5);
  const st=igStoryWie==="alles"?inPeriode:inPeriode.filter(s=>igStoryHerkomst(s)!=="ander");   // eigen = zelf gemaakt, eigen post gedeeld of onbekend (van vóór 1 okt)
  const gedeeld=inPeriode.length-st.length;
  const eerste=IG.stories.reduce((m,s)=>!m||s.gepost_om<m?s.gepost_om:m,null);
  if($("igStorySub"))$("igStorySub").innerHTML=`${dagen?`Laatste ${dagen} dagen`:"Allâh stories"}, per dag in de volgorde waarin je ze plaatste: zo zie je waar mensen afhaken. `
    +(igStoryWie==="eigen"?`Alleen je eigen stories: zelf gemaakt of je eigen post gedeeld${gedeeld?` (${nf0.format(gedeeld)} gedeelde post${gedeeld===1?"":"s"} van anderen verborgen)`:""}. `:"Ook gedeelde posts van anderen. ")
    +`Stories blijven hier bewaard, ook als ze na 24 uur van Insta verdwijnen (cijfers = laatste meting, hooguit een uur voor het einde)${eerste?`; de eerste is van ${dLabel(dagNL(eerste),1)}`:""}.`;
  if(!st.length){$("igStories").innerHTML=`<p class="sub">Nog geen stories gemeten${dagen?` in de laatste ${dagen} dagen`:""}${gedeeld?" (wel gedeelde posts van anderen: kies \"Alles\")":""}. Stories worden elk uur opgehaald zolang ze online staan (24 uur).</p>`;return}
  const titels=igTrackTitels(),opties=igMuziekOpties(titels);
  // samenvatting: de middelste story (één uitschietâh telt nie te zwaar)
  const mc=st.filter(s=>s.cijfers&&s.cijfers.reach>0);
  const mLikes=med(mc.map(igStoryLikes).filter(v=>v!=null)),mLpk=med(mc.filter(s=>igStoryLikes(s)!=null).map(s=>igStoryLikes(s)/s.cijfers.reach)),mKw=med(mc.map(igStoryKwal).filter(v=>v!=null));
  const samen=mc.length?`<div class="ytstats igstorysamen">
      ${igStat("Stories",nf0.format(st.length),igStoryWie==="eigen"?"eigen stories, in deze periode":"in deze periode")}
      ${igStat("Bereik",nf0.format(med(mc.map(s=>s.cijfers.reach))),"middelste story")}
      ${igStat("Likes ≈",mLikes==null?"—":nf0.format(mLikes),mLpk==null?"middelste story":`middelste story · ${igPct1(mLpk)} van de kijkâhs`)}
      ${igStat("Kwaliteit",mKw==null?"—":igKwalF(mKw),"gedeeld per 1.000 bereik, middelste story")}</div>`:"";
  // per dag in volgorde van posten: zo zie je waar mensen afhaken
  const perDag=new Map();[...st].reverse().forEach(s=>{const d=dagNL(s.gepost_om);if(!perDag.has(d))perDag.set(d,[]);perDag.get(d).push(s)});
  let h=samen+`<div class="tablewrap"><table class="igstorytab"><thead><tr><th>Story</th><th class="n">Bereik</th><th class="n">Weergaven</th><th class="n" title="Schatting: interacties − gedeeld − reacties (Meta geeft geen likes voor stories)">Likes ≈</th><th class="n" title="Gedeeld per 1.000 bereik">Kwaliteit</th><th class="n">Tikte weg</th><th class="n">Reacties</th><th>Muziek</th></tr></thead><tbody>`;
  [...perDag].reverse().forEach(([d,rij])=>{
    const eersteBereik=rij[0].cijfers&&rij[0].cijfers.reach;
    rij.forEach((s,i)=>{const x=s.cijfers||{};const weg=igStoryWeg(s),lk=igStoryLikes(s),kw=igStoryKwal(s),her=igStoryHerkomst(s);
      const vast=eersteBereik&&x.reach!=null&&i?` <span class="sub">(${pct(x.reach/eersteBereik)} van de 1e)</span>`:"";
      const verlopen=Date.parse(s.gepost_om)<Date.now()-864e5;
      const wie=her==="eigen_post"||her==="ander"?` <span class="chip mute" title="${esc(s.bijschrift||"")}">${IG_HERKOMST[her]}</span>`:"";
      h+=`<tr data-id="${esc(s.media_id)}"><td>${verlopen?`${dLabel(d)} ${tijdAms(s.gepost_om)}`:`<a href="${esc(s.permalink||"#")}" target="_blank" rel="noopener">${dLabel(d)} ${tijdAms(s.gepost_om)}</a>`} · ${i+1}/${rij.length}${wie}</td>
      <td class="n">${x.reach==null?(s.fout?'<span class="sub" title="'+esc(s.fout)+'">nog geen</span>':"—"):nf0.format(x.reach)+vast}</td><td class="n">${x.views==null?"—":nf0.format(x.views)}</td>
      <td class="n">${lk==null?"—":nf0.format(lk)}</td><td class="n">${kw==null?"—":igKwalF(kw)}</td>
      <td class="n">${weg==null?"—":pct(weg)}</td><td class="n">${x.replies==null?"—":nf0.format(x.replies)}</td>
      <td>${igMuziekSelect(labelsVan(s,"muziek")[0]||"",opties,titels,"Muziek onder deze story")}</td></tr>`})});
  const leeg=st.filter(s=>!labelsVan(s,"muziek").length).length;
  $("igStories").innerHTML=h+`</tbody></table></div><p class="sub" style="margin:10px 0 0"><b>Likes ≈</b> = schatting: Meta geeft voor stories geen likes, wel "interacties"; daar gaan gedeeld en reacties af (nog te checken met de Insta-app). <b>Kwaliteit</b> = gedeeld per 1.000 bereik (stories kun je nie bewaren). <b>Tikte weg</b> = deel van de weergaven waarbij iemand de stories wegtikte (hoe lager, hoe betâh). <b>Eigen of van een ander</b> herkennen we pas vanaf 1 okt (aan het bijschrift: geen tekst = zelf gemaakt, tekst van een van je posts = eigen post gedeeld); oudere stories tellen als eigen. <b>Muziek</b>: kies wat eronder zat${leeg?` (nog ${nf0.format(leeg)} zonder keuze in deze lijst)`:""}; "Geen eigen muziek" telt ook mee.</p>`+igStoryMuziekHTML();
}
/* ---------- stories: van wie, likes en kwaliteit ----------
   VOORLOPIG, nog valideren met de Insta-app (afspraak 30-09):
   - Van wie: Meta zegt het nie. Een zelf gemaakte story heeft geen bijschrift; een gedeelde post neemt het bijschrift van die post mee.
     bijschrift null = nie gemeten (story van vóór 1 okt), '' = geen tekst → zelf gemaakt, tekst gelijk aan een eigen post → eigen post gedeeld, anders → post van een ander.
   - Likes: Meta geeft geen likes voor stories. Wel total_interactions; aanname: = likes + gedeeld + reacties → likes ≈ interacties − gedeeld − reacties.
   - Kwaliteit story = gedeeld per 1.000 bereik (stories kun je nie bewaren). */
const igCapNorm=t=>String(t||"").toLowerCase().replace(/\s+/g," ").trim().slice(0,50);
function igStoryHerkomst(s){
  if(s.bijschrift==null)return "onbekend";
  const c=igCapNorm(s.bijschrift);if(!c)return "eigen";
  return IG.posts.some(p=>p.bijschrift&&igCapNorm(p.bijschrift)===c)?"eigen_post":"ander";
}
const IG_HERKOMST={eigen:"zelf gemaakt",eigen_post:"eigen post gedeeld",ander:"post van een ander",onbekend:"van vóór 1 okt"};
// "Alleen eigen" = alles behalve "post van een ander" (Marnix 30-09: een gedeelde eigen post is ook van hem)
function igStoryLikes(s){const x=s.cijfers||{};return x.total_interactions==null?null:Math.max(0,x.total_interactions-(x.shares||0)-(x.replies||0))}
function igStoryKwal(s){const x=s.cijfers||{};return x.reach>0&&x.shares!=null?x.shares*1000/x.reach:null}
function igStoryWeg(s){const x=s.cijfers||{};return x.nav_weg!=null&&(x.views||x.reach)?x.nav_weg/(x.views||x.reach):null}
// eigen muziek onder stories: houdt het mensen vast? (alle bewaarde stories met cijfers en een keuze)
function igStoryMuziekHTML(){
  const g=IG.stories.filter(s=>s.cijfers&&s.cijfers.reach!=null&&labelsVan(s,"muziek").length);
  const met=g.filter(s=>labelsVan(s,"muziek")[0]!=="(geen)"),zonder=g.filter(s=>labelsVan(s,"muziek")[0]==="(geen)");
  const blok=(naam,a)=>{const w=med(a.map(igStoryWeg).filter(v=>v!=null));
    return `<b>${naam}</b>: ${a.length} ${a.length===1?"story":"stories"}, middelste bereik ${nf0.format(med(a.map(s=>s.cijfers.reach))||0)}${w==null?"":`, tikte weg ${pct(w)}`}`};
  if(met.length<3||zonder.length<3)return `<p class="sub" style="margin:6px 0 0">♪ Vanaf 3 stories mét en 3 zonder eigen muziek zie je hier of je eigen muziek mensen langer vasthoudt (nu ${met.length} mét, ${zonder.length} zonder).</p>`;
  const nummers=new Map();met.forEach(s=>{const t=labelsVan(s,"muziek")[0];nummers.set(t,(nummers.get(t)||0)+1)});
  const top=[...nummers].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t,n])=>`${esc(t)} (${n}x)`).join(", ");
  return `<p class="sub igstorymz" style="margin:6px 0 0">♪ ${blok("Mét eigen muziek",met)} · ${blok("Zonder",zonder)}${top?`. Meest gebruikt: ${top}`:""}. ${zeker(Math.min(met.length,zonder.length))}</p>`;
}

function renderIgSneek(){
  const g=igSneek();
  const linkN=g.tot.link, bio=g.links.filter(l=>l.bron==="bio").reduce((a,l)=>a+l.n,0);
  $("igSnStats").innerHTML=[
    igStat("Via Insta",nf0.format(g.tot.insta+g.tot.link),"Sneek-bezoekâhs, laatste 30 dagen"+(g.alle?` · ${pct((g.tot.insta+g.tot.link)/g.alle)} van alle bezoek`:"")),
    igStat("Via Meta totaal",nf0.format(g.meta),`Insta + Facebook (je stories/posts gaan automatisch mee) · laatste 7 dagen ${nf0.format(g.d7)}`),
    igStat("Eigen links",nf0.format(linkN),`bezoekâhs met <code>?ref=</code>, 30 dagen${bio?` · waarvan bio ${nf0.format(bio)}`:""}`)
  ].join("");
  igKolommen($("igSnChart"),g.dagen.map(d=>({...d,tip:`${dLabel(d.d,1)}: Insta ${nf0.format(d.parts[0].v)} · Facebook ${nf0.format(d.parts[1].v)}`})),"Sneek-bezoekers via Insta per dag");
  $("igSnLinks").innerHTML=g.links.length?`<thead><tr><th>Link</th><th>Eerste bezoek</th><th class="n">Bezoekâhs</th></tr></thead><tbody>`+
    g.links.slice(0,12).map(l=>`<tr><td><code>?ref=${esc(l.bron)}</code></td><td>${dLabel(l.eerst,1)}</td><td class="n">${nf0.format(l.n)}</td></tr>`).join("")+"</tbody>"
    :'<tbody><tr><td class="sub">Nog geen bezoek via een eigen link. Maak er hierboven een en zet hem in je story of bio.</td></tr></tbody>';
}

// Wachtkamâh: nieuwe posts (vanaf IG_WACHT_VANAF) zonder muziek-keuze. Ze gaan eruit zodra je iets kiest (ook "Geen eigen muziek").
const IG_WACHT_VANAF="2026-09-22";
function igWachtend(){return IG.posts.filter(p=>p.gepost_om&&dagNL(p.gepost_om)>=IG_WACHT_VANAF&&!labelsVan(p,"muziek").length)}
function igBadge(){const b=document.querySelector('nav.hoofdmenu button[data-s="insta"]');if(!b)return;
  const k=igKoppeling(),n=igWachtend().length;let s=b.querySelector(".badge");
  if(!n&&!(k&&k.nivo==="kapot")){if(s)s.remove();return}
  if(!s){s=document.createElement("span");s.className="badge";b.appendChild(s)}
  if(k&&k.nivo==="kapot"){s.textContent="!";s.title="Insta-koppeling is stuk: maak een nieuwe sleutel";return}   // gaat voor de wachtkamer
  s.textContent=n;s.title=n+" nieuwe post"+(n>1?"s wachten":" wacht")+" op muziek";}
function igMuziekOpties(titels){
  const recent=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>titels.includes(t)).slice(0,3);
  return `<option value="">— nog niet gekozen —</option><option value="(geen)">Geen eigen muziek</option>`+
    (recent.length?`<optgroup label="Laatst gekozen">${recent.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`:"")+
    `<optgroup label="Alle nummâhs (SoundCloud, Spotify, DJ·World, YouTube)">${titels.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`;
}
function igMuziekSelect(m,opties,titels,aria){
  return `<select class="igsel" aria-label="${aria}">${opties.replace(`value="${esc(m)}"`,`value="${esc(m)}" selected`)}${m&&m!=="(geen)"&&!titels.includes(m)?`<option value="${esc(m)}" selected>${esc(m)}</option>`:""}</select>`}
function igPostRij(p,opties,titels){
  const m=labelsVan(p,"muziek")[0]||"",ond=labelsVan(p,"onderwerp");
  const eff=m&&m!=="(geen)"&&m!=="(eigen muziek)"?igPlaysEffect(m,dagNL(p.gepost_om)):null;
  const effTxt=eff?igEffectHTML(eff):"";
  return `<div class="igpost" data-id="${esc(p.media_id)}">
      <a class="igthumb" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}<span>${soortNaam(p)}</span></a>
      <div class="iginfo"><span><b>${dLabel(dagNL(p.gepost_om),1)}</b> · ${p.bereik==null?"nog geen cijfâhs":"bereik "+nf0.format(p.bereik)+(p.kwaliteit!=null?" · kwaliteit "+nf0.format(p.kwaliteit):"")}</span>
        <span class="igcap">${esc((p.bijschrift||"").replace(/^Oh oh #thehague,?\s*/i,"").slice(0,90))}</span>
        <span class="igchips">${ond.map(o=>`<span class="chip mute">${esc(o)}</span>`).join("")}${effTxt}</span></div>
      <select class="igsel" aria-label="Muziek onder deze post">${opties.replace(`value="${esc(m)}"`,`value="${esc(m)}" selected`)}${m&&m!=="(geen)"&&!titels.includes(m)?`<option value="${esc(m)}" selected>${esc(m)}</option>`:""}</select>
    </div>`;
}
function renderIgMuziek(){
  const titels=igTrackTitels(),opties=igMuziekOpties(titels);
  // 1. wachtkamâh (nieuwste eerst)
  const wacht=igWachtend();
  $("igWacht").hidden=!wacht.length;
  if(wacht.length){
    $("igWachtSub").innerHTML=`${wacht.length} nieuwe post${wacht.length>1?"s wachten":" wacht"} tot je kiest welke muziek eronder zat. Kies "Geen eigen muziek" als er iets anders onder zat; dan telt hij mee bij de vergelijking.`;
    $("igWachtLijst").innerHTML=wacht.map(p=>igPostRij(p,opties,titels)).join("");
  }
  igBadge();
  // 2. archief (zonder de wachtende posts)
  const wachtId=new Set(wacht.map(p=>p.media_id));
  let lijst=IG.posts.filter(p=>p.gepost_om&&!wachtId.has(p.media_id));
  if(igAlleenLeeg)lijst=lijst.filter(p=>!labelsVan(p,"muziek").length);
  if(igSorteer==="bereik")lijst=[...lijst].sort((a,b)=>(b.bereik??-1)-(a.bereik??-1)||(a.gepost_om<b.gepost_om?1:-1));
  document.querySelectorAll("#igSorteer button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igSorteer));
  const zonder=IG.posts.filter(p=>!labelsVan(p,"muziek").length&&!wachtId.has(p.media_id)).length;
  $("igLabelSub").innerHTML=`Meta vertelt niet welk geluid onder een post zit, dus dat kies je hier zelf. Nog ${nf0.format(zonder)} oudere posts zonder keuze.`+
    (igSorteer==="bereik"?" Gesorteerd op bereik: je grootste posts eerst, daar zit de meeste potentie.":" Tip: sorteer op <b>Meeste bereik</b> en zet <b>Alleen zonder keuze</b> aan, dan werk je de belangrijkste eerst af.");
  $("igLabels").innerHTML=lijst.slice(0,igLabelAantal).map(p=>igPostRij(p,opties,titels)).join("")||'<p class="sub">Alle posts hebben een keuze. Top, âhwe!</p>';
  $("igMeer").hidden=lijst.length<=igLabelAantal;
}

async function igZetMuziek(id,nieuw){
  const p=IG.posts.find(x=>x.media_id===id)||IG.stories.find(x=>x.media_id===id);if(!p)return;
  const oud=labelsVan(p,"muziek")[0]||"";
  const {data,error}=nieuw?await sb.rpc("ig_label_zet",{p_media_id:id,p_soort:"muziek",p_label:nieuw,p_aan:true})
                           :await sb.rpc("ig_label_zet",{p_media_id:id,p_soort:"muziek",p_label:oud,p_aan:false});
  if(error){showMsg("Opslaan lukte nie: "+error.message);renderIgMuziek();return}
  p.labels=data||[];
  if(nieuw&&nieuw!=="(geen)"){const r=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>t!==nieuw);r.unshift(nieuw);store.set("hc_ig_nummers",JSON.stringify(r.slice(0,5)))}
  renderInsta();
}

/* ---------- knoppen ---------- */
document.addEventListener("change",e=>{const s=e.target.closest(".igsel");if(s)igZetMuziek(s.closest("[data-id]").dataset.id,s.value)});
document.addEventListener("click",async e=>{
  const k=e.target.closest("#igKies button");if(k){igKies=k.dataset.v;renderInsta();return}
  const tp=e.target.closest("#igTopKies button");if(tp){igTopPeriode=tp.dataset.v;renderIgTop();return}
  const pm=e.target.closest("#igPostMaat button");if(pm){igPostMaat=pm.dataset.v;renderIgPostGrafiek();return}
  const to=e.target.closest("#igTopOp button");if(to){igTopOp=to.dataset.v;renderIgTop();return}
  const tk=e.target.closest("[data-igtop]");if(tk){igTopOp=tk.dataset.igtop;renderIgTop();return}
  const sp=e.target.closest("#igStoryKies button");if(sp){igStoryPeriode=sp.dataset.v;renderIgStories();return}
  const sw=e.target.closest("#igStoryWie button");if(sw){igStoryWie=sw.dataset.v;renderIgStories();return}
  const so=e.target.closest("#igSorteer button");if(so){igSorteer=so.dataset.v;igLabelAantal=20;renderIgMuziek();return}
  if(e.target.closest("#igMeer")){igLabelAantal+=20;renderIgMuziek();return}
  if(e.target.closest("#igAlleenLeeg")){igAlleenLeeg=!igAlleenLeeg;e.target.setAttribute("aria-pressed",igAlleenLeeg);igLabelAantal=20;renderIgMuziek();return}
  const l=e.target.closest("[data-iglink]");if(l){
    const url=igNieuweLink(l.dataset.iglink);$("igLinkUit").value=url;$("igLinkUit").hidden=false;
    const ref=url.split("ref=")[1];if(ref!=="bio"){const r=JSON.parse(store.get("hc_ig_links")||"[]");r.push(ref);store.set("hc_ig_links",JSON.stringify(r.slice(-50)))}
    try{await navigator.clipboard.writeText(url);showMsg("Link gekopieerd: "+url+" — plak hem in je link-sticker.",true)}
    catch(err){$("igLinkUit").select();showMsg("Kopiëren lukte nie vanzelf: selecteer de link en kopieer hem zelf.",false)}
    return}
});
let igRsz;addEventListener("resize",()=>{clearTimeout(igRsz);igRsz=setTimeout(()=>{if(sectie==="insta")renderInsta()},150)});

/* ---------- Status van de laatste ophaalronde (ig_live) ----------
   ig_live doet zo'n 8 stappen (profiel, bereik vandaag, volgers, posts, stories, ...). Mislukt er één,
   dan geeft hij 'fout' terug, ook al is de rest gelukt. Hier maken we onderscheid:
   ok = alles gelukt · deels = een deel gelukt · fout = niks gelukt · bezig = loopt nog. */
const IG_STAPNAAM={profiel:"volgâhs-stand",vandaag:"bereik van vandaag",volgers:"nieuwe volgâhs",posts:"posts",
  post:"cijfâhs van nieuwe posts",stories:"stories",labels:"muziek-labels"};
function igStapVan(f){return String(f).trim().split(/[: ]/)[0]}          // "stories: ..." -> "stories", "post 123: ..." -> "post"
function igStapNamen(fouten){return [...new Set(fouten.map(f=>IG_STAPNAAM[igStapVan(f)]||"iets"))].join(" en ")}
function igWanneer(ts){return dagNL(ts)===vandaagAms()?tijdAms(ts):igTijd(ts)}   // vandaag: alleen de tijd
function igLiveStand(){
  if(LIVE.bezig)return {soort:"bezig",kort:"effe bèwerke…",fouten:[]};
  const L=LIVE.ig;
  if(L&&!("ververst" in L)&&L.fout)   // de vraag aan Supabase ging zelf al mis
    return {soort:"fout",kort:/ig_live/.test(L.fout)?"live staat nog uit (draai 09b_insta_extra.sql)":"ophalen lukte nie",fouten:[L.fout]};
  if(L&&(L.ververst||L.fout)){         // deze sessie is er echt opgehaald (of het ging meteen mis)
    const fouten=L.fouten&&L.fouten.length?L.fouten:(L.fout?[L.fout]:[]),om=L.om?igWanneer(L.om):"";
    if(!fouten.length)return {soort:"ok",kort:"bègewerkt "+om,fouten};
    if(!L.ververst||!(L.stappen||[]).length)return {soort:"fout",kort:"ophalen lukte nie"+(om?" ("+om+")":""),fouten};
    return {soort:"deels",kort:`deels bègewerkt ${om} · ${igStapNamen(fouten)} lukte nie`,fouten};
  }
  // nog niet opgehaald deze sessie, of "net al bijgewerkt": laatste ronde uit de database (die bewaart alleen de eerste fout)
  const v=IG.status&&IG.status.ververst;
  if(v&&v.om)return v.fout?{soort:"deels",kort:`laatste ronde ${igWanneer(v.om)} · ${igStapNamen([v.fout])} lukte nie`,fouten:[v.fout]}
                          :{soort:"ok",kort:"bègewerkt "+igWanneer(v.om),fouten:[]};
  return {soort:"geen",kort:"",fouten:[]};
}
// statusregel onderaan de Insta-tegel en bovenaan de Insta-pagina; bij een fout uitklapbaar met de echte reden
function igStatusHTML(){
  const s=igLiveStand();if(s.soort==="geen")return "";
  const kop=`<span class="igst-i" aria-hidden="true">${{ok:"✓",deels:"⚠",fout:"✕",bezig:"…"}[s.soort]}</span> ${esc(s.kort)}`;
  if(!s.fouten.length)return `<div class="igstatus ${s.soort}">${kop}</div>`;
  const uitleg=(s.soort==="deels"?"De rest is wél bègewerkt. Meestal gaat het de volgende ronde vanzelf goed (als je het dashboard opent, hooguit 1x per 10 min, of met \"Ververse\" bovenaan, hooguit 1x per 5 min).":"Probeer \"Ververse\" bovenaan.")
    +(s.fouten.some(f=>IG_SLEUTELFOUT.test(f))?" Dit lijkt op een sleutelfout: volg de rode melding bovenaan.":"");
  return `<details class="igstatus ${s.soort}"><summary>${kop}</summary>
    <ul>${s.fouten.map(f=>`<li><code>${esc(f)}</code></li>`).join("")}</ul><p>${uitleg}</p></details>`;
}
// Meta-dag begint om middernacht in Los Angeles; bij ons meestal 09:00, maar rond de klokwissel een week 08:00
function igMetaStart(dag){
  const g=Date.parse(dag+"T08:00:00Z");   // 00:00 of 01:00 in LA, afhankelijk van zomer-/wintertijd daar
  const h=+new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",hour:"numeric",hourCycle:"h23"}).format(new Date(g));
  return g-h*36e5;
}
// regel "Bereik vandaag": getal van vandaag, of uitleg waarom het er (nog) niet is, plus gistâh ter vergelijking
function igBereikRij(c){   // geeft [kop, getal, uitleg]
  // Vandaag vs gistâh. Vandaag is nog nie klaar (Meta-dag loopt van 09:00 tot 09:00 bij ons), gistâh wel.
  // Daarom geen ↓ zolang vandaag loopt (dat zou elke ochtend "slechter" zeggen), maar "nu al X% van gistâh".
  // Pas als vandaag gistâh al voorbij is, een ↑: dat staat dan vast.
  const start=igMetaStart(c.vandaag),sinds=tijdAms(start),uren=(Date.now()-start)/36e5;
  const eind=igMetaStart(dagMin(c.vandaag,-1)),nog=Math.max(0,Math.round((eind-Date.now())/36e5));
  const stapFout=igLiveStand().fouten.some(f=>igStapVan(f)==="vandaag");
  const gd=dagMin(c.vandaag,1),g=igSom(gd,gd).reach,nu=c.nu.reach;
  const fout=stapFout?` · <span class="igst-w">⚠ nieuwste stand ophalen lukte nie</span>`:"";
  let s;
  if(nu!=null&&g){
    s=nu>=g?`gistâh ${nf0.format(g)} · <span class="up">↑ nu al ${pct(nu/g-1)} meer</span>`
           :`gistâh ${nf0.format(g)} · vandaag nu al ${pct(nu/g)} daarvan`;
    s+=`<br>tot nu, nog ${nog} uur te gaan (Meta-dag loopt tot ${tijdAms(eind)})`+fout;
  }
  else if(nu!=null)s=`tot nu · Meta-dag begon om ${sinds}`+fout;
  else if(stapFout)s=`<span class="igst-w">⚠ ophalen lukte nie</span> (Meta-dag begon om ${sinds}) · reden onderaan`;
  else if(uren<3)s=`Meta-dag begon om ${sinds}, cijfâhs volgen`+(g?` · gistâh ${nf0.format(g)}`:"");
  else s="nog geen meting van vandaag"+(g?` · gistâh ${nf0.format(g)}`:"");
  return ["Bereik vandaag",nu==null?"—":nf0.format(nu),s];
}

/* ---------- tegel op het Ovâhzicht ---------- */
// Nieuwe volgers per 1.000 niet-volgers die je zagen: vooral of het stijgt of daalt t.o.v. de week ervoor
function igTrendRij(c){
  const nu=c.volg1kNieuw,k="Volgâhs uit nieuw bereik";
  if(nu==null)return [k,"—","nieuwe volgâhs per 1.000 niet-volgers die je zagen · komt zodra er 3 dagen met opsplitsing zijn"];
  return [k,igNf1.format(nu),"nieuwe volgâhs per 1.000 niet-volgers die je zagen, laatste 7 dagen"+igVs1(nu,c.volg1kNieuwV)];
}
// volgâhs erbè én eraf (laatste 7 dagen), daaronder netto t.o.v. vorige week.
// Geeft Meta (nog) geen unfollows voor die dagen, dan alleen netto zoals vroeger (anders lijkt het alsof niemand wegging).
function igNieuwWeg(c){
  const netto=`netto ${plus(c.follows-c.unfollows)}${igVsNetto(c.follows-c.unfollows,c.nettoV)}`;
  if(!c.w.nk.follows||!c.w.nk.unfollows)return `${plus(c.follows-c.unfollows)} netto laatste 7 dagen${igVsNetto(c.follows-c.unfollows,c.nettoV)}`;
  return `<b>+${nf0.format(c.follows)}</b> nieuw · <b>−${nf0.format(c.unfollows)}</b> weg, laatste 7 dagen<br>${netto}`;
}
// De vaste rij cijfâhs, in dezelfde volgorde op de Ovâhzicht-tegel én bovenaan de Insta-tab (één lijst, dus altijd gelijk).
// Elk item: [kop, getal, uitleg, extra alleen op de Insta-tab]. Volgâhs staat apart (groot getal op de tegel).
function igVasteRijen(c){
  const l=igLikes(),k=igKwal();
  return [
    igBereikRij(c),
    ["Gemiddeld bereik per dag",c.bereikDag==null?"—":nf0.format(c.bereikDag),"laatste 7 dagen"+igVs(c.bereikDag,c.bereikDagV)],
    ["Nieuwe mensen",c.nieuwPct==null?"—":pct(c.nieuwPct),c.nieuwPct==null?"komt na de eerste nacht met 09b":"van je bereik volgt je (nog) nie, laatste 7 dagen"+igVsPct(c.nieuwPct,c.nieuwPctV),
      c.viewsNieuwPct!=null?` · ${pct(c.viewsNieuwPct)} van de weergaven`:""],
    ["Likes per kijkâh",l.nu==null?"—":igPct1(l.nu),igLikesUitleg(l)],
    ["Kwaliteit per post",k.nu==null?"—":igKwalF(k.nu),igKwalUitleg(k)],
    igTrendRij(c)];
}
function instaTegel(){
  if(IG.err||!IG.acc)return `<article class="tegel binnenkort">
    <div class="tkop"><h2>Insta</h2><span class="tag">@the_hague_beachlife</span></div>
    <p class="kd">Nog geen cijfâhs</p><p class="s">${IG.err?"Ophalen lukte nie: "+esc(IG.err):"Wacht tot vannacht, dan staan ze erin."}</p>
    <button class="btn" type="button" data-ga="insta">Kèk bè Insta</button></article>`;
  const c=igCompute();
  return `<article class="tegel">
    <div class="tkop"><h2>Insta</h2><span class="tag">@${esc(IG.acc.gebruikersnaam||"the_hague_beachlife")}</span></div>
    <p class="tlbl">Volgâhs</p>
    <div class="tgroot">${nf0.format(IG.acc.volgers||0)}</div>
    <p class="s">${igNieuwWeg(c)}</p>
    <div class="trijen">
      ${igVasteRijen(c).map(([k,v,u])=>tegelRij(k,v,u)).join("")}
      ${(n=>n?tegelRij("Wachtkamâh",nf0.format(n),`nieuwe post${n>1?"s":""} zonder muziek-keuze`):"")(igWachtend().length)}
      ${igStatusHTML()}
    </div>
    <button class="btn yellow" type="button" data-ga="insta">Kèk bè Insta</button>
  </article>`;
}
