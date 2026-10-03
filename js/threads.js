// threads.js — onderdeel Threads (@the_hague_beachlife). Data uit Supabase (19_threads.sql, 02-10-2026 chat 06).
// Wat Meta geeft (zie de kop van 19_threads.sql): per Meta-dag weergaven (account), likes, reacties, reposts, quotes, klikken;
// per post weergaven, likes, reacties, reposts, quotes, delen. GEEN bereik en GEEN nieuwe volgâhs per dag:
// die rekenen we zelf uit de volgâhs-stand per Haagse dag (th_profiel_dag), dus netto (erbij min weg).
// Dagen voor account-cijfers zijn Meta-dagen (Amerikaanse tijd, bij ons van 09:00 tot 09:00), net als bij Insta.
// Hulpjes uit insta.js (laadt eerder): igAlles, vandaagLA, dagMin, med, plus, igVs, igVsNetto, igNf1, igKolommen,
// igPostGrafiek, igTijd, igWanneer, igEersteRegel, IG_SLEUTELFOUT. En LIVE uit live.js.

let TH={acc:null,profiel:[],dag:[],posts:[],demo:[],status:{},err:null};
let thPostMaat="views";      // grafiek per post: "views" of "inter"
let thTopOp="views";         // toppâhs: sorteren op (zie TH_TOP_OP)
let thTopPer="30";           // toppâhs: "30", "90" of "alles"
let thDemoOp="city";         // waar wonen je volgâhs: "city" of "country"

const TH_SOORT={TEXT_POST:"Tekst",IMAGE:"Foto",CAROUSEL_ALBUM:"Carrousel",VIDEO:"Video",AUDIO:"Audio",REPOST_FACADE:"Repost"};
const TH_MIN_DAGEN=2, TH_N=10;              // posts pas vanaf 2 dagen oud in de trends; middelste van de laatste 10 vs de 10 daarvoor
const TH_INTER_MIN=50;                      // interactie per 1.000 weergaven alleen bij 50+ weergaven (1 like bij 8 weergaven = 125, zegt niks)

async function loadTH(){
  try{
    const since=new Date(Date.now()-120*864e5).toISOString().slice(0,10);
    const [a,p,d,m]=await Promise.all([
      sb.from("th_account").select("th_id,gebruikersnaam,naam,volgers,bijgewerkt_om").order("bijgewerkt_om",{ascending:false}).limit(1),
      sb.from("th_profiel_dag").select("dag,volgers").gte("dag",since).order("dag"),
      sb.from("th_account_dag").select("dag,cijfers").gte("dag",since).order("dag"),
      igAlles(()=>sb.from("th_media_laatst").select("media_id,soort,gepost_om,tekst,permalink,plaatje,is_quote,link,cijfers,cijfers_dag").order("gepost_om",{ascending:false}))]);
    for(const r of [a,p,d])if(r.error)throw r.error;
    TH={acc:a.data[0]||null,profiel:p.data.map(x=>({dag:String(x.dag).slice(0,10),v:x.volgers})),
      dag:d.data.map(x=>({dag:String(x.dag).slice(0,10),c:x.cijfers||{}})),
      posts:m.filter(x=>x.soort!=="REPOST_FACADE").map(thPost),reposts:m.filter(x=>x.soort==="REPOST_FACADE").length,demo:[],status:{},err:null};
  }catch(e){TH={acc:null,profiel:[],dag:[],posts:[],demo:[],status:{},err:e.message||String(e)}}
  const [dm,v,t]=await Promise.all([
    sb.from("th_demografie").select("soort,dag,data,fout").order("dag",{ascending:false}).limit(40).then(r=>r,()=>({})),
    sb.from("th_ververst").select("om,fout").limit(1).then(r=>r,()=>({})),
    sb.from("th_token").select("verloopt_op,fout,gecontroleerd_om").eq("naam","threads_access_token").limit(1).then(r=>r,()=>({}))]);
  TH.demo=dm.data||[];
  TH.status={ververst:(v.data&&v.data[0])||null,token:(t.data&&t.data[0])||null};
  thBadge();
}
// één post uit de database → handig object (cijfers los, soort in gewone woorden)
function thPost(x){const c=x.cijfers||{},n=k=>c[k]!=null?+c[k]:null;
  const inter=c.likes!=null||c.replies!=null?(n("likes")||0)+(n("replies")||0)+(n("reposts")||0)+(n("quotes")||0):null;
  return {id:x.media_id,soort:x.soort,soortNaam:TH_SOORT[x.soort]||x.soort||"?",gepost_om:x.gepost_om,tekst:x.tekst||"",permalink:x.permalink,
    plaatje:x.plaatje,quote:!!x.is_quote,link:x.link,views:n("views"),likes:n("likes"),replies:n("replies"),reposts:n("reposts"),quotes:n("quotes"),shares:n("shares"),
    inter,inter1k:inter!=null&&n("views")>=TH_INTER_MIN?inter*1000/n("views"):null,gemeten:x.cijfers_dag?String(x.cijfers_dag).slice(0,10):null}}

/* ---------- rekenen ---------- */
// som van de Meta-dagen van t/m tot, plus per cijfer op hoeveel dagen het er is (nk), net als igSom
function thSom(van,tot){const s={nk:{}};
  TH.dag.forEach(r=>{if(r.dag<van||r.dag>tot)return;for(const k in r.c){if(r.c[k]==null)continue;s[k]=(s[k]||0)+(+r.c[k]);s.nk[k]=(s.nk[k]||0)+1}});
  return s}
// volgâhs-stand op Haagse dag d: de laatste meting op of vóór d (hooguit 2 dagen eerder, anders onbekend)
function thVolgersOp(d){let best=null;TH.profiel.forEach(r=>{if(r.dag<=d&&r.dag>=dagMin(d,2)&&r.v!=null&&(!best||r.dag>best.dag))best=r});return best?best.v:null}
// netto volgâhs van één Haagse dag (stand die dag min stand de dag ervoor; beide echt gemeten)
function thNettoDag(d){const a=TH.profiel.find(r=>r.dag===d),b=TH.profiel.find(r=>r.dag===dagMin(d,1));
  return a&&b&&a.v!=null&&b.v!=null?a.v-b.v:null}
// trend per post: middelste van de laatste 10 posts (≥ 2 dagen oud) vs de 10 daarvoor
function thPostTrend(veld){
  const grens=Date.now()-TH_MIN_DAGEN*864e5;
  const ps=TH.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)<=grens&&p[veld]!=null);   // al op nieuw → oud
  const nu=ps.slice(0,TH_N),voor=ps.slice(TH_N,2*TH_N);
  return {ps,n:nu.length,nu:nu.length>=3?med(nu.map(p=>p[veld])):null,voor:voor.length>=TH_N?med(voor.map(p=>p[veld])):null};
}
function thVs10(a,b,f,grens){if(a==null||b==null)return "";
  if(!b)return ` · 10 posts daarvoor 0${a>0?' <span class="up">↑</span>':""}`;
  const d=a/b-1;return ` · 10 posts daarvoor ${f(b)}${d>=grens?' <span class="up">↑ '+pct(d)+"</span>":d<=-grens?' <span class="down">↓ '+pct(-d)+"</span>":""}`}
const thF1=v=>v<10?igNf1.format(v):nf0.format(v);

function thCompute(){
  const vandaag=vandaagLA(),gist=dagMin(vandaag,1);
  const w=thSom(dagMin(vandaag,7),gist),vw=thSom(dagMin(vandaag,14),dagMin(vandaag,8));
  const vwOk=k=>(vw.nk[k]||0)>=5;           // vorige week pas vergelijken bij minstens 5 van de 7 dagen gemeten
  const nl=vandaagAms(),v0=thVolgersOp(nl),v7=thVolgersOp(dagMin(nl,7)),v14=thVolgersOp(dagMin(nl,14));
  const posts7=TH.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>Date.now()-7*864e5).length;
  const posts7V=TH.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>Date.now()-14*864e5&&Date.parse(p.gepost_om)<=Date.now()-7*864e5).length;
  return {vandaag,w,vw,vwOk,netto:v0!=null&&v7!=null?v0-v7:null,nettoV:v7!=null&&v14!=null?v7-v14:null,
    posts7,posts7V,views:thPostTrend("views"),inter:thPostTrend("inter1k"),vs:thInsta()};
}

/* ---------- Threads vs Insta: welke Threads-post is dezelfde als een Insta-post? ----------
   Je Insta-posts gaan automatisch mee naar Threads: zelfde moment (paar minuten verschil) en dezelfde tekst
   (Threads kapt lange teksten af op 500 tekens). Regel: hooguit 15 min verschil én het begin van de tekst gelijk,
   of hooguit 3 min verschil (dan maakt de tekst nie uit). Bij twijfel de dichtstbijzijnde in tijd; elke Insta-post 1x. */
const TH_KOPPEL_MIN=15, TH_KOPPEL_ZEKER=3;
function thTekstKey(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9#@]+/g,"").slice(0,40)}
function thKoppel(){
  if(TH._koppel&&TH._koppelVan===TH.posts&&TH._koppelIg===IG.posts)return TH._koppel;
  const ig=(IG.posts||[]).filter(p=>p.gepost_om).map(p=>({p,t:Date.parse(p.gepost_om),k:thTekstKey(p.bijschrift)}));
  const kand=[];
  TH.posts.forEach(th=>{if(!th.gepost_om)return;const t=Date.parse(th.gepost_om),k=thTekstKey(th.tekst);
    ig.forEach(x=>{const min=Math.abs(x.t-t)/6e4;if(min>TH_KOPPEL_MIN)return;
      const tekst=k&&x.k&&(x.k.startsWith(k.slice(0,25))||k.startsWith(x.k.slice(0,25)));
      if(tekst||min<=TH_KOPPEL_ZEKER)kand.push({th,ig:x.p,min,tekst})})});
  kand.sort((a,b)=>(b.tekst-a.tekst)||a.min-b.min);
  const thGedaan=new Set(),igGedaan=new Set(),paren=[];
  kand.forEach(c=>{if(thGedaan.has(c.th.id)||igGedaan.has(c.ig.media_id))return;thGedaan.add(c.th.id);igGedaan.add(c.ig.media_id);paren.push(c)});
  paren.sort((a,b)=>Date.parse(b.th.gepost_om)-Date.parse(a.th.gepost_om));
  TH._koppel={paren,thIds:thGedaan,igIds:igGedaan};TH._koppelVan=TH.posts;TH._koppelIg=IG.posts;
  return TH._koppel;
}
// samenvatting laatste 30 dagen: hoeveel extra weergaven en likes levert Threads op bovenop Insta?
function thInsta(dagen=30){
  const k=thKoppel(),grens=Date.now()-dagen*864e5,klaar=Date.now()-TH_MIN_DAGEN*864e5;
  const paren=k.paren.filter(c=>Date.parse(c.th.gepost_om)>grens);
  const bruikbaar=paren.filter(c=>Date.parse(c.th.gepost_om)<=klaar&&c.th.views!=null&&+c.ig.weergaven>0);
  const igIn=(IG.posts||[]).filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>grens);
  const thIn=TH.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>grens);
  // pas tellen vanaf de eerste Threads-post die we kennen (anders lijkt alles van vóór de koppeling "nie gedeeld")
  const eerste=TH.posts.reduce((m,p)=>!m||p.gepost_om<m?p.gepost_om:m,null);
  const igNa=igIn.filter(p=>eerste&&p.gepost_om>=eerste);
  const likesP=bruikbaar.filter(c=>c.th.likes!=null&&+c.ig.likes>0);
  return {paren,n:bruikbaar.length,
    erbij:bruikbaar.length>=3?med(bruikbaar.map(c=>c.th.views/(+c.ig.weergaven))):null,
    likesErbij:likesP.length>=3?med(likesP.map(c=>c.th.likes/(+c.ig.likes))):null,
    nieGedeeld:igNa.filter(p=>!k.igIds.has(p.media_id)).length,igN:igNa.length,
    alleenTh:thIn.filter(p=>!k.thIds.has(p.id)).length};
}

/* ---------- waarschuwing: werkt de Threads-koppeling nog? (zelfde regels als bij Insta) ---------- */
function thKoppeling(){
  if(TH.err&&/th_account|relation|schema cache|does not exist/i.test(TH.err))return null;   // 19 nog nie gedraaid: geen alarm, wel uitleg op de tab
  const st=TH.status||{},acc=TH.acc;
  const gelukt=acc&&acc.bijgewerkt_om?Date.parse(acc.bijgewerkt_om):0;
  const fouten=[];
  const zet=(tekst,ts)=>{if(tekst&&IG_SLEUTELFOUT.test(tekst)&&(!ts||Date.parse(ts)>gelukt))fouten.push(tekst)};
  if(LIVE.th&&LIVE.th.fout)zet(LIVE.th.fout,LIVE.th.om||new Date().toISOString());
  if(st.ververst)zet(st.ververst.fout,st.ververst.om);
  if(st.token)zet(st.token.fout,st.token.gecontroleerd_om);
  const sinds=gelukt?igTijd(gelukt):"onbekend";
  if(fouten.length)return {nivo:"kapot",kop:"Threads-koppeling is stuk",
    tekst:`Meta weigert de Threads-sleutel. De laatste keer dat het lukte: <b>${sinds}</b>. Tot je een nieuwe sleutel maakt, komen er geen nieuwe Threads-cijfâhs binnen.`,
    detail:fouten[0].replace(/^[a-z ]+\d*[-\d]*:\s*/i,"")};
  if(gelukt&&Date.now()-gelukt>30*36e5)return {nivo:"oud",kop:"Geen verse Threads-cijfâhs",
    tekst:`De laatste keer dat het ophalen lukte: <b>${sinds}</b> (meer dan een dag geleden). Tik bovenaan op "Ververse" om het opnieuw te proberen; blijft dit staan, maak dan een nieuwe sleutel.`};
  const vo=st.token&&st.token.verloopt_op?Date.parse(st.token.verloopt_op):0;
  if(vo&&vo-Date.now()<7*864e5)return {nivo:"oud",kop:"Threads-sleutel verloopt bijna",
    tekst:`De sleutel verloopt op <b>${igTijd(vo)}</b> en het automatisch verlengen is niet gelukt. Maak op tijd een nieuwe sleutel (een verlopen Threads-sleutel is voorgoed dood).`,detail:st.token.fout||""};
  return null;
}
function thAlarmHTML(){
  const k=thKoppeling();if(!k)return "";
  return `<div class="alarm ${k.nivo}" role="alert">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">!</span><h2>${k.kop}</h2></div>
    <p>${k.tekst}</p>
    <details><summary>Zo los je het op (5 minuten)</summary><ol>
      <li>Ga naar <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">developers.facebook.com</a> → <b>My Apps</b> → <b>haagse-dashboard-threads</b> → <b>Use cases</b> → <b>Customize</b> (bij Access the Threads API) → <b>Settings</b>.</li>
      <li>Klik onder <b>User Token Generator</b> bij the_hague_beachlife op <b>Generate Access Token</b>, keur goed en kopieer de sleutel.</li>
      <li>Supabase → <b>Integrations</b> → <b>Vault</b> → <code>threads_access_token</code> → <b>Edit</b> → plakken → <b>Save</b>.</li>
      <li>Tik bovenaan op <b>Ververse</b>. Is het gelukt, dan verdwijnt deze melding vanzelf (het kan tot 5 minuten duren voordat hij het opnieuw probeert).</li>
    </ol>${k.detail?`<p class="sub">Melding van Meta: ${esc(k.detail)}</p>`:""}</details>
  </div>`;
}
function thBadge(){const b=document.querySelector('nav.hoofdmenu button[data-s="threads"]');if(!b)return;
  const k=thKoppeling(),oud=b.querySelector(".badge");if(oud)oud.remove();
  if(k&&k.nivo==="kapot")b.insertAdjacentHTML("beforeend",'<span class="badge" title="Threads-koppeling is stuk">!</span>')}
// statusregel (✓ bijgewerkt / ⚠ / ✕), zelfde opmaak als bij Insta
function thStatusHTML(){
  const L=LIVE.th;let s;
  if(LIVE.bezig)s={soort:"bezig",kort:"effe bèwerke…",fouten:[]};
  else if(L&&!("ververst" in L)&&L.fout)s={soort:"fout",kort:/th_live/.test(L.fout)?"live staat nog uit (draai 19_threads.sql)":"ophalen lukte nie",fouten:[L.fout]};
  else if(L&&(L.ververst||L.fout)){const f=L.fouten&&L.fouten.length?L.fouten:(L.fout?[L.fout]:[]),om=L.om?igWanneer(L.om):"";
    s=!f.length?{soort:"ok",kort:"bègewerkt "+om,fouten:f}:!(L.stappen||[]).length?{soort:"fout",kort:"ophalen lukte nie"+(om?" ("+om+")":""),fouten:f}:{soort:"deels",kort:`deels bègewerkt ${om}`,fouten:f}}
  else{const v=TH.status&&TH.status.ververst;
    s=v&&v.om?(v.fout?{soort:"deels",kort:`laatste ronde ${igWanneer(v.om)} · nie alles lukte`,fouten:[v.fout]}:{soort:"ok",kort:"bègewerkt "+igWanneer(v.om),fouten:[]})
      :TH.acc&&TH.acc.bijgewerkt_om?{soort:"ok",kort:"bègewerkt "+igWanneer(TH.acc.bijgewerkt_om),fouten:[]}:null}
  if(!s)return "";
  const kop=`<span class="igst-i" aria-hidden="true">${{ok:"✓",deels:"⚠",fout:"✕",bezig:"…"}[s.soort]}</span> ${esc(s.kort)}`;
  if(!s.fouten.length)return `<div class="igstatus ${s.soort}">${kop}</div>`;
  return `<details class="igstatus ${s.soort}"><summary>${kop}</summary><ul>${s.fouten.map(f=>`<li><code>${esc(f)}</code></li>`).join("")}</ul>
    <p>${s.fouten.some(f=>IG_SLEUTELFOUT.test(f))?"Dit lijkt op een sleutelfout: volg de rode melding bovenaan.":"Meestal gaat het de volgende ronde vanzelf goed. Probeer anders \"Ververse\" bovenaan."}</p></details>`;
}

/* ---------- de vaste rij cijfâhs: zelfde volgorde op de Ovâhzicht-tegel en bovenaan de Threads-tab ---------- */
function thNettoTekst(c){return c.netto==null?"netto: komt zodra er een week volgâhs-standen zijn":`${plus(c.netto)} netto laatste 7 dagen${igVsNetto(c.netto,c.nettoV)}`}
function thSomRij(c,k){const v=c.w[k];return v==null?null:{v,vorig:c.vwOk(k)?(c.vw[k]||0):null}}
// Op de tegel alleen de eerste 5 (account-weergaven pas erbij als gecheckt is wat Meta ermee bedoelt; klikken alleen op de tab).
function thVasteRijen(c){
  const rij=[],vw=c.views,it=c.inter,l=thSomRij(c,"likes"),av=thSomRij(c,"views"),kl=thSomRij(c,"clicks");
  rij.push(["Weergaven per post",vw.nu==null?"—":nf0.format(vw.nu),vw.nu==null?"komt zodra er 3 posts van minstens 2 dagen oud met cijfâhs zijn":
    `middelste van je laatste ${vw.n} posts (minstens 2 dagen oud)`+thVs10(vw.nu,vw.voor,v=>nf0.format(v),0.1)]);
  const e=c.vs;
  rij.push(["Bovenop Insta",e.erbij==null?"—":"+"+pct(e.erbij),e.erbij==null?(e.paren.length?"komt zodra 3 gedeelde posts minstens 2 dagen oud zijn":"nog geen Insta-posts op Threads gevonden"):
    `extra weergaven op Threads, t.o.v. dezelfde post op Insta · middelste van ${e.n} posts, laatste 30 dagen`]);
  rij.push(["Likes",l?nf0.format(l.v):"—",l?"laatste 7 dagen"+igVs(l.v,l.vorig):"nog geen dag-cijfâhs"]);
  const g=["replies","reposts","quotes"].map(k=>c.w[k]||0),gv=c.vwOk("replies")?["replies","reposts","quotes"].reduce((a,k)=>a+(c.vw[k]||0),0):null;
  rij.push(["Gesprek",c.w.replies==null?"—":nf0.format(g[0]+g[1]+g[2]),c.w.replies==null?"nog geen dag-cijfâhs":
    `${nf0.format(g[0])} reacties · ${nf0.format(g[1])} reposts · ${nf0.format(g[2])} quotes, laatste 7 dagen`+igVs(g[0]+g[1]+g[2],gv)]);
  rij.push(["Interactie per 1.000",it.nu==null?"—":thF1(it.nu),it.nu==null?`komt zodra er 3 posts met ${TH_INTER_MIN}+ weergaven zijn`:
    `likes + reacties + reposts + quotes per 1.000 weergaven · middelste van je laatste ${it.n} posts`+thVs10(it.nu,it.voor,thF1,0.15)]);
  rij.push(["Weergaven (account)",av?nf0.format(av.v):"—",av?"laatste 7 dagen, volgens Meta"+igVs(av.v,av.vorig):"nog geen dag-cijfâhs",
    ' <span class="pc">· Meta noemt dit "hoe vaak je profiel bekeken werd"</span>']);
  rij.push(["Klikken op links",kl?nf0.format(kl.v):"—",kl?"laatste 7 dagen"+igVs(kl.v,kl.vorig):"nog geen dag-cijfâhs"]);
  return rij;
}
function threadsTegel(){
  const naam=TH.acc?"@"+esc(TH.acc.gebruikersnaam||"the_hague_beachlife"):"@the_hague_beachlife";
  if(TH.err||!TH.acc)return `<article class="tegel binnenkort">
    <div class="tkop"><h2>Threads</h2><span class="tag">${naam}</span></div>
    <p class="kd">Nog geen cijfâhs</p><p class="s">${TH.err?(/th_account|relation|schema cache|does not exist/i.test(TH.err)?"Komt d'r an, âhwe! (draai eerst 19_threads.sql)":"Ophalen lukte nie: "+esc(TH.err)):"Wacht tot vannacht, dan staan ze erin."}</p>
    <button class="btn" type="button" data-ga="threads">Kèk bè Threads</button></article>`;
  const c=thCompute();
  return `<article class="tegel">
    <div class="tkop"><h2>Threads</h2><span class="tag">${naam}</span></div>
    <p class="tlbl">Volgâhs</p>
    <div class="tgroot">${TH.acc.volgers==null?"—":nf0.format(TH.acc.volgers)}</div>
    <p class="s">${thNettoTekst(c)}</p>
    <div class="trijen">
      ${thVasteRijen(c).slice(0,5).map(([k,v,u])=>tegelRij(k,v,u)).join("")}
      ${thStatusHTML()}
    </div>
    <button class="btn yellow" type="button" data-ga="threads">Kèk bè Threads</button>
  </article>`;
}

/* ---------- de Threads-tab ---------- */
const TH_MATEN={
  views:{kop:"Weergaven per post",aria:"Weergaven per post",v:p=>p.views,as:t=>nf0.format(t),lbl:p=>nf0.format(p.views),
    tip:p=>`${nf0.format(p.views)} weergaven · ${nf0.format(p.likes||0)} likes`,
    sub:n=>`Je laatste ${n} posts van minstens 2 dagen oud. <b>Weergaven</b>: hoe vaak je post in beeld kwam (ook herhaald kijken telt).`},
  inter:{kop:"Interactie per post",aria:"Interactie per 1.000 weergaven per post",v:p=>p.inter1k,as:t=>nf0.format(t),lbl:p=>thF1(p.inter1k),
    tip:p=>`${nf0.format(p.inter)} likes/reacties/reposts/quotes per ${nf0.format(p.views)} weergaven = ${thF1(p.inter1k)} per 1.000`,
    sub:n=>`Je laatste ${n} posts van minstens 2 dagen oud en met ${TH_INTER_MIN}+ weergaven. <b>Interactie per 1.000 weergaven</b>: likes + reacties + reposts + quotes. Zegt hoe goed een post aanslaat, los van hoeveel mensen hem zagen.`}};
const TH_TOP_OP={
  views:{kop:"Weergaven",v:p=>p.views,f:nf0,txt:"op weergaven"},
  likes:{kop:"Likes",v:p=>p.likes,f:nf0,txt:"op likes"},
  replies:{kop:"Reacties",v:p=>p.replies,f:nf0,txt:"op reacties"},
  reposts:{kop:"Reposts + quotes",v:p=>p.reposts==null&&p.quotes==null?null:(p.reposts||0)+(p.quotes||0),f:nf0,txt:"op reposts + quotes (doorvertellen)"},
  inter:{kop:"Interactie /1.000",v:p=>p.inter1k,f:{format:thF1},txt:`op interactie per 1.000 weergaven (alleen posts met ${TH_INTER_MIN}+ weergaven)`}};

function renderThreads(){
  if(!$("thStats"))return;
  $("thAlarm").innerHTML=thAlarmHTML();thBadge();
  const leeg=TH.err||!TH.acc;
  $("thBlok").hidden=!!leeg;$("thNog").hidden=!leeg;
  if(leeg){$("thNogTekst").innerHTML=TH.err?(/th_account|relation|schema cache|does not exist/i.test(TH.err)
      ?"De Threads-tabellen staan er nog nie. Draai <code>supabase/19_threads.sql</code> in Supabase (na de sleutel in de Vault)."
      :"Threads-cijfâhs ophale lukte nie: "+esc(TH.err)):"Nog geen metingen. Wacht tot vannacht of draai <code>select public.th_refresh(30, 40);</code> in Supabase.";return}
  const c=thCompute();

  // 1. tegels
  $("thSub").innerHTML=`@${esc(TH.acc.gebruikersnaam||"the_hague_beachlife")} · elke nacht vanzelf bijgewerkt<span class="pc">, en als je het dashboard opent (hooguit 1x per 10 min) of bovenaan op Ververse tikt</span>. Meta geeft voor Threads geen bereik en geen nieuwe volgâhs per post; volgâhs per dag rekenen we zelf uit de stand.`;
  $("thStatus").innerHTML=thStatusHTML();
  const pv=c.posts7-c.posts7V;
  $("thStats").innerHTML=[
    igStat("Volgâhs",TH.acc.volgers==null?"—":nf0.format(TH.acc.volgers),thNettoTekst(c)),
    ...thVasteRijen(c).map(([k,v,u,extra])=>igStat(k,v,u+(extra||""))),
    igStat("Posts",nf0.format(c.posts7),`laatste 7 dagen · vorige week ${nf0.format(c.posts7V)}${pv>=1?` <span class="up">↑ ${pv} meer</span>`:pv<=-1?` <span class="down">↓ ${-pv} minder</span>`:""}`
      +(TH.reposts?` · ${nf0.format(TH.reposts)} repost${TH.reposts===1?"":"s"} van anderen nie meegeteld`:""))
  ].join("");

  // 2. weergaven per dag (account) met strook netto volgâhs per dag
  const dagen=[];for(let i=30;i>=1;i--)dagen.push(dagMin(c.vandaag,i-1));
  const per=new Map(TH.dag.map(r=>[r.dag,r.c]));
  const vandaagNL=vandaagAms();
  igKolommen($("thChart"),dagen.map(d=>{const x=per.get(d)||{},lopend=d===c.vandaag;
    // strook: netto volgâhs van de Haagse dag met dezelfde datum (die loopt grotendeels gelijk op met de Meta-dag)
    const n=d<=vandaagNL?thNettoDag(d):null,heb=TH.profiel.some(r=>r.dag===d);
    const o=n==null?null:Math.max(n,0),w=n==null?(heb?null:undefined):Math.max(-n,0);
    const ot=n==null?(heb?"netto nie te berekenen (dag ervoor nie gemeten)":null):`netto ${n?plus(n):"0"}`;
    return {d,parts:[{v:+x.views||0,c:"hy"}],o,w,ot,od:ot!=null?dKort(d)+(d===vandaagNL?" (loopt nog)":""):null,lopend,
      tip:`${dLabel(d,1)}${lopend?" (tot nu)":""}: ${nf0.format(+x.views||0)} weergaven`+(x.likes!=null?` · ${nf0.format(x.likes)} likes`:"")+(x.replies!=null?` · ${nf0.format(x.replies)} reacties`:"")+(n!=null?` · volgâhs netto ${plus(n)}`:"")}}),
    "Weergaven per dag",{naam:"Netto volgâhs per dag",kort:"Netto volgâhs",nieuw:"erbij",c:"good",weg:{c:"weg",naam:"weg"}});

  // 3. per post: weergaven of interactie
  renderThPostGrafiek();
  // 4. Threads vs Insta
  renderThInsta(c.vs);
  // 5. toppâhs
  renderThTop();
  // 6. waar wonen je volgâhs
  renderThDemo();
}
function renderThPostGrafiek(){
  if(!$("thPostChart"))return;
  const m=TH_MATEN[thPostMaat]||TH_MATEN.views,t=thPostTrend(thPostMaat==="inter"?"inter1k":"views"),laatste=t.ps.slice(0,30).reverse().map(p=>({...p,product:"",soort:p.soortNaam}));
  document.querySelectorAll("#thPostMaat button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===thPostMaat));
  $("thPostKop").textContent=m.kop;
  $("thPostSub").innerHTML=m.sub(laatste.length)+" De groene lijn is de middelste van steeds 5 posts: zo zie je de trend zonder dat één uitschietâh alles bepaalt.";
  igPostGrafiek($("thPostChart"),laatste,m);
}
function renderThInsta(e){
  if(!$("thVs"))return;
  const zin=[];
  if(e.erbij!=null)zin.push(`Een Insta-post die mee naar Threads gaat, krijgt daar nog <b>${pct(e.erbij)}</b> weergaven bovenop (middelste van ${e.n} posts)`+(e.likesErbij!=null?` en <b>${pct(e.likesErbij)}</b> extra likes`:"")+".");
  if(e.igN)zin.push(`${nf0.format(e.igN-e.nieGedeeld)} van je ${nf0.format(e.igN)} Insta-posts staan ook op Threads`+(e.nieGedeeld?` (${nf0.format(e.nieGedeeld)} nie: vergeten aan te zetten, of een reel/collab die nie mee ging?)`:"")+".");
  if(e.alleenTh)zin.push(`${nf0.format(e.alleenTh)} post${e.alleenTh===1?"":"s"} alleen op Threads.`);
  $("thVsSub").innerHTML=`Laatste 30 dagen. Dezelfde post op Insta en Threads naast elkaar (gekoppeld op tijdstip en tekst). Posts jonger dan 2 dagen lopen nog. `+(zin.join(" ")||"Nog geen Insta-posts op Threads gevonden.");
  const rijen=e.paren.slice(0,12);
  const proc=(a,b)=>a!=null&&+b>0?pct(a/(+b)):"—";
  $("thVs").innerHTML=rijen.length?`<thead><tr><th>Post</th><th class="n">Insta<span class="pc"> weergaven</span></th><th class="n">Threads<span class="pc"> weergaven</span></th><th class="n">Erbij</th><th class="n pc">Insta likes</th><th class="n pc">Threads likes</th></tr></thead><tbody>`+
    rijen.map(({th,ig},i)=>{const loopt=Date.now()-Date.parse(th.gepost_om)<TH_MIN_DAGEN*864e5;
      return `<tr${i>=6?' class="pc"':""}><td><a href="${esc(th.permalink||"#")}" target="_blank" rel="noopener">${dKort(dagNL(th.gepost_om))}<span class="pc"> · ${th.soortNaam}</span></a>${loopt?' <span class="chip mute">loopt nog</span>':""}<span class="igcap">${esc(igEersteRegel(th.tekst))}</span></td>
      <td class="n">${ig.weergaven==null?"—":nf0.format(ig.weergaven)}</td><td class="n">${th.views==null?"—":nf0.format(th.views)}</td><td class="n"><b>${proc(th.views,ig.weergaven)}</b></td>
      <td class="n pc">${ig.likes==null?"—":nf0.format(ig.likes)}</td><td class="n pc">${th.likes==null?"—":nf0.format(th.likes)}</td></tr>`}).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${IG.posts&&IG.posts.length?"Nog geen gedeelde posts gevonden in de laatste 30 dagen.":"Insta-cijfâhs zijn er nog nie, dus nog niks te vergelijken."}</td></tr></tbody>`;
}
function renderThTop(){
  if(!$("thTop"))return;
  if(!TH_TOP_OP[thTopOp])thTopOp="views";
  const op=TH_TOP_OP[thTopOp],alles=thTopPer==="alles";
  const periode=TH.posts.filter(p=>alles||Date.parse(p.gepost_om)>Date.now()-(+thTopPer)*864e5);
  const lijst=periode.filter(p=>op.v(p)!=null).sort((a,b)=>op.v(b)-op.v(a)||(b.views||0)-(a.views||0)).slice(0,10);
  document.querySelectorAll("#thTopPer button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===thTopPer));
  document.querySelectorAll("#thTopOp button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===thTopOp));
  const zonder=periode.filter(p=>op.v(p)==null).length;
  $("thTopSub").innerHTML=`Je <span class="pc">10</span><span class="tel">5</span> beste Threads-posts ${alles?"ooit":`van de laatste ${thTopPer} dagen`}, ${op.txt}.`+(zonder?` ${nf0.format(zonder)} post${zonder===1?"":"s"} zonder dit cijfâh tellen nie mee (oude posts krijgen elke nacht stukje bij beetje hun cijfâhs).`:"")+" Tik op een post om hem te openen.";
  const kols=Object.keys(TH_TOP_OP);
  const smal=k=>thTopOp!==k?" pc":"";   // telefoon: alleen de kolom waarop je sorteert (anders past het nie)
  const kop=k=>`<th class="n${thTopOp===k?" gesorteerd":""}${smal(k)}"><button type="button" class="igtopkop" data-thtop="${k}">${TH_TOP_OP[k].kop}${thTopOp===k?" ↓":""}</button></th>`;
  const cel=(p,k)=>{const v=TH_TOP_OP[k].v(p);return `<td class="n${thTopOp===k?" gesorteerd":""}${smal(k)}">${v==null?"—":TH_TOP_OP[k].f.format(v)}</td>`};
  $("thTop").innerHTML=lijst.length?`<thead><tr><th class="n">#</th><th>Post</th>${kols.map(kop).join("")}</tr></thead><tbody>`+
    lijst.map((p,i)=>`<tr${i>=5?' class="pc"':""}><td class="n">${i+1}</td><td><a href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${dLabel(dagNL(p.gepost_om),alles)} · ${p.soortNaam}</a><span class="igcap" title="${esc(p.tekst.trim())}">${esc(igEersteRegel(p.tekst))}</span></td>${kols.map(k=>cel(p,k)).join("")}</tr>`).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${periode.length?"Nog geen posts met dit cijfâh in deze periode.":"Geen posts in deze periode."}</td></tr></tbody>`;
}
// waar wonen je volgâhs? (Meta geeft het pas vanaf 100 volgâhs; 1x per week gemeten)
function thDemoNaam(soort,k){
  if(soort==="country")return cName(k);
  if(soort==="gender")return {F:"Vrouw",M:"Man",U:"Onbekend"}[k]||k;
  if(soort==="city")return String(k).split(",")[0].replace(/^The Hague$/i,"Den Haag");
  return k}
function renderThDemo(){
  if(!$("thDemo"))return;
  document.querySelectorAll("#thDemoOp button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===thDemoOp));
  const laatste=s=>TH.demo.find(r=>r.soort===s&&!r.fout&&r.data&&Object.keys(r.data).length);
  const r=laatste(thDemoOp),fout=TH.demo.find(x=>x.soort===thDemoOp&&x.fout);
  if(!r){$("thDemo").innerHTML=`<p class="sub" style="margin:0">${fout?"Meta gaf dit (nog) nie: "+esc(fout.fout.replace(/^Threads fout \d+ bij [^:]+:\s*/,""))+". Meta geeft het pas vanaf 100 volgâhs.":"Nog nie gemeten (1x per week, in de nacht)."}</p>`;$("thDemoSub").textContent="";return}
  const rijen=Object.entries(r.data).map(([k,v])=>[k,+v]).sort((a,b)=>b[1]-a[1]),tot=rijen.reduce((a,x)=>a+x[1],0),max=rijen.length?rijen[0][1]:1;
  const extra=["age","gender"].map(s=>{const x=laatste(s);if(!x)return "";const e=Object.entries(x.data).sort((a,b)=>b[1]-a[1]),t=e.reduce((a,y)=>a+(+y[1]),0);
    return `${s==="age"?"Leeftijd":"Geslacht"}: `+e.slice(0,4).map(([k,v])=>`${esc(thDemoNaam(s,k))} ${pct(t?v/t:0)}`).join(" · ")}).filter(Boolean);
  $("thDemoSub").innerHTML=`Gemeten ${dLabel(String(r.dag).slice(0,10),1)} · Meta telt alleen volgâhs van wie het dat weet, dus het totaal (${nf0.format(tot)}) is minder dan al je volgâhs.`+(extra.length?"<br>"+extra.join("<br>"):"");
  $("thDemo").innerHTML=rijen.slice(0,8).map(([k,v],i)=>bar(thDemoNaam(thDemoOp,k),[{v,c:i===0?"groen":"hy"}],max,nf0.format(v)+" · "+pct(tot?v/tot:0),k,i+1)).join("");
}

/* ---------- knoppen ---------- */
document.addEventListener("click",e=>{
  const b=e.target.closest&&e.target.closest("#thPostMaat button, #thTopOp button, #thTopPer button, #thDemoOp button, [data-thtop]");if(!b)return;
  if(b.dataset.thtop){thTopOp=b.dataset.thtop;renderThTop();return}
  const grp=b.parentElement.id;
  if(grp==="thPostMaat"){thPostMaat=b.dataset.v;renderThPostGrafiek()}
  else if(grp==="thTopOp"){thTopOp=b.dataset.v;renderThTop()}
  else if(grp==="thTopPer"){thTopPer=b.dataset.v;renderThTop()}
  else if(grp==="thDemoOp"){thDemoOp=b.dataset.v;renderThDemo()}
});
let thRsz;addEventListener("resize",()=>{clearTimeout(thRsz);thRsz=setTimeout(()=>{if(sectie==="threads")renderThreads()},150)});
