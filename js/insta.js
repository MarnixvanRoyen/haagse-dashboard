// insta.js — onderdeel Insta (@the_hague_beachlife). Data uit Supabase (09_insta.sql + 09b_insta_extra.sql; momentopnamen bereik: 18_bereik_uur.sql).
// Let op: Meta rekent dagen in Los Angeles-tijd (9 uur achter op Den Haag). Account-cijfers per dag gebruiken die "Meta-dag".

let IG={acc:null,profiel:[],dag:[],posts:[],stories:[],err:null};
let igKies="soort";            // "Wat werkt": waarop vergelijken
let igLabelAantal=20;          // hoeveel posts in de muziek-lijst
let igAlleenLeeg=false;        // alleen posts zonder muziek-label tonen
let igSorteer="nieuw";         // muziek-lijst: "nieuw" of "bereik"
let igTopPeriode="90";         // toppâhs: "90" (laatste 90 dagen) of "alles" (allâh tijde)
let igTopOp="bereik";          // toppâhs: sorteren op bereik, kwaliteit, volgers, profiel, likes of weergaven (zie IG_TOP_OP)
let igStoryPeriode="7";        // stories: "7", "30" of "alles"
let igStoryWie="alles";        // stories: "alles", "eigen" (zelf gemaakt) of "gedeeld" (gedeelde post, bijv. een feature van je foto)

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
  IG.weg=await igWegLaden();IG_WEG_IDS=new Set(IG.weg.map(x=>x.media_id));
  (IG.stories||[]).forEach(s=>s.groep="story");   // stories horen nooit bij foto of reel (ook nie een video-story)
  IG.posts=IG.posts.filter(igActief);   // het ene filter: vanaf hier ziet elke kaart alleen actieve posts
  IG.uur=await igUurLaden();   // momentopnamen bereik van vandaag en de 7 dagen ervoor (18_bereik_uur.sql)
  IG.pu=await igPostUurLaden();   // metingen per nieuwe post op leeftijd → kaart "Deze gaat lekkâh!" (25_post_uur.sql)
  IG.status=await igStatusLaden();
  await igStoryLabels();
  await igStoryMinis();
  IG.demo=typeof demoLaden==="function"?await demoLaden("ig_demografie"):{rijen:[],fout:null};   // wie kijkt d'r? (30_demografie.sql, js/demografie.js)
  if(typeof igSamenLaden==="function")await igSamenLaden();   // samenwerkingen + Facebook-sleutel (samenwerking.js)
  igBadge();
}
/* ---------- Eén filter voor alle kaarten (22_verwijderde_posts.sql) ----------
   Actief = nie verwijderd en nie gearchiveerd. De database-view ig_post_stats laat alleen actieve posts zien;
   hier nog een keer (vlak na het laden), zodat het ook klopt als de view nog nie is bijgewerkt.
   Alle kaarten (tegels, grafieken, toppâhs, Top 5, Wat werkt, Kansâh, samenwerkinge, bedankkaart, Threads vs Insta)
   lezen IG.posts, dus geen enkele kaart kan eromheen. IG.weg = de posts die nie meâh meetellen (alleen om te tonen). */
let IG_WEG_IDS=new Set();
function igActief(p){return !!p&&!p.verwijderd_op&&!IG_WEG_IDS.has(p.media_id)}
/* ---------- Eén indeling per soort post (deel B, 06-10; 23_soort_groep.sql) ----------
   'foto' = foto's én carrousels, 'reel' = reels (en oude video's), 'story' = stories (eigen tabel ig_story).
   Dezelfde regel als public.ig_groep() in de database; ig_post_stats geeft hem mee als kolom 'groep'.
   Reels doen het heel anders (half zoveel bereik, minder likes/kwaliteit) en Meta geeft er geen volgâhs/profielbezoek
   per post voor: daarom vergelijkt het dashboard een post ALTIJD binnen z'n eigen groep.
   Gebruik voor elke (nieuwe) kaart: soortGroep(p), igPostsVan(groep) en igNormaal(groep, maat). */
const IG_GROEPEN={
  foto:{naam:"Foto's & carrousels",kort:"foto's & carrousels",een:"foto/carrousel",veel:"foto's en carrousels"},
  reel:{naam:"Reels",kort:"reels",een:"reel",veel:"reels"},
  story:{naam:"Stories",kort:"stories",een:"story",veel:"stories"}};
function soortGroep(p){
  if(!p)return null;
  if(p.groep)return p.groep;
  const pr=String(p.product||"").toUpperCase(),so=String(p.soort||"").toUpperCase();
  return pr==="STORY"?"story":pr==="REELS"||so==="VIDEO"?"reel":"foto";
}
let igGroep="foto";   // schakelaar bovenaan de Insta-tab (nie onthouden: bij openen altijd foto's & carrousels)
function igPostsVan(g){return IG.posts.filter(p=>soortGroep(p)===g)}
// "normaal" (middelste waarde) van een groep: eerst de laatste 120 dagen, te weinig → 365 dagen → allâh tijde.
// Geeft ook terug op hoeveel posts en sinds wanneer, zodat een kaart eerlijk kan zeggen waar het op rust.
// opties: voor = alleen posts van vóór dit tijdstip (Kansâh: vóór de start), min = minimaal aantal posts (standaard 5).
const IG_NORMAAL_MIN=5;
// dagen = welke vensters na elkaar (standaard 120 → 365 → allâh tijde).
// Let op: normaal BEREIK (eindstand) van een post = igNormaalEind (laatste 12 posts, eerlijk voor partner; chat 17), nie dit.
function igNormaal(g,f,{voor=Infinity,min=IG_NORMAAL_MIN,posts=null,dagen=[120,365,null]}={}){
  const bron=(posts||igPostsVan(g)).filter(p=>p.gepost_om&&Date.parse(p.gepost_om)<voor);
  const t0=Math.min(voor,Date.now());let n=0;
  for(const d of dagen){
    const l=bron.filter(p=>!d||Date.parse(p.gepost_om)>t0-d*864e5).map(p=>({p,v:f(p)})).filter(x=>x.v!=null&&!isNaN(x.v));
    n=l.length;
    if(l.length>=min){const oudste=l.reduce((m,x)=>!m||x.p.gepost_om<m?x.p.gepost_om:m,null);
      return {waarde:med(l.map(x=>+x.v)),n:l.length,dagen:d,sinds:oudste,genoeg:true}}
  }
  return {waarde:null,n,dagen:null,sinds:null,genoeg:false};
}
// "te weinig"-tekst voor een groep: "Te weinig reels: 3 met cijfâhs (minstens 5 nodig)"
const igTeWeinig=(g,n,nodig)=>`te weinig ${IG_GROEPEN[g].kort} om iets te zeggen: ${n} met cijfâhs (minstens ${nodig} nodig)`;
// schakelaar-knoppen (aantal posts per groep in de laatste 90 dagen erbij, zodat je ziet waarop het rust)
function igGroepKnoppenHTML(){
  const n=g=>igPostsVan(g).filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>Date.now()-90*864e5).length;
  return ["foto","reel"].map(g=>`<button type="button" data-v="${g}" aria-pressed="${igGroep===g}">${IG_GROEPEN[g].naam} <span class="seg-n">${n(g)}</span></button>`).join("");
}
const IG_WEG_REDEN={nie_in_lijst:"verwijderd of gearchiveerd op Insta",bestaat_nie:"verwijderd op Insta"};
const igWegReden=x=>IG_WEG_REDEN[x&&x.verwijderd_reden]||"nie meâh op Insta";
async function igWegLaden(){   // kolom bestaat pas na 22_verwijderde_posts.sql → anders gewoon een lege lijst
  try{const r=await sb.from("ig_media").select("media_id,soort,product,gepost_om,bijschrift,permalink,plaatje,verwijderd_op,verwijderd_reden")
      .not("verwijderd_op","is",null).order("gepost_om",{ascending:false}).range(0,999);
    return r.error?[]:(r.data||[])}catch(e){return []}
}
// uitklapper op de Insta-tab: welke posts tellen nie meâh mee, met knop Zet terug
function igWegHTML(){
  const w=IG.weg||[];if(!w.length)return "";
  return `<details class="igweg"><summary>${w.length} post${w.length>1?"s":""} nie meâh op Insta · tellen nergens mee</summary>
    <ul>${w.map(x=>`<li><a href="${esc(x.permalink||"#")}" target="_blank" rel="noopener">${x.gepost_om?dKort(dagNL(x.gepost_om))+" "+tijdAms(x.gepost_om):"?"} · ${esc(soortNaam(x))}</a>
      <span class="sub">${esc(igEersteRegel(x.bijschrift).slice(0,60))}</span> <span class="chip mute">${esc(igWegReden(x))}</span>
      <button class="lnk" type="button" data-igterug="${esc(x.media_id)}">Zet terug</button></li>`).join("")}</ul>
    <p class="sub">Verwijderd of gearchiveerd op Insta: de cijfâhs blijven bewaard, maar tellen nergens mee (nie in tegels, grafieken, toppâhs, Wat werkt, Kansâh of samenwerkinge).
    Zet je hem op Insta terug (uit "Onlangs verwijderd" of het archief), dan telt hij vanzelf weer mee. <b>Zet terug</b> is alleen voor als het dashboard zich vergist; staat hij echt nie meâh op Insta, dan gaat hij vannacht weer weg.</p></details>`;
}
// stories mét bijschrift (14_story_bijschrift.sql). Is die kolom er nog nie, dan zonder (dan is alles "onbekend").
async function igStoriesLaden(){
  const q=k=>sb.from("ig_story").select(k).order("gepost_om",{ascending:false}).range(0,1999);
  let r=await q("media_id,soort,gepost_om,permalink,plaatje,cijfers,fout,bijschrift");
  if(r.error&&/bijschrift/i.test(r.error.message||""))r=await q("media_id,soort,gepost_om,permalink,plaatje,cijfers,fout");
  return r;
}
// kleine plaatjes van stories (16_story_mini.sql + Edge Function story-mini). Tabel er nog nie → gewoon zonder.
async function igStoryMinis(){
  if(!IG.stories.length)return;
  let rijen=[];try{rijen=await igAlles(()=>sb.from("ig_story_mini").select("media_id,mini").not("mini","is",null))}catch(e){return}
  const m=new Map(rijen.map(r=>[r.media_id,r.mini]));IG.stories.forEach(s=>s.mini=m.get(s.media_id)||null);
}
// plaatje van een story: eigen kleine kopie, anders de link van Meta zolang die nog werkt (± 5 dagen)
function igStoryBeeld(s){return s.mini||(s.plaatje&&Date.parse(s.gepost_om)>Date.now()-5*864e5?s.plaatje:"")}
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
function igLikes(g=igGroep){
  const grens=Date.now()-IG_LIKE_DAGEN*864e5;
  const ps=igPostsVan(g).filter(p=>p.gepost_om&&Date.parse(p.gepost_om)<=grens&&+p.bereik>0&&p.likes!=null)
    .map(p=>({...p,likePct:(+p.likes)/(+p.bereik)})).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));   // nieuwste eerst
  const nu=ps.slice(0,IG_LIKE_N),voor=ps.slice(IG_LIKE_N,2*IG_LIKE_N);
  return {g,ps,n:nu.length,sinds:nu.length?nu[nu.length-1].gepost_om:null,nu:nu.length>=3?med(nu.map(p=>p.likePct)):null,
    voor:voor.length>=IG_LIKE_N?med(voor.map(p=>p.likePct)):null};   // vorige 10 alleen als het er echt 10 zijn
}
// "je laatste 10 reels (sinds 12 mrt 2025)": de datum alleen als die verder dan 90 dagen terug ligt (anders vanzelfsprekend)
function igLaatsteTxt(x){const G=IG_GROEPEN[x.g||"foto"];
  return `je laatste ${x.n} ${x.n===1?G.een:G.kort}`+(x.sinds&&Date.parse(x.sinds)<Date.now()-90*864e5?` (sinds ${dLabel(dagNL(x.sinds),1)})`:"")}
// vergelijking met de 10 posts daarvoor: verschil in procentpunten, pijltje vanaf een halve punt
function igVsLikes(a,b){if(a==null||b==null)return "";const d=(a-b)*100,t=igNf1.format(Math.abs(d))+(Math.abs(d)<1.05?" punt":" punten");
  return ` · 10 daarvoor ${igPct1(b)}${d>=0.5?` <span class="up">↑ ${t}</span>`:d<=-0.5?` <span class="down">↓ ${t}</span>`:""}`}
function igLikesUitleg(l){return l.nu==null?(l.ps.length?igTeWeinig(l.g,l.ps.length,3):`komt zodra er 3 ${IG_GROEPEN[l.g].kort} van minstens 2 dagen oud met cijfâhs zijn`):
  `van wie je post zag, gaf een like · middelste van ${igLaatsteTxt(l)}`+igVsLikes(l.nu,l.voor)}
/* ---------- kwaliteit per post: (gedeeld + bewaard) per 1.000 kijkâhs ----------
   Zelfde rekensom als "Kwaliteit" bij Wat werkt en Toppâhs, maar dan als trend: middelste van je laatste 10 posts vs de 10 daarvoor.
   Delen en bewaren wegen bij Insta zwaarder dan likes: delen brengt je post bij nieuwe mensen, bewaren = "wil ik terugzien".
   Posts pas vanaf 2 dagen oud (er wordt nog gedeeld) en met minstens 100 bereik (1x gedeeld bij 40 bereik = al 25, dat zegt niks).
   Pijltje pas vanaf 15% verschil: het zijn kleine getallen, dan zegt een klein verschil nog niks. */
const IG_KWAL_MIN_BEREIK=100, IG_KWAL_PIJL=0.15;
const igKwalF=v=>v<10?igNf1.format(v):nf0.format(v);
function igKwal(g=igGroep){
  const grens=Date.now()-IG_LIKE_DAGEN*864e5;
  const ps=igPostsVan(g).filter(p=>p.gepost_om&&Date.parse(p.gepost_om)<=grens&&+p.bereik>=IG_KWAL_MIN_BEREIK&&(p.gedeeld!=null||p.bewaard!=null))
    .map(p=>({...p,kw:((+p.gedeeld||0)+(+p.bewaard||0))*1000/(+p.bereik)})).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));   // nieuwste eerst
  const nu=ps.slice(0,IG_LIKE_N),voor=ps.slice(IG_LIKE_N,2*IG_LIKE_N);
  return {g,ps,n:nu.length,sinds:nu.length?nu[nu.length-1].gepost_om:null,nu:nu.length>=3?med(nu.map(p=>p.kw)):null,
    voor:voor.length>=IG_LIKE_N?med(voor.map(p=>p.kw)):null};
}
function igVsKwal(a,b){if(a==null||b==null)return "";
  if(!b)return ` · 10 daarvoor 0${a>0?' <span class="up">↑</span>':""}`;
  const d=a/b-1;
  return ` · 10 daarvoor ${igKwalF(b)}${d>=IG_KWAL_PIJL?' <span class="up">↑ '+pct(d)+"</span>":d<=-IG_KWAL_PIJL?' <span class="down">↓ '+pct(-d)+"</span>":""}`}
function igKwalUitleg(k){return k.nu==null?(k.ps.length?igTeWeinig(k.g,k.ps.length,3)+" (met 100+ bereik)":`komt zodra er 3 ${IG_GROEPEN[k.g].kort} van minstens 2 dagen oud (en 100+ bereik) met cijfâhs zijn`):
  `gedeeld + bewaard per 1.000 kijkâhs · middelste van ${igLaatsteTxt(k)}`+igVsKwal(k.nu,k.voor)}

// de twee maten voor de grafiek per post (knop Likes / Kwaliteit op de Insta-tab)
let igPostMaat="likes";
const IG_MATEN={
  likes:{kop:"Likes per kijkâh",aria:"Likes per kijkâh per post",v:p=>p.likePct*100,as:t=>nf0.format(t)+"%",lbl:p=>igPct1(p.likePct),
    tip:p=>`${nf0.format(+p.likes)} likes ÷ ${nf0.format(+p.bereik)} bereik = ${igPct1(p.likePct)}`,
    sub:(n,g)=>`Je laatste ${n} ${IG_GROEPEN[g].kort} van minstens 2 dagen oud. <b>Likes ÷ bereik</b>: welk deel van de mensen die de post zagen, gaf een like.`},
  kwal:{kop:"Kwaliteit per post",aria:"Kwaliteit per post: gedeeld + bewaard per 1.000 kijkâhs",v:p=>p.kw,as:t=>nf0.format(t),lbl:p=>igKwalF(p.kw),
    tip:p=>`${nf0.format(+p.gedeeld||0)} gedeeld + ${nf0.format(+p.bewaard||0)} bewaard per ${nf0.format(+p.bereik)} bereik = ${igKwalF(p.kw)} per 1.000`,
    sub:(n,g)=>`Je laatste ${n} ${IG_GROEPEN[g].kort} van minstens 2 dagen oud en met 100+ bereik. <b>Gedeeld + bewaard per 1.000 kijkâhs</b>: hoeveel mensen je post zo goed vonden dat ze hem doorstuurden of bewaarden. Dit weegt bij Insta zwaarder dan likes.`}};
// grafiek: per post een staaf, met een trendlijn = middelste van de laatste 5 posts.
// Eén uitschietâh (virale post) zou de rest plat drukken: dan loopt de schaal tot 3x de middelste post en krijgt die staaf een pijltje ▲ (echte waarde in het getal).
function igPostGrafiek(el,posts,m){   // posts: oud → nieuw; m = IG_MATEN.likes of .kwal
  if(!posts.length){el.innerHTML=`<p class="sub">Nog geen ${m.leeg||"posts"} van minstens 2 dagen oud met cijfâhs.</p>`;return}
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
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${ih}"${staafGetal(ml+i*bw+bw/2,y(v),m.lbl(p),dKort(dagNL(p.gepost_om)))}><title>${esc(tip)}</title></rect>`;
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
function igWatWerkt(kies,g="foto"){   // g = groep ("foto"/"reel"), of "alle" (alleen Kansâh: reels vs de rest)
  const jaarGeleden=Date.now()-365*864e5;
  const posts=(g==="alle"?IG.posts:igPostsVan(g)).filter(p=>p.bereik!=null&&p.gepost_om&&Date.parse(p.gepost_om)>jaarGeleden);
  const alleMed=med(posts.map(p=>p.bereik));
  const groepen=new Map();const voeg=(g,p)=>{if(!groepen.has(g))groepen.set(g,[]);groepen.get(g).push(p)};
  let volgorde=null,nietGelabeld=0;
  posts.forEach(p=>{
    if(kies==="soort")voeg(soortNaam(p),p);
    else if(kies==="onderwerp"){const l=labelsVan(p,"onderwerp");if(l.length)l.forEach(x=>voeg(x,p));else voeg("(geen onderwerp)",p)}
    else if(kies==="dag")voeg(DAGEN_LANG[(p.weekdag||1)-1],p);
    else if(kies==="tijd")voeg(dagdeel(p.uur??12),p);
    else if(kies==="muziek"){const l=labelsVan(p,"muziek");if(!l.length){nietGelabeld++;return}
      voeg(igGeenEigen(l[0])?"Zonder eigen muziek":"Met eigen muziek",p);if(l[0]==="(omgeving)")voeg("🌊 Omgevingsgeluid",p);else if(l[0]!=="(geen)")voeg("♪ "+l[0],p)}
  });
  if(kies==="dag")volgorde=DAGEN_LANG;if(kies==="tijd")volgorde=DAGDELEN;
  let rijen=[...groepen].map(([naam,ps])=>({naam,n:ps.length,med:med(ps.map(p=>p.bereik)),
    kw:med(ps.filter(p=>p.kwaliteit!=null).map(p=>+p.kwaliteit)),
    nv:ps.some(p=>p.nieuwe_volgers!=null)?ps.reduce((a,p)=>a+(p.nieuwe_volgers||0),0):null}));   // reels: Meta geeft geen volgâhs per post → "—" (nie 0)
  rijen.forEach(r=>r.idx=alleMed?r.med/alleMed:null);
  if(volgorde)rijen.sort((a,b)=>volgorde.indexOf(a.naam)-volgorde.indexOf(b.naam));
  else rijen.sort((a,b)=>(b.n>=5)-(a.n>=5)||b.med-a.med);
  return {g,rijen,n:posts.length,alleMed,nietGelabeld,alleKw:med(posts.filter(p=>p.kwaliteit!=null).map(p=>+p.kwaliteit))};
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
  (IG.posts||[]).forEach(p=>labelsVan(p,"muziek").forEach(l=>{if(igIsNummer(l))zet(l,"label")}));
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
// rechthoek met ronde hoeken onderaan (staaf die vanaf de lijn omlaag hangt; tegenhangâh van roundTop)
function roundBottom(x,yTop,w,h,r){r=Math.min(r,h,w/2);const yb=yTop+h;
  return `M${x},${yTop}V${yb-r}Q${x},${yb} ${x+r},${yb}H${x+w-r}Q${x+w},${yb} ${x+w},${yb-r}V${yTop}Z`}
// gestapelde kolommen: data=[{d,parts:[{v,c}],m,o,w,ot,od,lopend,tip}]
//   d.m = streepje (bijv. normaal = middelste van de 7 dagen ervoor om dit tijdstip)
//   onder={naam,c} = strook eronder met één getal per dag (d.o, bijv. nieuwe volgâhs)
//   onder.weg={c,naam} = tweede strook, gespiegeld: staafjes hangen omlaag onder dezelfde lijn (d.w, bijv. unfollows).
//     d.w: getal = gemeten, null = Meta gaf niks ("nie gemeten": grijs streepje, NIET als 0), undefined = geen dag-cijfâhs.
//     Nieuw en weg hebben dezelfde schaal (1 volgâh is even hoog), anders lijkt weinig weg al snel veel.
//   d.ot/d.od = tekst/datum als je de strook aanwijst of aantikt (eigen aanwijs-vlak, los van de staaf erboven)
//   d.lopend = dag loopt nog (Meta-dag tot 09:00) → staafjes in de strook half gevuld met stippelrand
//   onder.netto = extra rij getallen onder de strook (d.n = netto, null = onbekend), alleen als er ruimte is voor getallen
function igKolommen(el,data,aria,onder){
  const W=Math.max(300,Math.round(el.clientWidth||1000)),ml=40,mr=6,mt=10,mb=26,iw=W-ml-mr,ih=(W<600?180:220)-mt-mb;
  const weg=onder&&onder.weg,bw=iw/data.length,met=bw>=20;   // met = ruimte voor getallen bij de staafjes
  const og=onder?24:0,oh=onder?(W<600?40:52):0;   // og = ruimte voor het kopje van de strook, oh = hoogte strook
  const oTop=onder?Math.max(1,...data.map(d=>d.o||0),...(weg?data.map(d=>d.w||0):[])):1,oa=oh-(met?13:0);   // oa = hoogte hoogste staaf
  const wMax=weg?Math.max(0,...data.map(d=>d.w||0)):0,wa=wMax/oTop*oa;
  const wh=weg?Math.max(14,Math.ceil(wa)+(met&&wMax?13:0)+3):0;   // rode strook: zo hoog als nodig (minstens ruimte voor het grijze streepje)
  const nr=onder&&onder.netto&&met?16:0;   // nr = hoogte van de netto-rij onder de strook
  const ob=mt+ih+og+oh,H=ob+wh+nr+mb;   // ob = lijn tussen nieuw (erboven) en weg (eronder)
  const sch=schaal(Math.max(...data.map(d=>Math.max(d.parts.reduce((a,p)=>a+p.v,0),d.m||0))),3),top=sch.top;
  const y=v=>mt+ih-v/top*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`;
  sch.lijnen.forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml-6}" y="${y(t)+4}" text-anchor="end">${nf0.format(t)}</text>`});
  if(onder){
    const ng=weg&&data.some(d=>d.w===null);   // legenda "nie gemeten" alleen als het er staat
    const leg=(c,t,teken)=>`<tspan dx="10" fill="var(--${c})">${teken||"■"}</tspan><tspan dx="4">${t}</tspan>`;   // dx = ruimte (spaties tellen in SVG nie dubbel)
    const kop=weg?(W<600?onder.kort||onder.naam:onder.naam)+leg(onder.c,onder.nieuw||"nieuw")+leg(weg.c,weg.naam||"weg")+(ng?leg("muted","nie gemeten","▬"):"")+(nr?`<tspan dx="10">· netto onderin</tspan>`:""):onder.naam;
    s+=`<text x="${ml}" y="${mt+ih+og-6}" text-anchor="start" class="strook">${kop}</text><line class="base" x1="${ml}" x2="${W-mr}" y1="${ob}" y2="${ob}"/>`;
    if(nr)s+=`<text x="${ml-6}" y="${ob+wh+nr-3}" text-anchor="end">netto</text>`;
    if(!met){s+=`<text x="${ml-6}" y="${ob-oa+4}" text-anchor="end">${nf0.format(oTop)}</text>`;
      if(weg&&wMax&&wa>=12)s+=`<text x="${ml-6}" y="${ob+wa+4}" text-anchor="end">${nf0.format(wMax)}</text>`}}
  data.forEach((d,i)=>{let acc=0;const x=ml+i*bw+bw*.15,xm=ml+i*bw+bw/2,lp=c=>d.lopend?` class="lopend" stroke="var(--${c})"`:"";   // lopende dag: stippelrand
    const vis=d.parts.filter(p=>p.v>0);
    vis.forEach((p,j)=>{const h=p.v/top*ih;const yt=y(acc+p.v);
      s+=j===vis.length-1?`<path d="${roundTop(x,yt,bw*.7,h,3)}" fill="var(--${p.c})"/>`:`<rect x="${x}" y="${yt}" width="${bw*.7}" height="${h}" fill="var(--${p.c})"/>`;acc+=p.v});
    if(d.m!=null){const ym=y(d.m).toFixed(1),x1=(ml+i*bw+bw*.04).toFixed(1),x2=(ml+i*bw+bw*.96).toFixed(1);   // streepje met stip, iets breder dan de staaf
      s+=`<g class="gistmark" pointer-events="none"><line class="rand" x1="${x1}" x2="${x2}" y1="${ym}" y2="${ym}"/><line x1="${x1}" x2="${x2}" y1="${ym}" y2="${ym}"/><circle cx="${((+x1+ +x2)/2).toFixed(1)}" cy="${ym}" r="3.2"/></g>`}
    let getal=nf0.format(acc),oy=ob;
    if(onder&&d.o!=null){if(d.ot==null)getal+=` · +${nf0.format(d.o)}`;   // zonder eigen strook-tekst: zoals vroeger achter het getal
      if(d.o>0){const h=d.o/oTop*oa;oy=ob-h;s+=`<path${lp(onder.c)} d="${roundTop(x,ob-h,bw*.7,h,2)}" fill="var(--${onder.c})"/>`;
        if(met){s+=`<text x="${xm}" y="${ob-h-3}" text-anchor="middle" class="strookgetal">${nf0.format(d.o)}</text>`;oy-=13}}}
    if(weg){
      if(d.w>0){const h=d.w/oTop*oa;s+=`<path${lp(weg.c)} d="${roundBottom(x,ob,bw*.7,h,2)}" fill="var(--${weg.c})"/>`;
        if(met)s+=`<text x="${xm}" y="${ob+h+11}" text-anchor="middle" class="strookgetal">${nf0.format(d.w)}</text>`}
      else if(d.w===null)s+=`<line class="nietgemeten" x1="${x.toFixed(1)}" x2="${(x+bw*.7).toFixed(1)}" y1="${ob+5}" y2="${ob+5}"><title>nie gemeten</title></line>`}
    if(nr&&d.n!=null)s+=`<text x="${xm}" y="${ob+wh+nr-3}" text-anchor="middle" class="strookgetal netto ${d.n>0?"plus":d.n<0?"min":""}">${d.n?plus(d.n):"0"}</text>`;
    const hb=onder&&d.ot!=null?mt+ih+4:ob;   // staaf erboven en strook elk een eigen aanwijs-vlak (strook-vlak loopt door over de netto-rij)
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${hb-mt}"${staafGetal(xm,y(acc),getal,dKort(d.d))}><title>${d.tip}</title></rect>`;
    if(onder&&d.ot!=null)s+=`<rect class="hit" x="${ml+i*bw}" y="${hb}" width="${bw}" height="${ob+wh+nr-hb}"${staafGetal(xm,oy,d.ot,d.od||dKort(d.d))}><title>${d.tip}</title></rect>`;
    if((data.length-1-i)%7===0){const rand=xm>W-mr-24;   // laatste datum nie over de rand laten lopen (zoals in igPostGrafiek)
      s+=`<text x="${rand?W-mr:xm}" y="${H-8}" text-anchor="${rand?"end":"middle"}">${dLabel(d.d)}</text>`}});
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

// volgâhs van één Meta-dag voor de strook onder Bereik per dag: {o: nieuw, w: weg, ot: tekst bij aanwijzen/tikken}
// w = null als Meta (nog) geen unfollows gaf → "nie gemeten", NIET als 0 tonen (anders lijkt het alsof niemand wegging).
// Geen dag-cijfâhs (x = null) → niks tekenen en geen tekst. Lopende dag → "loopt nog" (staat al bij de datum).
function igVolgDag(x){
  if(!x)return {o:null,w:undefined,n:null,ot:null};
  const o=x.follows!=null?+x.follows:null,w=x.unfollows!=null?+x.unfollows:null;
  let ot;
  if(o!=null&&w!=null)ot=`+${nf0.format(o)} · −${nf0.format(w)} · netto ${o-w?plus(o-w):"0"}`;
  else if(o!=null)ot=`+${nf0.format(o)} · weg nie gemeten`;
  else if(w!=null)ot=`nieuw nie gemeten · −${nf0.format(w)}`;
  else ot="nie gemeten";
  return {o,w,n:o!=null&&w!=null?o-w:null,ot};   // n = netto (alleen als nieuw én weg gemeten zijn)
}
// telefoon: alleen netto per dag (groen omhoog = meer erbij, rood omlaag = meer weg). Weg nie gemeten → netto onbekend (grijs streepje).
function igNettoDag(v){
  if(v.ot==null)return {o:null,w:undefined,ot:null};
  if(v.n==null)return {o:null,w:null,ot:"netto onbekend (weg nie gemeten)"};
  return {o:Math.max(v.n,0),w:Math.max(-v.n,0),ot:`netto ${v.n?plus(v.n):"0"}`};
}
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
  if($("igStatus"))$("igStatus").innerHTML=igStatusHTML()+igWegHTML();
  if($("igGroep"))$("igGroep").innerHTML=igGroepKnoppenHTML();
  $("igStats").innerHTML=[
    igStat("Volgâhs",nf0.format(IG.acc.volgers||0),igNieuwWeg(c)),
    ...igVasteRijen(c).map(([k,v,u,extra])=>igStat(k,v,u+(extra||""))),
    // alleen op de Insta-tab ("Volgâhs per 1.000 bereik" weg sinds 01-10: "Volgâhs uit nieuw bereik" zegt het betâh)
    igPostsStat(c)
  ].join("");

  // 2. bereik per dag, volgers vs nieuw
  const dagen=[];for(let i=30;i>=1;i--)dagen.push(dagMin(c.vandaag,i-1));
  const per=new Map(IG.dag.map(r=>[r.dag,r.c]));
  const vg=igVandaagVsGist(c);   // streepje bij vandaag: normale stand (middelste van de 7 dagen ervoor) na evenveel tijd (null = nog geen eerlijke vergelijking)
  let grijs=false;
  const smal=window.matchMedia("(max-width:700px)").matches;   // telefoon: alleen netto per dag; Mac/iPad: erbij, weg én netto (zelfde grens als class pc/tel)
  igKolommen($("igChart"),dagen.map(d=>{const x=per.get(d)||{};const split=x.reach_nieuw!=null;
    const parts=split?[{v:x.reach_volgers||0,c:"groen"},{v:x.reach_nieuw||0,c:"hy"}]:[{v:x.reach||0,c:"muted"}];
    if(!split&&x.reach)grijs=true;
    const m=d===c.vandaag&&vg?vg.g:null,lopend=d===c.vandaag;
    const v0=igVolgDag(per.has(d)?x:null),vs=smal?igNettoDag(v0):v0;   // strook onderin: nieuw (groen, omhoog) en weg (rood, omlaag), telefoon: netto
    return {d,parts,m,o:vs.o,w:vs.w,n:v0.n,ot:vs.ot,od:vs.ot!=null?dKort(d)+(lopend?" (loopt nog)":""):null,lopend,
      tip:`${dLabel(d,1)}${lopend?" (tot nu)":""}: bereik ${nf0.format(x.reach||0)}`+(m!=null?` · normaal om ${vg.tijdG}: ${nf0.format(m)}`:"")+(split?` · volgers ${nf0.format(x.reach_volgers)} · nieuw ${nf0.format(x.reach_nieuw)}`:"")+(v0.ot!=null?` · volgâhs ${v0.ot}`+(x.follows!=null&&x.reach?` (${igNf1.format(x.follows*1000/x.reach)} nieuw per 1.000 bereik)`:""):"")}}),
    "Bereik per dag",smal?{naam:"Netto volgâhs per dag",kort:"Netto volgâhs",nieuw:"erbij",c:"good",weg:{c:"weg",naam:"weg"}}
                         :{naam:"Volgâhs per dag",kort:"Volgâhs",c:"good",weg:{c:"weg"},netto:true});
  if($("igLegGist"))$("igLegGist").hidden=!vg;     // legenda: alleen tonen wat er in de grafiek staat (telefoon: nie meer regels dan eerst)
  if($("igLegGrijs"))$("igLegGrijs").hidden=!grijs;

  // 2b. likes per kijkâh of kwaliteit per post (laatste 30 posts)
  renderIgPostGrafiek();
  renderIgPostsPerDag();   // 2c. posts per dag (laatste 30 dagen)

  // 3. wat werkt
  document.querySelectorAll("#igKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igKies));
  const ww=igWatWerkt(igKies,igGroep),G=IG_GROEPEN[igGroep];
  const maxIdx=Math.max(1,...ww.rijen.map(r=>r.idx||0));
  $("igWwSub").innerHTML=`${nf0.format(ww.n)} ${G.kort} van het laatste jaar met cijfâhs (alleen ${G.veel}: ${igGroep==="reel"?"reels doen het heel anders dan foto's, dus die vergelijken we alleen met elkaar":"reels staan onder de knop Reels"}). <b>Bereik</b> = mediaan (de middelste post, dus één uitschietâh telt niet te zwaar). <b>vs normaal</b> = t.o.v. je middelste ${G.een} (${ww.alleMed==null?"—":nf0.format(ww.alleMed)}).`
    +(ww.n<IG_NORMAAL_MIN?` <b>Let op:</b> ${igTeWeinig(igGroep,ww.n,IG_NORMAAL_MIN)}.`:"")+` <b>Kwaliteit</b> = gedeeld + bewaard per 1.000 bereik (normaal ${ww.alleKw==null?"—":nf0.format(ww.alleKw)}).`
    +(igKies==="muziek"?` Nog ${nf0.format(ww.nietGelabeld)} posts zonder muziek-label: label ze hieronder.`:"")
    +(igKies==="onderwerp"?" Onderwerpen komen uit je hashtags; een post kan in meer groepen zitten.":"");
  $("igWw").innerHTML=ww.rijen.length?`<thead><tr><th>Groep</th><th class="n">Posts</th><th class="n">Bereik</th><th>vs normaal</th><th class="n">Kwaliteit</th><th class="n">Volgâhs erbè</th><th>Zekerheid</th></tr></thead><tbody>`+
    ww.rijen.map(r=>{const idx=r.idx==null?"—":(r.idx>=1?"+":"−")+nf0.format(Math.abs(r.idx-1)*100)+"%";
      return `<tr><td>${esc(r.naam)}</td><td class="n">${nf0.format(r.n)}</td><td class="n">${r.med==null?"—":nf0.format(r.med)}</td>
      <td><span class="igidx"><span class="igidxbar"><i style="width:${Math.min(100,(r.idx||0)/maxIdx*100)}%;background:var(--${(r.idx||0)>=1?"groen":"muted"})"></i></span>${idx}</span></td>
      <td class="n">${r.kw==null?"—":nf0.format(r.kw)}</td><td class="n">${r.nv==null?"—":nf0.format(r.nv)}</td><td>${zeker(r.n)}</td></tr>`}).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${igKies==="muziek"?"Nog geen posts met een muziek-label. Kies hieronder per post welk nummâh eronder zat.":"Nog geen posts met cijfâhs."}</td></tr></tbody>`;

  // 3b. voorspel-check (chat 17.2)
  renderIgVoorspel();

  // 4. toppâhs (laatste 90 dagen of allâh tijde)
  renderIgTop();
  renderIgT5();   // 4b. Top 5 (alleen telefoon)
  // 5. samenwerkingen: sinds 03-10 in het eigen menu-onderdeel Partnâhs (renderPartners in samenwerking.js)

  renderIgStories();
  renderIgMuziek();
  if(typeof renderIgDemo==="function")renderIgDemo();   // wie kijkt d'r? (js/demografie.js, alleen Mac/iPad)
}

/* ---------- kaart Voorspel-check (chat 17.2): leest ALLEEN igVoorspelCheck() ---------- */
let IG_VC_WACHT=false;
const igVcPct=f=>f==null?"—":(f>0.005?"+":f<-0.005?"−":"±")+nf0.format(Math.abs(f*100))+"%";
function renderIgVoorspel(){
  if(!$("igVc"))return;
  // de dagmetingen (ig_media_dag) komen via Kansâh binnen; nog bezig? dan straks opnieuw tekenen
  if(!IG_VC_WACHT&&typeof KM_LAADT!=="undefined"&&KM_LAADT){IG_VC_WACHT=true;KM_LAADT.then(()=>renderIgVoorspel())}
  const V=igVoorspelCheck(),R=V.rijen;
  $("igVcSub").innerHTML=`Klopt de verwachte eindstand achteraf? Getest op <b>${nf0.format(V.n)}</b> posts van ${IG_GROEI.eindNa} dage of oudâh `
    +`die in hun eerste dage gemete zijn (dat kan pas sinds eind septembâh, dus dit worre er vanzelf meer).`;
  // in gewone zinnen: rijen met hetzelfde oordeel samen
  const tijd={360:"6 uur",720:"12 uur",1440:"1 dag",2880:"2 dagen",5760:"4 dagen"};
  const en=a=>a.length<2?a[0]:a.slice(0,-1).join(", ")+" en "+a[a.length-1];
  const richting=f=>Math.abs(f)<.02?"raadt hij bijna precies goed":`zit de verwachting meestal ${nf0.format(Math.abs(f*100))}% te ${f>0?"hoog":"laag"}`;
  const pc=x=>nf0.format(x*100)+"%";
  const zinnen=["past","ruim","krap","weinig"].map(o=>{const g=R.filter(r=>r.oordeel===o);if(!g.length)return "";
    const na=`<b>Na ${en(g.map(r=>tijd[r.k]||r.naam))}</b>`,m=med(g.map(r=>r.med)),sp=Math.max(...g.map(r=>r.spreid||0)),mg=g.map(r=>"± "+pc(r.marge)).join(" / ");
    if(o==="weinig")return `<li class="w">${na}: nog te weinig posts om iets te zegge. Komt vanzelf.</li>`;
    if(o==="krap")return `<li class="k">${na} ${richting(m)}, maar soms tot ${pc(sp)} d'rnaast, terwijl het dashboard ${mg} belooft. Iets te zeker van zichzelf (wordt bijgesteld in chat 17.1).</li>`;
    if(o==="ruim")return `<li class="g">${na} ${richting(m)}, en bijna altijd binnen ${pc(sp)}: zelfs betâh dan het dashboard belooft (${mg}).</li>`;
    return `<li class="g">${na} ${richting(m)}, en bijna altijd binnen ${pc(sp)}. Klopt met wat het dashboard belooft (${mg}).</li>`}).join("");
  $("igVcZin").innerHTML=zinnen;
  const o2=(c,pc,tel)=>`<span class="chip ${c}"><span class="pc">${pc}</span><span class="tel">${tel}</span></span>`;
  const oord={past:o2("good","marge klopt","klopt"),krap:o2("warn","marge te krap","te krap"),ruim:o2("mute","marge ruim","ruim"),weinig:o2("mute","nog te weinig","weinig")};
  $("igVc").innerHTML=`<thead><tr><th>Na</th><th class="n pc">Posts</th><th class="n">Meestal</th><th class="n"><span class="pc">8 op 10 binnen</span><span class="tel">8 v/d 10</span></th><th class="n pc">Te hoog · laag</th><th class="n"><span class="pc">Marge nu</span><span class="tel">Marge</span></th><th><span class="pc">Oordeel</span></th></tr></thead><tbody>`
    +R.map(r=>`<tr><td class="igvcna">${r.naam}<span class="tel sub"> (${nf0.format(r.n)})</span></td><td class="n pc">${nf0.format(r.n)}</td><td class="n">${igVcPct(r.med)}</td>
      <td class="n">${r.spreid==null?"—":"± "+nf0.format(r.spreid*100)+"%"}</td><td class="n pc">${r.n?`${r.hoog} · ${r.laag}`:"—"}</td>
      <td class="n">± ${nf0.format(r.marge*100)}%</td><td>${oord[r.oordeel]}</td></tr>`).join("")+"</tbody>";
  $("igVcDag").innerHTML=`<thead><tr><th>Na</th><th class="n"><span class="pc">Gepost overdag (05–17 u)</span><span class="tel">Overdag</span></th><th class="n"><span class="pc">Gepost 's avonds (17–05 u)</span><span class="tel">'s Avonds</span></th></tr></thead><tbody>`
    +R.filter(r=>r.n).map(r=>{const c=g=>g.n?`${igVcPct(g.med)} <span class="sub">(${g.n})</span>`:"—";
      return `<tr><td class="igvcna">${r.naam}</td><td class="n">${c(r.dag)}</td><td class="n">${c(r.avond)}</td></tr>`}).join("")
    +(R.some(r=>r.n)?"":`<tr><td class="sub" colspan="3">Nog geen posts om te vergelijke.</td></tr>`)+"</tbody>";
  const kol=IG_VC.leeftijden,tel=k=>k<1440?' class="n pc"':' class="n"';
  $("igVcPosts").innerHTML=V.posts.length?`<thead><tr><th>Post</th><th class="n">Echt</th>${kol.map(([k,n])=>`<th${tel(k)}>${n}</th>`).join("")}</tr></thead><tbody>`
    +V.posts.map(({p,pt,dagdeel,dagen})=>`<tr${pdAttr(p)}><td><div class="igtoprij"><span class="igthumb klein pc" aria-hidden="true">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span>`
      +`<div style="min-width:0"><span class="pc">${igTijd(p.gepost_om)} · ${soortNaam(p)} <span class="igcap" title="${esc((p.bijschrift||"").trim())}">${esc(igEersteRegel(p.bijschrift))}</span></span>`
      +`<span class="tel">${igTijd(p.gepost_om).replace(/^\S+\s/,"")}${soortGroep(p)==="reel"?" · reel":""}</span></div></div></td>`
      +`<td class="n">${nf0.format(+p.bereik)}<br><span class="sub">${nf0.format(dagen)} <span class="pc">dage</span><span class="tel">d</span></span></td>`
      +kol.map(([k])=>{const x=pt[k];return `<td${tel(k)}>${x?`${nf0.format(x.verw)}<br><span class="igvcf${Math.abs(x.fout)>igGroeiMarge(k)?" buiten":""}">${igVcPct(x.fout)}</span>`:"—"}</td>`}).join("")+"</tr>").join("")+"</tbody>"
    :`<tbody><tr><td class="sub">Nog geen posts van ${IG_GROEI.eindNa} dage oud met metingen uit de eerste dage.</td></tr></tbody>`;
  $("igVcNoot").innerHTML=`<b>Meestal</b> = de middelste fout (+ = te hoog geschat). <b>8 op 10 binnen</b> = zo ver zat 8 van de 10 posts d'r hooguit naast. `
    +`<b>Marge nu</b> = wat het dashboard belooft bij een verwachting. Eerlijk gerekend: elke post is voorspeld zónder die post zelf. Echt = bereik van nu.`;
}

/* ---------- grafiek per post: likes per kijkâh of kwaliteit (knop) ---------- */
function renderIgPostGrafiek(){
  if(!$("igLikeChart"))return;
  const m=IG_MATEN[igPostMaat],l=igPostMaat==="kwal"?igKwal():igLikes(),laatste=l.ps.slice(0,30).reverse();
  document.querySelectorAll("#igPostMaat button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igPostMaat));
  $("igLikeKop").textContent=m.kop;
  $("igLikeSub").innerHTML=m.sub(laatste.length,l.g)+(l.ps.length&&l.ps.length<3?` <b>Let op:</b> ${igTeWeinig(l.g,l.ps.length,3)}.`:"")+" De groene lijn is de middelste van steeds 5 posts, zo zie je de trend zonder dat één uitschietâh alles bepaalt. Alleen je eigen posts: waar je bijdrager bent telt nie mee.";
  igPostGrafiek($("igLikeChart"),laatste,{...m,leeg:IG_GROEPEN[l.g].kort});
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
  // reels: Meta geeft geen volgâhs/profielbezoek per post → die knoppen en kolommen weg (anders een lege ranglijst)
  const reel=igGroep==="reel",G=IG_GROEPEN[igGroep],nieVoorReel=k=>reel&&(k==="volgers"||k==="profiel");
  if(!IG_TOP_OP[igTopOp]||nieVoorReel(igTopOp))igTopOp="bereik";
  document.querySelectorAll("#igTopOp button").forEach(b=>b.hidden=nieVoorReel(b.dataset.v));
  const alles=igTopPeriode==="alles",op=IG_TOP_OP[igTopOp],opKw=igTopOp==="kwaliteit";
  const metCijfers=igPostsVan(igGroep).filter(p=>p.bereik!=null);
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
    const zonder=igPostsVan(igGroep).length-metCijfers.length;
    const optxt=op.txt+(opKw?`. Alleen posts met minstens ${nf0.format(drempel)} bereik tellen mee, anders kan een post die bijna niemand zag bovenaan komen`:"")
      +(zonderCijfer?`. ${nf0.format(zonderCijfer)} post${zonderCijfer===1?"":"s"} zonder dit cijfâh (Meta geeft het nie voor elke soort, bijv. reels) tellen hier nie mee`:"");
    $("igTopSub").innerHTML=alles
      ?`Je 10 beste ${G.kort} ooit, ${optxt}. Gekeken naâh ${nf0.format(metCijfers.length)} ${G.kort} met cijfâhs${oudste?`, de oudste van ${dLabel(dagNL(oudste),1)}`:""}.`
        +(zonder?(zonder===1?" 1 post heb (nog) geen cijfâhs en telt nie mee.":` ${nf0.format(zonder)} posts hebbe (nog) geen cijfâhs en telle nie mee.`):"")
        +" Het archief vult zich elke nacht verder aan, dus oude toppâhs kunne d'r nog bij komme."
      :`Beste ${G.kort} van de laatste 90 dagen, ${optxt}.${periode.length<3?` <b>Let op:</b> maar ${periode.length} ${periode.length===1?G.een:G.kort} in deze periode, kijk ook bij Allâh tijde.`:""} Klik op een post voor alle cijfâhs (Cmd-klik = op Insta), of op een kolomkop om daarop te sorteren.`;
  }
  const kop=k=>`<th class="n${igTopOp===k?" gesorteerd":""}"><button type="button" class="igtopkop" data-igtop="${k}">${IG_TOP_OP[k].kop}${igTopOp===k?" ↓":""}</button></th>`;
  const cel=(p,k)=>{const v=IG_TOP_OP[k].v(p);return `<td class="n${igTopOp===k?" gesorteerd":""}">${v==null?"—":IG_TOP_OP[k].f.format(v)}</td>`};
  const kols=Object.keys(IG_TOP_OP).filter(k=>!nieVoorReel(k));
  $("igTop").innerHTML=lijst.length?`<thead><tr><th class="n">#</th><th>Post</th>${kols.map(kop).join("")}</tr></thead><tbody>`+
    lijst.map((p,i)=>`<tr${pdAttr(p)}><td class="n">${i+1}</td><td><div class="igtoprij"><a class="igthumb klein" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener" aria-hidden="true" tabindex="-1">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</a><div style="min-width:0"><a href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${dLabel(dagNL(p.gepost_om),alles)} · ${soortNaam(p)}</a> <span class="igcap" title="${esc((p.bijschrift||"").trim())}">${esc(igEersteRegel(p.bijschrift))}</span></div></div></td>
      ${kols.map(k=>cel(p,k)).join("")}</tr>`).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">${periode.length?`Nog geen ${G.kort} met een cijfâh voor ${op.kop.toLowerCase()}${alles?"":" in de laatste 90 dagen"}.`:alles?`Nog geen ${G.kort} met cijfâhs.`:`Geen ${G.kort} met cijfâhs in de laatste 90 dagen.`}</td></tr></tbody>`;
}

/* ---------- Top 5 op de telefoon (01-10): posts óf stories, 7/30/90 dagen, op bereik, likes of kwaliteit ----------
   Alleen < 700 px breed (class "tel"); Mac/iPad hebben Je toppâhs (top 10) en de Stories-tabel.
   Zelfde rekenregels als daar: posts kwaliteit = (gedeeld + bewaard) per 1.000 bereik, stories = gedeeld per 1.000 bereik.
   Op kwaliteit tellen posts/stories met heel weinig bereik nie mee (1x gedeeld bij 40 bereik = al 25, zegt niks):
   drempel = de helft van de middelste in de lijst, minstens 100 (posts) of 50 (stories hebben minder bereik).
   Nog nie klaar (post < 2 dagen, story < 24 uur) → "loopt nog", telt wel mee. */
let igT5Wat="posts", igT5Per="30", igT5Op="bereik";
const IG_T5_OP={
  bereik:{naam:"bereik",post:p=>p.bereik,story:s=>(s.cijfers||{}).reach,f:v=>nf0.format(v)},
  likes:{naam:"likes",post:p=>p.likes,story:s=>igStoryLikes(s),f:v=>nf0.format(v)},
  kwaliteit:{naam:"kwaliteit",post:p=>IG_TOP_OP.kwaliteit.v(p),story:s=>igStoryKwal(s),f:v=>igKwalF(v)}};
function igT5Lijst(){   // {lijst:[{x,v,bereik,likes}], n, zonder, drempel}
  const op=IG_T5_OP[igT5Op]||IG_T5_OP.bereik,st=igT5Wat==="stories",grens=Date.now()-(+igT5Per)*864e5;
  const bron=st?(IG.stories||[]):igPostsVan(igGroep);   // posts: alleen de groep van de schakelaar bovenaan
  const alle=bron.filter(x=>x.gepost_om&&Date.parse(x.gepost_om)>grens).map(x=>({x,
    v:st?op.story(x):op.post(x),bereik:st?(x.cijfers||{}).reach:x.bereik,likes:st?igStoryLikes(x):x.likes}));
  const metBereik=alle.filter(r=>r.bereik!=null);
  const drempel=igT5Op==="kwaliteit"?Math.max(st?50:100,Math.round((med(metBereik.map(r=>+r.bereik))||0)/2)):0;
  const bruikbaar=alle.filter(r=>r.v!=null&&!isNaN(+r.v)&&(+r.bereik||0)>=drempel);
  const lijst=bruikbaar.sort((a,b)=>(+b.v)-(+a.v)||(+b.bereik||0)-(+a.bereik||0)||(a.x.gepost_om<b.x.gepost_om?-1:1)).slice(0,5);
  return {lijst,n:alle.length,zonder:alle.filter(r=>r.v==null).length,teKlein:alle.filter(r=>r.v!=null&&(+r.bereik||0)<drempel).length,drempel,st,op};
}
function renderIgT5(){
  if(!$("igT5"))return;
  if(!IG_T5_OP[igT5Op])igT5Op="bereik";
  [["igT5Wat",igT5Wat],["igT5Per",igT5Per],["igT5Op",igT5Op]].forEach(([id,v])=>document.querySelectorAll(`#${id} button`).forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===v)));
  const {lijst,n,zonder,teKlein,drempel,st,op}=igT5Lijst(),G=IG_GROEPEN[igGroep],wat=st?"stories":G.kort;
  const uitleg={bereik:"op bereik (hoeveel verschillende mensen het zagen)",likes:"op likes",
    kwaliteit:st?"op kwaliteit (gedeeld per 1.000 bereik)":"op kwaliteit (gedeeld + bewaard per 1.000 bereik)"}[igT5Op];
  const extra=[];
  if(teKlein)extra.push(`${nf0.format(teKlein)} met minder dan ${nf0.format(drempel)} bereik tellen nie mee`);
  if(zonder)extra.push(`${nf0.format(zonder)} zonder dit cijfâh`);
  $("igT5Sub").innerHTML=`Je 5 beste ${wat} van de laatste ${igT5Per} dagen, ${uitleg}. ${nf0.format(n)} ${n===1?(st?"story":G.een):wat} in deze periode`+(extra.length?` (${extra.join(", ")})`:"")+"."
    +(st?" Tik op een story voor alle cijfâhs.":" Tik op een post voor alle cijfâhs.");
  if(!lijst.length){$("igT5").innerHTML=`<p class="sub" style="margin:0">${n?`Nog geen ${wat} met een cijfâh voor ${op.naam} in de laatste ${igT5Per} dagen.`:`Geen ${wat} in de laatste ${igT5Per} dagen.`}</p>`;return}
  $("igT5").innerHTML=lijst.map((r,i)=>{const x=r.x,d=dagNL(x.gepost_om),oud=Date.now()-Date.parse(x.gepost_om);
    const loopt=oud<(st?1:2)*864e5?' <span class="chip mute">loopt nog</span>':"";
    const kop=st?`${dKort(d)} ${tijdAms(x.gepost_om)}`:`${dKort(d)} · ${soortNaam(x)}`;
    const tekst=st?String(x.bijschrift||"").trim():igEersteRegel(x.bijschrift);
    const beeld=st?igStoryBeeld(x):x.plaatje;
    const link=st?(oud<864e5&&x.permalink?x.permalink:""):(x.permalink||"");
    const bij=igT5Op==="bereik"?(r.likes!=null?`${nf0.format(r.likes)} likes`:""):(r.bereik!=null?`bereik ${nf0.format(r.bereik)}`:"");
    const binnen=`<span class="nr">${i+1}</span>
      <span class="igthumb ${st?"story":"klein"}" aria-hidden="true">${beeld?`<img src="${esc(beeld)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span>
      <span class="wat"><b>${kop}</b>${loopt?`<span>${loopt}</span>`:""}${tekst?`<span class="igcap">${esc(tekst)}</span>`:""}</span>
      <span class="cijf"><b>${op.f(+r.v)}</b><span>${igT5Op==="kwaliteit"?"per 1.000":op.naam}</span>${bij?`<span class="bij">${bij}</span>`:""}</span>`;
    return link?`<a class="igt5rij" href="${esc(link)}" target="_blank" rel="noopener"${pdAttr(x)}>${binnen}</a>`:`<div class="igt5rij"${pdAttr(x,true)}>${binnen}</div>`}).join("");
}

function renderIgStories(){
  document.querySelectorAll("#igStoryKies button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igStoryPeriode));
  document.querySelectorAll("#igStoryWie button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igStoryWie));
  const dagen=igStoryPeriode==="alles"?null:+igStoryPeriode;
  const inPeriode=IG.stories.filter(s=>!dagen||Date.parse(s.gepost_om)>Date.now()-dagen*864e5);
  const st=igStoryWie==="alles"?inPeriode:inPeriode.filter(s=>igStoryHerkomst(s)===igStoryWie);   // zelf gemaakt of gedeelde post (oude "onbekend" alleen bij Alles)
  const eerste=IG.stories.reduce((m,s)=>!m||s.gepost_om<m?s.gepost_om:m,null);
  if($("igStorySub"))$("igStorySub").innerHTML=`${dagen?`Laatste ${dagen} dagen`:"Allâh stories"}, per dag in de volgorde waarin je ze plaatste: zo zie je waar mensen afhaken. `
    +(igStoryWie==="eigen"?"Alleen stories zonder tekst. ":igStoryWie==="gedeeld"?"Alleen stories met tekst (bijschrift). ":"")
    +`Stories blijven hier bewaard, ook als ze na 24 uur van Insta verdwijnen (cijfers = laatste meting, vanaf 1 okt ± 10 minuten voor het einde; klein plaatje bewaard vanaf eind sep)${eerste?`; de eerste is van ${dLabel(dagNL(eerste),1)}`:""}. Tik op een story voor alle cijfâhs.`;
  if(!st.length){$("igStories").innerHTML=`<p class="sub">Nog geen stories gemeten${dagen?` in de laatste ${dagen} dagen`:""}${igStoryWie!=="alles"&&inPeriode.length?" van deze soort (kies \"Alles\")":""}. Stories worden elk uur opgehaald zolang ze online staan (24 uur).</p>`;return}
  const titels=igTrackTitels(),opties=igMuziekOpties(titels);
  // samenvatting: de middelste story (één uitschietâh telt nie te zwaar)
  const mc=st.filter(s=>s.cijfers&&s.cijfers.reach>0);
  const mLikes=med(mc.map(igStoryLikes).filter(v=>v!=null)),mLpk=med(mc.filter(s=>igStoryLikes(s)!=null).map(s=>igStoryLikes(s)/s.cijfers.reach)),mKw=med(mc.map(igStoryKwal).filter(v=>v!=null));
  const samen=mc.length?`<div class="ytstats igstorysamen">
      ${igStat("Stories",nf0.format(st.length),igStoryWie==="alles"?"in deze periode":IG_HERKOMST[igStoryWie]+", in deze periode")}
      ${igStat("Bereik",nf0.format(med(mc.map(s=>s.cijfers.reach))),"middelste story")}
      ${igStat("Likes",mLikes==null?"—":nf0.format(mLikes),mLpk==null?"middelste story":`middelste story · ${igPct1(mLpk)} van de kijkâhs`)}
      ${igStat("Kwaliteit",mKw==null?"—":igKwalF(mKw),"gedeeld per 1.000 bereik, middelste story")}</div>`:"";
  // per dag in volgorde van posten: zo zie je waar mensen afhaken
  const perDag=new Map();[...st].reverse().forEach(s=>{const d=dagNL(s.gepost_om);if(!perDag.has(d))perDag.set(d,[]);perDag.get(d).push(s)});
  let h=samen+`<div class="tablewrap"><table class="igstorytab"><thead><tr><th>Story</th><th class="n">Bereik</th><th class="n">Weergaven</th><th class="n" title="Echte likes (export Meta Business Suite) of berekend: interacties − gedeeld − reacties (gecontroleerd: klopt)">Likes</th><th class="n" title="Gedeeld per 1.000 bereik">Kwaliteit</th><th class="n">Tikte weg</th><th class="n">Reacties</th><th>Muziek</th></tr></thead><tbody>`;
  [...perDag].reverse().forEach(([d,rij])=>{
    const eersteBereik=rij[0].cijfers&&rij[0].cijfers.reach;
    rij.forEach((s,i)=>{const x=s.cijfers||{};const weg=igStoryWeg(s),lk=igStoryLikes(s),kw=igStoryKwal(s),her=igStoryHerkomst(s);
      // t.o.v. story 1 van die dag (14-10: was "108% van de 1e", nu in gewone woorden met pijltje)
      const vgl=eersteBereik&&x.reach!=null&&i?Math.round((x.reach/eersteBereik-1)*100):null;
      const vast=vgl==null?"":`<span class="stvgl ${vgl>2?"up":vgl<-2?"down":"gelijk"}" title="Bereik van deze story vergeleken met je eerste story van die dag (${nf0.format(eersteBereik)})">${vgl>2?`↑ ${vgl}% meâh`:vgl<-2?`↓ ${-vgl}% minder`:"± even veel"} dan story 1</span>`;
      const verlopen=Date.parse(s.gepost_om)<Date.now()-864e5;
      const wie=her==="gedeeld"?` <span class="chip mute" title="${esc(s.bijschrift||"")}">met tekst</span>`:"";
      const bl=igStoryBeeld(s);
      h+=`<tr data-id="${esc(s.media_id)}"${pdAttr(s,verlopen)}><td><div class="igtoprij"><span class="igthumb story" aria-hidden="true">${bl?`<img src="${esc(bl)}" alt="" loading="lazy" onerror="this.remove()">`:""}</span><div>${verlopen?`${dLabel(d)} ${tijdAms(s.gepost_om)}`:`<a href="${esc(s.permalink||"#")}" target="_blank" rel="noopener">${dLabel(d)} ${tijdAms(s.gepost_om)}</a>`} · ${i+1}/${rij.length}${wie}</div></div></td>
      <td class="n">${x.reach==null?(s.fout?'<span class="sub" title="'+esc(s.fout)+'">nog geen</span>':"—"):nf0.format(x.reach)+vast}</td><td class="n">${x.views==null?"—":nf0.format(x.views)}</td>
      <td class="n">${lk==null?"—":nf0.format(lk)}</td><td class="n">${kw==null?"—":igKwalF(kw)}</td>
      <td class="n">${weg==null?"—":pct(weg)}</td><td class="n">${x.replies==null?"—":nf0.format(x.replies)}</td>
      <td>${igMuziekSelect(labelsVan(s,"muziek")[0]||"",opties,titels,"Muziek onder deze story")}</td></tr>`})});
  const leeg=st.filter(s=>!labelsVan(s,"muziek").length).length;
  $("igStories").innerHTML=h+`</tbody></table></div><p class="sub" style="margin:10px 0 0"><b>Likes</b>: de koppeling geeft voor stories geen likes, dus rekenen we ze uit: interacties − gedeeld − reacties (gecontroleerd met Meta Business Suite op 1 okt: klopt precies). Bij stories uit de export (juli t/m 30 sep) staan de echte likes. <b>Kwaliteit</b> = gedeeld per 1.000 bereik (stories kun je nie bewaren). <b>Tikte weg</b> = deel van de weergaven waarbij iemand de stories wegtikte (hoe lager, hoe betâh). <b>Met of zonder tekst</b>: tot en met 30 sep uit de export, daarna via de koppeling. Stories uit de export hebben geen <b>Tikte weg</b> (staat nie in de export). <b>Muziek</b>: kies wat eronder zat${leeg?` (nog ${nf0.format(leeg)} zonder keuze in deze lijst)`:""}; "Andere muziek" en "Omgevingsgeluid" tellen ook mee (als zonder eigen muziek).</p>`+igStoryMuziekHTML();
}
/* ---------- stories: soort, likes en kwaliteit ----------
   Likes gevalideerd 01-10 (Meta Business Suite); herkomst = alleen tekst ja/nee:
   - Alle stories zijn van Marnix (bevestigd 30-09). We splitsen alleen op het bijschrift dat Meta meegeeft:
     null = nie gemeten (story van vóór 1 okt) → onbekend, '' → "zonder tekst", tekst → "met tekst".
     (Eerst dachten we: tekst = gedeelde post van een ander; klopte nie. De tekst lijkt op de bijschriften van stories, nie van posts.)
   - Likes: de API geeft geen likes voor stories. Wel total_interactions = likes + gedeeld + reacties (gecontroleerd 01-10 met Meta Business Suite: 4 van 4 precies goed).
     Stories uit de export (15_story_export.sql, bron 'export'/'api+export') hebben cijfers.likes = echte likes; die gaan voor.
   - Kwaliteit story = gedeeld per 1.000 bereik (stories kun je nie bewaren). */
function igStoryHerkomst(s){return s.bijschrift==null?"onbekend":String(s.bijschrift).trim()?"gedeeld":"eigen"}
const IG_HERKOMST={eigen:"zonder tekst",gedeeld:"met tekst",onbekend:"van vóór 1 okt"};
function igStoryLikes(s){const x=s.cijfers||{};if(x.likes!=null)return x.likes;return x.total_interactions==null?null:Math.max(0,x.total_interactions-(x.shares||0)-(x.replies||0))}
function igStoryKwal(s){const x=s.cijfers||{};return x.reach>0&&x.shares!=null?x.shares*1000/x.reach:null}
function igStoryWeg(s){const x=s.cijfers||{};return x.nav_weg!=null&&(x.views||x.reach)?x.nav_weg/(x.views||x.reach):null}
// eigen muziek onder stories: houdt het mensen vast? (alle bewaarde stories met cijfers en een keuze)
function igStoryMuziekHTML(){
  const g=IG.stories.filter(s=>s.cijfers&&s.cijfers.reach!=null&&labelsVan(s,"muziek").length);
  const met=g.filter(s=>!igGeenEigen(labelsVan(s,"muziek")[0])),zonder=g.filter(s=>igGeenEigen(labelsVan(s,"muziek")[0]));
  const blok=(naam,a)=>{const w=med(a.map(igStoryWeg).filter(v=>v!=null));
    return `<b>${naam}</b>: ${a.length} ${a.length===1?"story":"stories"}, middelste bereik ${nf0.format(med(a.map(s=>s.cijfers.reach))||0)}${w==null?"":`, tikte weg ${pct(w)}`}`};
  if(met.length<3||zonder.length<3)return `<p class="sub" style="margin:6px 0 0">♪ Vanaf 3 stories mét en 3 zonder eigen muziek zie je hier of je eigen muziek mensen langer vasthoudt (nu ${met.length} mét, ${zonder.length} zonder).</p>`;
  const nummers=new Map();met.forEach(s=>{const t=labelsVan(s,"muziek")[0];nummers.set(t,(nummers.get(t)||0)+1)});
  const top=[...nummers].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t,n])=>`${esc(t)} (${n}x)`).join(", ");
  return `<p class="sub igstorymz" style="margin:6px 0 0">♪ ${blok("Mét eigen muziek",met)} · ${blok("Zonder",zonder)}${top?`. Meest gebruikt: ${top}`:""}. ${zeker(Math.min(met.length,zonder.length))}</p>`;
}


// Wachtkamâh: nieuwe posts (vanaf IG_WACHT_VANAF) zonder muziek-keuze. Ze gaan eruit zodra je iets kiest (ook "Andere muziek").
const IG_WACHT_VANAF="2026-09-22";
function igWachtend(){return IG.posts.filter(p=>p.gepost_om&&dagNL(p.gepost_om)>=IG_WACHT_VANAF&&!labelsVan(p,"muziek").length)}
// stories van de laatste 2 dagen zonder muziek-keuze: zo kun je ook op de telefoon kiezen
// (de Stories-kaart zelf staat nie op de telefoon). Ouder dan 2 dagen: alleen nog via de Stories-kaart op de Mac.
const IG_WACHT_STORY_DAGEN=2;
function igWachtStories(){return (IG.stories||[]).filter(s=>s.gepost_om&&Date.parse(s.gepost_om)>Date.now()-IG_WACHT_STORY_DAGEN*864e5
  &&!labelsVan(s,"muziek").length)}
function igWachtTekst(np,ns){const d=[];if(np)d.push(`${np} post${np>1?"s":""}`);if(ns)d.push(`${ns} ${ns>1?"stories":"story"}`);return d.join(" en ")}
function igBadge(){const b=document.querySelector('nav.hoofdmenu button[data-s="insta"]');if(!b)return;
  const k=igKoppeling(),n=igWachtend().length+igWachtStories().length;let s=b.querySelector(".badge");
  if(!n&&!(k&&k.nivo==="kapot")){if(s)s.remove();return}
  if(!s){s=document.createElement("span");s.className="badge";b.appendChild(s)}
  if(k&&k.nivo==="kapot"){s.textContent="!";s.title="Insta-koppeling is stuk: maak een nieuwe sleutel";return}   // gaat voor de wachtkamer
  s.textContent=n;s.title=igWachtTekst(igWachtend().length,igWachtStories().length)+" zonder muziek-keuze";}
// Speciale muziek-keuzes (geen nummâh): "(geen)" = er zat iets anders onder, "(omgeving)" = geen muziek, alleen omgevingsgeluid (chat 25).
// Beide tellen als "zonder eigen muziek"; "(eigen muziek)" = automatisch label (wél eigen muziek, nummâh onbekend).
function igGeenEigen(l){return l==="(geen)"||l==="(omgeving)"}
function igIsNummer(l){return !!l&&l!=="(geen)"&&l!=="(omgeving)"&&l!=="(eigen muziek)"}
function igMuziekNaam(l){return l==="(geen)"?"Andere muziek":l==="(omgeving)"?"Omgevingsgeluid":l}
function igMuziekOpties(titels){
  const recent=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>titels.includes(t)).slice(0,3);
  return `<option value="">— nog niet gekozen —</option><option value="(geen)">Andere muziek</option><option value="(omgeving)">Geen muziek, alleen omgevingsgeluid</option>`+
    (recent.length?`<optgroup label="Laatst gekozen">${recent.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`:"")+
    `<optgroup label="Alle nummâhs (SoundCloud, Spotify, DJ·World, YouTube)">${titels.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`;
}
function igMuziekSelect(m,opties,titels,aria){
  return `<select class="igsel" aria-label="${aria}">${opties.replace(`value="${esc(m)}"`,`value="${esc(m)}" selected`)}${m&&!igGeenEigen(m)&&!titels.includes(m)?`<option value="${esc(m)}" selected>${esc(m)}</option>`:""}</select>`}
// eerste regel van een post-bijschrift (afgesproken 01-10): de eerste nie-lege regel, mét "Oh oh #thehague" erbij.
// Te lang? Dan kapt de CSS hem af met "…". Zweef je erover (Mac), dan zie je het hele bijschrift (title).
function igEersteRegel(t){return String(t||"").split(/\r?\n/).map(x=>x.trim()).find(x=>x)||""}
// aantikbare post/story → pop-up "Post in detail" (js/postdetail.js, chat 44). eigenFocus = rij zelf krijgt de toetsenbord-focus
// (alleen nodig als er in de rij geen link naar de post zit, bijv. een verlopen story).
function pdAttr(x,eigenFocus){
  if(!x||!x.media_id)return "";const st=soortGroep(x)==="story";
  return ` data-pd="${esc(x.media_id)}"${st?' data-pdst="1"':""}${eigenFocus?` tabindex="0" role="button" aria-haspopup="dialog" aria-label="Alle cijfâhs van deze ${st?"story":"post"}"`:""}`;
}
function igPostRij(p,opties,titels){
  const m=labelsVan(p,"muziek")[0]||"",ond=labelsVan(p,"onderwerp");
  const eff=igIsNummer(m)?igPlaysEffect(m,dagNL(p.gepost_om)):null;
  const effTxt=eff?igEffectHTML(eff):"";
  return `<div class="igpost" data-id="${esc(p.media_id)}"${pdAttr(p)}>
      <a class="igthumb" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}<span>${soortNaam(p)}</span></a>
      <div class="iginfo"><span><b>${dLabel(dagNL(p.gepost_om),1)}</b> · ${p.bereik==null?"nog geen cijfâhs":"bereik "+nf0.format(p.bereik)+(p.kwaliteit!=null?" · kwaliteit "+nf0.format(p.kwaliteit):"")}</span>
        <span class="igcap" title="${esc((p.bijschrift||"").trim())}">${esc(igEersteRegel(p.bijschrift))}</span>
        <span class="igchips">${ond.map(o=>`<span class="chip mute">${esc(o)}</span>`).join("")}${effTxt}</span></div>
      <select class="igsel" aria-label="Muziek onder deze post">${opties.replace(`value="${esc(m)}"`,`value="${esc(m)}" selected`)}${m&&!igGeenEigen(m)&&!titels.includes(m)?`<option value="${esc(m)}" selected>${esc(m)}</option>`:""}</select>
    </div>`;
}
function igStoryWachtRij(x,opties,titels){   // zelfde opmaak als een post in de wachtkamâh
  const c=x.cijfers||{},lk=igStoryLikes(x);
  return `<div class="igpost" data-id="${esc(x.media_id)}"${pdAttr(x)}>
      <a class="igthumb" href="${esc(x.permalink||"#")}" target="_blank" rel="noopener">${igStoryBeeld(x)?`<img src="${esc(igStoryBeeld(x))}" alt="" loading="lazy" onerror="this.remove()">`:""}<span>Story</span></a>
      <div class="iginfo"><span><b>${dLabel(dagNL(x.gepost_om),1)} ${tijdAms(x.gepost_om)}</b> · story${c.reach==null?" · nog geen cijfâhs":" · bereik "+nf0.format(c.reach)+(lk!=null?" · ≈ "+nf0.format(lk)+" likes":"")}</span>
        ${x.bijschrift?`<span class="igcap">${esc(x.bijschrift.slice(0,90))}</span>`:""}</div>
      ${igMuziekSelect("",opties,titels,"Muziek onder deze story")}
    </div>`;
}
function renderIgMuziek(){
  const titels=igTrackTitels(),opties=igMuziekOpties(titels);
  // 1. wachtkamâh (nieuwste eerst)
  const wacht=igWachtend(),wachtSt=igWachtStories();
  $("igWacht").hidden=!wacht.length&&!wachtSt.length;
  if(wacht.length||wachtSt.length){
    $("igWachtSub").innerHTML=`${igWachtTekst(wacht.length,wachtSt.length)} ${wacht.length+wachtSt.length>1?"wachten":"wacht"} tot je kiest welke muziek eronder zat. Kies "Andere muziek" als er iets anders onder zat, of "Geen muziek, alleen omgevingsgeluid" als je alleen het geluid van buiten hoort; dan telt hij mee bij de vergelijking.`
      +(wachtSt.length?` Stories staan hier ${IG_WACHT_STORY_DAGEN} dagen.`:"");
    $("igWachtLijst").innerHTML=wacht.map(p=>igPostRij(p,opties,titels)).join("")+wachtSt.map(x=>igStoryWachtRij(x,opties,titels)).join("");
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
  if(nieuw&&!igGeenEigen(nieuw)){const r=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>t!==nieuw);r.unshift(nieuw);store.set("hc_ig_nummers",JSON.stringify(r.slice(0,5)))}
  renderInsta();
}

/* ---------- knoppen ---------- */
document.addEventListener("change",e=>{const s=e.target.closest(".igsel");if(s)igZetMuziek(s.closest("[data-id]").dataset.id,s.value)});
document.addEventListener("click",async e=>{
  const gr=e.target.closest("#igGroep button");if(gr){igGroep=gr.dataset.v;renderInsta();return}
  const k=e.target.closest("#igKies button");if(k){igKies=k.dataset.v;renderInsta();return}
  const tp=e.target.closest("#igTopKies button");if(tp){igTopPeriode=tp.dataset.v;renderIgTop();return}
  const pm=e.target.closest("#igPostMaat button");if(pm){igPostMaat=pm.dataset.v;renderIgPostGrafiek();return}
  const to=e.target.closest("#igTopOp button");if(to){igTopOp=to.dataset.v;renderIgTop();return}
  const tk=e.target.closest("[data-igtop]");if(tk){igTopOp=tk.dataset.igtop;renderIgTop();return}
  const t5=e.target.closest("#igT5Wat button,#igT5Per button,#igT5Op button");if(t5){
    const id=t5.parentElement.id;if(id==="igT5Wat")igT5Wat=t5.dataset.v;else if(id==="igT5Per")igT5Per=t5.dataset.v;else igT5Op=t5.dataset.v;renderIgT5();return}
  const sp=e.target.closest("#igStoryKies button");if(sp){igStoryPeriode=sp.dataset.v;renderIgStories();return}
  const sw=e.target.closest("#igStoryWie button");if(sw){igStoryWie=sw.dataset.v;renderIgStories();return}
  const so=e.target.closest("#igSorteer button");if(so){igSorteer=so.dataset.v;igLabelAantal=20;renderIgMuziek();return}
  if(e.target.closest("#igMeer")){igLabelAantal+=20;renderIgMuziek();return}
  if(e.target.closest("#igAlleenLeeg")){igAlleenLeeg=!igAlleenLeeg;e.target.setAttribute("aria-pressed",igAlleenLeeg);igLabelAantal=20;renderIgMuziek();return}
  const tz=e.target.closest("[data-igterug]");if(tz){tz.disabled=true;
    const {data,error}=await sb.rpc("ig_post_terugzetten",{p_media_id:tz.dataset.igterug});
    if(error){tz.disabled=false;showMsg("Terugzetten lukte nie: "+(error.message||error),false);return}
    showMsg("Post telt weer mee. Effe verversen…",true);$("ververs").click();return}
  const l=e.target.closest("[data-iglink]");if(l){
    const url=igNieuweLink(l.dataset.iglink),uit=$("igLinkUit");if(uit){uit.value=url;uit.hidden=false}
    const ref=url.split("ref=")[1];if(ref!=="bio"){const r=JSON.parse(store.get("hc_ig_links")||"[]");r.push(ref);store.set("hc_ig_links",JSON.stringify(r.slice(-50)))}
    try{await navigator.clipboard.writeText(url);showMsg("Link gekopieerd: "+url+" — plak hem in je link-sticker.",true)}
    catch(err){if(uit)uit.select();showMsg("Kopiëren lukte nie vanzelf. Je link: "+url,false)}
    return}
});
let igRsz;addEventListener("resize",()=>{clearTimeout(igRsz);igRsz=setTimeout(()=>{if(sectie==="insta")renderInsta()},150)});

/* ---------- Status van de laatste ophaalronde (ig_live) ----------
   ig_live doet zo'n 8 stappen (profiel, bereik vandaag, volgers, posts, stories, ...). Mislukt er één,
   dan geeft hij 'fout' terug, ook al is de rest gelukt. Hier maken we onderscheid:
   ok = alles gelukt · deels = een deel gelukt · fout = niks gelukt · bezig = loopt nog. */
const IG_STAPNAAM={profiel:"volgâhs-stand",vandaag:"bereik van vandaag",volgers:"nieuwe volgâhs",posts:"posts",
  post:"cijfâhs van nieuwe posts",stories:"stories",labels:"muziek-labels",momentopname:"momentopname van het bereik"};
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
/* ---------- Bereik vandaag vs normaal (middelste van de 7 dagen ervoor) op hetzelfde tijdstip (18_bereik_uur.sql, sinds 01-10; 7 dagen sinds 04-10) ----------
   Meta geeft alleen "bereik van de Meta-dag tot nu", geen stand per uur. Daarom bewaart Supabase die stand zelf:
   elk uur op :28 (klusje instagram-bereik-uur) en bij elke ververs-ronde (ig_live). Tijd = minuten sinds de start
   van de Meta-dag (bij ons 09:00, rond de klokwissels een week 08:00), dus ook die week eerlijk.
   Vandaag = de nieuwste meting van vandaag. Per eerdere dag (7 terug) = de stand na precies evenveel minuten:
   1. een meting van gistâh binnen 2 min → die;
   2. anders rechtlijnig ingevuld tussen de metingen ervóór en erná, als die hooguit 2 uur uit elkaar liggen
      (het begin van de Meta-dag telt als 0; binnen een uur groeit het bereik vrij gelijkmatig, dus fout van hooguit een paar %);
   3. anders de dichtstbijzijnde meting als die hooguit 15 min ernaast zit;
   4. anders géén vergelijking → de oude weergave (vandaag nu al X% van heel gistâh).
   Waarom niet "dichtstbijzijnde binnen 30 min": in een druk half uur ('s avonds bij ons) komt er makkelijk 5-10% bij,
   dan zou de vergelijking scheef zijn. Invullen tussen twee uurmetingen zit veel dichter bij de echte stand.
   Beide standen zijn wat Meta op dat moment gaf (met dezelfde vertraging bij Meta), dus appels met appels. */
const IG_UUR_GAT=120, IG_UUR_MARGE=15, IG_UUR_MIN=50, IG_UUR_DAGEN=7;   // + aantal dagen terug voor het gemiddelde (04-10)   // minuten tussen 2 metingen om in te vullen, marge dichtstbijzijnde, minimaal bereik voor een %
async function igUurLaden(){   // tabel er nog nie (18 nog nie gedraaid)? dan gewoon zonder → oude weergave
  try{const {data,error}=await sb.from("ig_bereik_uur").select("dag,minuut,om,bereik").gte("dag",dagMin(vandaagLA(),IG_UUR_DAGEN)).order("om");
    if(error)return [];
    return (data||[]).map(r=>({dag:String(r.dag).slice(0,10),minuut:+r.minuut,om:r.om,bereik:+r.bereik}))}
  catch(e){return []}
}
function igStandOp(dag,m){   // bereik van Meta-dag 'dag' na m minuten, of null als we het nie eerlijk weten
  const rij=(IG.uur||[]).filter(r=>r.dag===dag).sort((a,b)=>a.minuut-b.minuut);
  if(!rij.length)return null;
  let lo=null,hi=null;
  rij.forEach(r=>{if(r.minuut<=m)lo=r;if(r.minuut>=m&&!hi)hi=r});
  if(lo&&m-lo.minuut<=2)return {v:lo.bereik,manier:"meting"};
  if(hi&&hi.minuut-m<=2)return {v:hi.bereik,manier:"meting"};
  const van=lo||{minuut:0,bereik:0};   // begin van de Meta-dag = 0 (alleen om tussen in te vullen, nooit als "dichtstbijzijnde")
  if(hi&&hi.minuut-van.minuut<=IG_UUR_GAT)
    return {v:Math.round(van.bereik+(hi.bereik-van.bereik)*(m-van.minuut)/(hi.minuut-van.minuut)),manier:"ingevuld"};
  const dichtst=[lo,hi].filter(Boolean).sort((a,b)=>Math.abs(a.minuut-m)-Math.abs(b.minuut-m))[0];
  if(dichtst&&Math.abs(dichtst.minuut-m)<=IG_UUR_MARGE)return {v:dichtst.bereik,manier:"dichtbij"};
  return null;
}
// Vandaag vs NORMAAL = de middelste (mediaan) van de 7 dagen ervoor, elk na evenveel minuten Meta-dag (04-10; was: alleen gistâh).
// Mediaan i.p.v. gemiddelde: één virale dag maakt "normaal" anders te hoog, en dan valt een goeie dag vandaag nie meer op.
// Waarom 7: dan zit elke weekdag er precies 1x in (zondag nie vergeleken met alleen zaterdag).
// Dagen zonder eerlijke stand op dat tijdstip (geen meting in de buurt) tellen nie mee; n = hoeveel wél.
function igVandaagVsGist(c){   // {nu, g (= normaal, mediaan), n, dagen, tijdNu, tijdG} of null
  const vd=(IG.uur||[]).filter(r=>r.dag===c.vandaag);if(!vd.length)return null;
  const nw=vd.reduce((a,r)=>r.minuut>a.minuut?r:a);
  const dagen=[];
  for(let i=1;i<=IG_UUR_DAGEN;i++){const d=dagMin(c.vandaag,i),st=igStandOp(d,nw.minuut);if(st)dagen.push({dag:d,v:st.v,manier:st.manier})}
  if(!dagen.length)return null;
  const g=Math.round(igMiddel(dagen.map(x=>x.v)));
  return {nu:nw.bereik,g,n:dagen.length,dagen,tijdNu:tijdAms(nw.om),tijdG:tijdAms(nw.om)};
}
// middelste waarde (bij een even aantal: gemiddelde van de 2 middelste). Eén virale dag trekt "normaal" zo nie omhoog.
function igMiddel(a){if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),h=b.length>>1;return b.length%2?b[h]:(b[h-1]+b[h])/2}
function igGemHeleDag(c){
  const per=new Map(IG.dag.map(r=>[r.dag,r.c])),w=[];
  for(let i=1;i<=IG_UUR_DAGEN;i++){const x=per.get(dagMin(c.vandaag,i));if(x&&x.reach!=null)w.push(+x.reach)}
  return w.length?Math.round(igMiddel(w)):null;
}
// regel "Bereik vandaag": getal van vandaag, of uitleg waarom het er (nog) niet is, plus gistâh ter vergelijking
function igBereikRij(c){   // geeft [kop, getal, uitleg]
  // Met momentopnamen (zie hierboven): vandaag vs gistâh op hetzelfde tijdstip, mét pijl.
  // Zonder (nog geen meting van gistâh rond dit tijdstip): de oude weergave van stap 14. Vandaag is dan nog nie klaar,
  // gistâh wel → geen ↓ zolang vandaag loopt, maar "nu al X% van gistâh"; pas als vandaag gistâh voorbij is een ↑.
  const start=igMetaStart(c.vandaag),sinds=tijdAms(start),uren=(Date.now()-start)/36e5;
  const eind=igMetaStart(dagMin(c.vandaag,-1)),rest=Math.max(0,eind-Date.now()),nog=rest<36e5?`${Math.max(1,Math.round(rest/6e4))} min`:`${Math.round(rest/36e5)} uur`;   // laatste uur in minuten (nie "nog 0 uur")
  const stapFout=igLiveStand().fouten.some(f=>igStapVan(f)==="vandaag");
  const gd=dagMin(c.vandaag,1),g=igSom(gd,gd).reach,nu=c.nu.reach;
  const fout=stapFout?` · <span class="igst-w">⚠ nieuwste stand ophalen lukte nie</span>`:"";
  let s;
  const v=igVandaagVsGist(c);
  if(v){   // eerlijk: vandaag tot nu vs gemiddelde van de 7 dagen ervoor na evenveel tijd Meta-dag (18_bereik_uur.sql) → pijl mag
    const d=v.g>=IG_UUR_MIN?v.nu/v.g-1:null,om=t=>`<span class="pc">om </span>${t}`;   // telefoon: zonder "om", zodat het op één regel past
    const vs=d==null?"":d>=1?` · <span class="up"><b>↑ ${igNf1.format(d+1)}× normaal</b></span>`:d>=0.05?` · <span class="up">↑ ${pct(d)} meer</span>`:d<=-0.05?` · <span class="down">↓ ${pct(-d)} minder</span>`
            :Math.abs(d)<0.005?" · even veel":` · ${pct(Math.abs(d))} ${d>0?"meer":"minder"}`;
    const wie=v.n>=IG_UUR_DAGEN?"normaal":`normaal (${v.n} d)`;   // normaal = middelste van 7 dagen; minder dagen met metingen → erbij zeggen
    const tip=`normaal = de middelste stand om dit tijdstip van ${v.n} ${v.n===1?"dag":"dagen"} (één uitschietâh telt zo nie mee): `+v.dagen.map(x=>`${dKort(x.dag)} ${nf0.format(x.v)}`).join(", ")
             +(v.n<IG_UUR_DAGEN?` (metingen per uur bestaan pas sinds kort; dit worden er vanzelf ${IG_UUR_DAGEN})`:"");
    const heel=igGemHeleDag(c);
    s=`<span class="ignw">vandaag ${om(v.tijdNu)}: ${nf0.format(v.nu)}</span> · <span class="ignw" title="${esc(tip)}">${wie} ${om(v.tijdG)}: ${nf0.format(v.g)}</span><span class="ignw">${vs}</span>`
     +`<br>${heel?`normaal hele dag ${nf0.format(heel)} · `:""}nog ${nog} te gaan<span class="pc"> (Meta-dag loopt tot ${tijdAms(eind)})</span>`+fout;
  }
  else if(nu!=null&&g){
    s=nu>=g?`gistâh ${nf0.format(g)} · <span class="up">↑ nu al ${pct(nu/g-1)} meer</span>`
           :`gistâh ${nf0.format(g)} · vandaag nu al ${pct(nu/g)} daarvan`;
    s+=`<br>tot nu, nog ${nog} te gaan (Meta-dag loopt tot ${tijdAms(eind)})`+fout;
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
function igVasteRijen(c,g=igGroep){   // g: Ovâhzicht-tegel geeft "foto" mee (je hoofdsoort), de Insta-tab de schakelaar
  const l=igLikes(g),k=igKwal(g),wie=" ("+IG_GROEPEN[g].kort+")";
  return [
    igBereikRij(c),
    ["Gemiddeld bereik per dag",c.bereikDag==null?"—":nf0.format(c.bereikDag),"laatste 7 dagen"+igVs(c.bereikDag,c.bereikDagV)],
    ["Nieuwe mensen",c.nieuwPct==null?"—":pct(c.nieuwPct),c.nieuwPct==null?"komt na de eerste nacht met 09b":"van je bereik volgt je (nog) nie, laatste 7 dagen"+igVsPct(c.nieuwPct,c.nieuwPctV),
      c.viewsNieuwPct!=null?` · ${pct(c.viewsNieuwPct)} van de weergaven`:""],
    ["Likes per kijkâh"+wie,l.nu==null?"—":igPct1(l.nu),igLikesUitleg(l)],
    ["Kwaliteit per post"+wie,k.nu==null?"—":igKwalF(k.nu),igKwalUitleg(k)],
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
      ${igVasteRijen(c,"foto").map(([k,v,u])=>tegelRij(k,v,u)).join("")}
      ${((np,ns)=>np+ns?tegelRij("Wachtkamâh",nf0.format(np+ns),`${igWachtTekst(np,ns)} zonder muziek-keuze`):"")(igWachtend().length,igWachtStories().length)}
      ${igStatusHTML()}
    </div>
    <button class="btn yellow" type="button" data-ga="insta">Kèk bè Insta</button>
  </article>`;
}

/* ---------- Groei, normaal en verwachte eindstand: ÉÉN plek (chat 17, 12-10-2026) ----------
   Gebruikt door de hittemetâh (igLekkerNormaal/igLekkerOordeel → igLekkerHitte) én Kansâh (kmDeel, kmKlaarNa, normaal bereik).
   Bouw geen tweede groeicurve of tweede "normaal bereik": gebruik deze functies.
   1. GROEI igGroeiDeel(p, minuten) = hoeveel van z'n eindstand heeft een post meestal na zoveel tijd (0–1).
      Standaard (terugkijktest 12-10, 11 posts): 3 u 25% · 6 u 40% · 12 u 53% · 24 u 72% · 2 d 84% · 4 d 90% · 7 d 95% · 10 d 97%.
      (Oude lijstjes: hittemetâh 12 u 62% / 24 u 80% = te snel; Kansâh 6 u 30% = te traag.)
      Per knoop wordt het je EIGEN lijstje zodra ≥ IG_GROEI.eigenMin posts op die leeftijd gemeten zijn én ≥ 10 dagen oud zijn
      (uren uit ig_post_uur = IG.pu, dagen uit ig_media_dag = KM.dag in kansen.js). Reels: zelfde lijstje (te weinig reels) → "voorzichtig".
      Tijdstip van posten zit er nog nie in: ochtendposts lopen het eerste etmaal voor, avondposts achter. Getest met een
      "nacht telt minder"-lijstje: met 4 posts met uurmetingen nog nie betâh → opnieuw testen in chat 17.1.
   2. MARGE igGroeiMarge(minuten) = hoe ver de verwachte eindstand er in de terugkijktest naast zat: 12 u ± 25% · 24 u ± 10% · 48 u ± 4% · dag 4+ ± 3%.
      igVerwacht(p, bereik, minuten) → {eind, laag, hoog, deel, marge}.
   3. NORMAAL igNormaalEind(p, {voor, zonder, g, sit}) = middelste eindbereik van je laatste IG_GROEI.normaalPosts (12) posts van dezelfde soort
      (≥ 2 dagen oud), eerlijk gemaakt voor partner: een post met partner haalt bij jou ± 2,4× zoveel (igPartnerFactor: middelste mét ÷
      middelste zonder, foto's & carrousels, 365 dagen). Volgt het seizoen vanzelf (90/120 dagen sleepte de grote zomerposts mee).
      Situatie (igSituatie): partner = minstens 1 partner die op tijd aannam (igPartnersVan, zelfde regel als Kansâh);
      nog nie gecheckt (eerste ± 3 uur) → null = "partner nog onbekend" → gemengd normaal. Rode / "nie mee samenwerke"-partner telt gewoon
      als partner: het gaat hier om bereik, nie om vertrouwen.
   4. GRENZEN igGrenzen() = hoe uitzonderlijk: verhouding eindbereik ÷ normaal van al je foto's & carrousels van het afgelopen jaar
      (elk t.o.v. het normaal van vóór die post): warm = beter dan 3 op 4 (p75), lekkâh = beste 10% (p90), fik = beste 4% (p96).
      Stand 12-10: ± 1,8× · 3,7× · 10×. Te weinig posts → IG_GROEI.grenzenStd. Reels gebruiken dezelfde grenzen ("voorzichtig").
   Rekent alles in de browser, geen extra Supabase-vragen. */
const IG_GROEI={
  // [leeftijd in minuten, deel van de eindstand]
  std:[[0,0],[60,.09],[120,.18],[180,.25],[240,.31],[360,.40],[540,.50],[720,.53],[960,.59],[1200,.65],[1440,.72],[1800,.77],[2160,.79],
       [2880,.84],[4320,.87],[5760,.90],[7200,.93],[10080,.95],[14400,.97],[20160,.99],[28800,1]],
  eigenMin:6,            // zoveel posts op een knoop → eigen waarde i.p.v. standaard
  eindNa:10,             // dagen: pas dan telt een post mee voor het eigen lijstje (eindstand ± bekend)
  marge:[[0,.6],[180,.6],[360,.35],[720,.25],[1440,.1],[2880,.05],[5760,.03],[14400,.02]],
  normaalPosts:12,       // normaal = middelste van zoveel laatste posts
  normaalMin:5,          // minder posts → geen normaal
  partnerDagen:365,partnerMin:5,partnerMax:6,
  grenzenPct:{warm:75,lekker:90,fik:96},grenzenDagen:365,grenzenMin:30,
  grenzenStd:{warm:1.6,lekker:3.5,fik:8},
  partnerCheckUur:4      // ouder dan dit zonder partner-check = solo (klusje instagram-partners-recent draait elke 3 uur)
};
const igInterp=(c,x)=>{if(x<=c[0][0])return c[0][1];for(let i=1;i<c.length;i++)if(x<=c[i][0]){const [x0,y0]=c[i-1],[x1,y1]=c[i];return y0+(y1-y0)*(x-x0)/(x1-x0)}return c[c.length-1][1]};
const igPctl=(a,p)=>{const s=[...a].sort((x,y)=>x-y);if(!s.length)return null;const i=(s.length-1)*p/100,l=Math.floor(i);return s[l]+(s[Math.min(l+1,s.length-1)]-s[l])*(i-l)};
// stand van een post op leeftijd k (minuten): uurmeting (tot 48 u, ig_post_uur) of dagmeting (vanaf 24 u, ig_media_dag)
// → {r, bron:"uur"/"dag"} of null. pu = metingen [{m, r}] (IG.pu), dg = dagmetingen [{m, r}] op leeftijd, oplopend (igDagRij).
// Zelfde regel voor het eigen groeilijstje én de Voorspel-check (chat 17.2).
function igStandOp(pu,dg,k){
  if(k<=IG_LEKKER.kaartUur*60&&pu.length){const x=igPuStand(pu,k);if(x)return {r:x.r,bron:"uur"}}
  if(k>=1440&&dg.length){let lo=null,hi=null;for(const x of dg){if(x.m<=k)lo=x;else{hi=x;break}}
    if(lo&&Math.abs(k-lo.m)<=60)return {r:lo.r,bron:"dag"};
    if(hi&&Math.abs(hi.m-k)<=60)return {r:hi.r,bron:"dag"};
    if(lo&&hi&&hi.m-lo.m<=1500)return {r:lo.r+(hi.r-lo.r)*(k-lo.m)/(hi.m-lo.m),bron:"dag"}}
  return null;
}
const igDagRij=(perDag,p,t0)=>(perDag.get(p.media_id)||[]).map(r=>({m:(Date.parse(r.om||r.dag+"T12:00:00Z")-t0)/6e4,r:r.reach})).filter(x=>x.m>0).sort((a,b)=>a.m-b.m);
// per knoop van de curve: [{id, v}] = welk deel van z'n eindstand had elke uitgegroeide post (≥ eindNa dagen) op die leeftijd
let IG_GROEI_P=null;
function igGroeiPunten(){
  const dag=(typeof KM!=="undefined"&&KM&&KM.dag)||[];
  if(IG_GROEI_P&&IG_GROEI_P.posts===IG.posts&&IG_GROEI_P.pu===IG.pu&&IG_GROEI_P.dag===dag)return IG_GROEI_P;
  const nu=Date.now(),perDag=new Map();dag.forEach(r=>{if(!perDag.has(r.id))perDag.set(r.id,[]);perDag.get(r.id).push(r)});
  const klaar=(IG.posts||[]).filter(p=>p.gepost_om&&+p.bereik>0&&nu-Date.parse(p.gepost_om)>=IG_GROEI.eindNa*864e5);
  const per=IG_GROEI.std.map(()=>[]);
  for(const p of klaar){
    const t0=Date.parse(p.gepost_om),eind=+p.bereik/igInterp(IG_GROEI.std,(nu-t0)/6e4);   // stand nu ÷ wat hij op die leeftijd meestal heeft
    const pu=(IG.pu&&IG.pu.get(p.media_id))||[],dg=igDagRij(perDag,p,t0);
    IG_GROEI.std.forEach(([k],i)=>{if(!k||k>=28800)return;
      const s=igStandOp(pu,dg,k);
      if(s&&eind>0)per[i].push({id:p.media_id,v:Math.min(1,s.r/eind)})});
  }
  return IG_GROEI_P={posts:IG.posts,pu:IG.pu,dag,perDag,klaar,per};
}
// curve uit de punten; zonder = media_id die nie mee mag tellen (Voorspel-check: eerlijk, de post voorspelt zichzelf nie)
function igGroeiCurveVan(P,zonder=null){
  let vorig=0,eigen=0;
  const curve=IG_GROEI.std.map(([k,v],i)=>{let w=v;const a=zonder?P.per[i].filter(x=>x.id!==zonder):P.per[i];
    if(k&&k<28800&&a.length>=IG_GROEI.eigenMin){w=med(a.map(x=>x.v));eigen++}
    w=Math.min(1,Math.max(vorig,w));vorig=w;return [k,w]});
  return {curve,eigen,knopen:IG_GROEI.std.length-2,n:P.klaar.length};
}
let IG_GROEI_C=null;   // cache: {P (punten), curve, eigen (aantal eigen knopen), knopen, n}
function igGroeiCurve(){
  const P=igGroeiPunten();
  if(IG_GROEI_C&&IG_GROEI_C.P===P)return IG_GROEI_C;
  return IG_GROEI_C={P,...igGroeiCurveVan(P)};
}
function igGroeiDeel(p,m){return m<=0?0:igInterp(igGroeiCurve().curve,m)}
function igGroeiMarge(m){return igInterp(IG_GROEI.marge,Math.max(0,m))}
function igGroeiKlaarNa(deel=.95){const c=igGroeiCurve().curve;   // minuten tot de post zoveel van z'n eindstand heeft (ingevuld tussen 2 punten)
  for(let i=1;i<c.length;i++)if(c[i][1]>=deel){const [m0,v0]=c[i-1],[m1,v1]=c[i];return v1===v0?m1:m0+(m1-m0)*(deel-v0)/(v1-v0)}
  return c[c.length-1][0]}
function igGroeiBron(){const c=igGroeiCurve();
  return c.eigen>=c.knopen?`groeicurve van je eigen posts`:c.eigen?`groeicurve deels van je eigen posts (${c.eigen} van ${c.knopen} punten), rest standaard`:"standaard-groeicurve (uit je eigen posts van sep/okt; wordt vanzelf je eigen curve)"}
// verwachte eindstand van post p met bereik r op leeftijd m (minuten), met marge
function igVerwacht(p,r,m){
  if(r==null||!(m>0))return null;
  const deel=igGroeiDeel(p,m);if(!(deel>0))return null;
  const eind=deel>=.99?r:r/deel,marge=deel>=.99?0:igGroeiMarge(m);
  return {eind,laag:Math.max(r,eind*(1-marge)),hoog:eind*(1+marge),deel,marge};
}
/* ---------- Voorspel-check: hoe goed klopt de verwachte eindstand? (chat 17.2, 16-10-2026) ----------
   Voor elke uitgegroeide post (≥ IG_GROEI.eindNa dagen): wat zou het dashboard voorspeld hebben na 6 u, 12 u, 24 u, 48 u en dag 4
   (stand op die leeftijd ÷ groeicurve, precies als igVerwacht), naast het echte bereik van nu.
   EERLIJK: elke post wordt voorspeld met een curve ZONDER die post (igGroeiCurveVan(P, id)), anders lijkt de check betâh dan hij is.
   Zwaar? Nee: de punten van de curve worden één keer verzameld (igGroeiPunten), per post alleen een andere middelste waarde.
   Rekent alleen, verandert niks: curve, marges (IG_GROEI.marge) en grenzen bijstellen = chat 17.1.
   → igVoorspelCheck(): {posts:[{p, pt:{minuten:{stand, verw, fout, bron}}, dagdeel}], rijen:[per leeftijd], n}; igVoorspelVan(p) = één post. */
const IG_VC={
  leeftijden:[[360,"6 u"],[720,"12 u"],[1440,"24 u"],[2880,"48 u"],[5760,"dag 4"]],
  dagVan:5,dagTot:17,   // "dag" = gepost 05:00–16:59 (Haagse tijd), "avond" = 17:00–04:59
  zeker:5,              // minder posts op een leeftijd → nog geen oordeel over de marge
  pct:80                // spreiding = zo ver zat 8 van de 10 posts d'r hooguit naast
};
const IG_VC_UUR=new Intl.DateTimeFormat("nl-NL",{timeZone:"Europe/Amsterdam",hour:"numeric",hourCycle:"h23"});
const igDagdeel=p=>{const u=+IG_VC_UUR.format(new Date(p.gepost_om));return u>=IG_VC.dagVan&&u<IG_VC.dagTot?"dag":"avond"};
let IG_VC_C=null;
function igVoorspelCheck(){
  const P=igGroeiPunten();
  if(IG_VC_C&&IG_VC_C.P===P)return IG_VC_C;
  const posts=[];
  for(const p of P.klaar){
    const t0=Date.parse(p.gepost_om),pu=(IG.pu&&IG.pu.get(p.media_id))||[],dg=igDagRij(P.perDag,p,t0);
    const c=igGroeiCurveVan(P,p.media_id).curve,pt={};let heeft=false;
    for(const [k] of IG_VC.leeftijden){
      const s=igStandOp(pu,dg,k);if(!s)continue;
      const deel=igInterp(c,k);if(!(deel>0))continue;
      const verw=deel>=.99?s.r:s.r/deel;
      pt[k]={stand:s.r,verw,fout:verw/+p.bereik-1,bron:s.bron};heeft=true;
    }
    if(heeft)posts.push({p,pt,dagdeel:igDagdeel(p),dagen:(Date.now()-t0)/864e5});
  }
  const rijen=IG_VC.leeftijden.map(([k,naam])=>{
    const f=posts.filter(x=>x.pt[k]).map(x=>x.pt[k].fout),abs=f.map(Math.abs);
    const groep=d=>{const g=posts.filter(x=>x.pt[k]&&x.dagdeel===d).map(x=>x.pt[k].fout);return {n:g.length,med:g.length?med(g):null}};
    const marge=igGroeiMarge(k),spreid=abs.length?igPctl(abs,IG_VC.pct):null;
    const oordeel=f.length<IG_VC.zeker?"weinig":spreid>marge*1.15?"krap":spreid<marge*.5?"ruim":"past";
    return {k,naam,n:f.length,med:f.length?med(f):null,spreid,hoog:f.filter(x=>x>0).length,laag:f.filter(x=>x<0).length,
      marge,oordeel,dag:groep("dag"),avond:groep("avond")};
  });
  return IG_VC_C={P,posts,rijen,n:posts.length,klaar:P.klaar.length};
}
function igVoorspelVan(p){return p&&igVoorspelCheck().posts.find(x=>x.p.media_id===p.media_id)||null}

// partners die op tijd aannamen (Accepted, nie weggehaald, binnen 3 dagen na de post) — de enige regel; Kansâh gebruikt hem ook
let IG_PI=null,IG_PI_BRON=null,IG_PC=null,IG_PC_BRON=null;
function igPartnersVan(x){
  const lijst=(typeof IGS!=="undefined"&&IGS&&IGS.partners)||[];
  if(IG_PI_BRON!==lijst){IG_PI_BRON=lijst;IG_PI=new Map();
    lijst.forEach(r=>{if(r.status!=="Accepted"||r.weg)return;if(!IG_PI.has(r.media_id))IG_PI.set(r.media_id,[]);IG_PI.get(r.media_id).push(r)})}
  const t=Date.parse(x.gepost_om);
  return [...new Set((IG_PI.get(x.media_id)||[]).filter(r=>!(r.aangenomen_om&&Date.parse(r.aangenomen_om)-t>3*864e5)).map(r=>r.partner))].sort();
}
// "partner" / "solo" / null (= nog nie gecheckt: post jonger dan IG_GROEI.partnerCheckUur zonder regel in ig_partner_post)
function igSituatie(x,nu=Date.now()){
  if(!x||!x.gepost_om)return null;
  if(igPartnersVan(x).length)return "partner";
  const pp=(typeof IGS!=="undefined"&&IGS&&IGS.posts)||[];
  if(IG_PC_BRON!==pp){IG_PC_BRON=pp;IG_PC=new Set(pp.map(r=>r.media_id))}
  return IG_PC.has(x.media_id)||nu-Date.parse(x.gepost_om)>IG_GROEI.partnerCheckUur*36e5?"solo":null;
}
// hoeveel meer haalt een post met partner? (foto's & carrousels, IG_GROEI.partnerDagen vóór 'voor', posts ≥ 2 dagen oud)
const IG_PF_C=new Map();
function igPartnerFactor(voor=Date.now()){
  const sl=Math.floor(voor/864e5)+"|"+(IG.posts||[]).length+"|"+((typeof IGS!=="undefined"&&IGS&&IGS.partners)||[]).length;
  if(IG_PF_C.has(sl))return IG_PF_C.get(sl);
  const oud=Date.now()-2*864e5,van=voor-IG_GROEI.partnerDagen*864e5,met=[],zonder=[];
  igPostsVan("foto").forEach(q=>{const t=Date.parse(q.gepost_om);if(!(t<voor&&t>=van&&t<oud&&+q.bereik>0))return;
    (igSituatie(q)==="partner"?met:zonder).push(+q.bereik)});
  const f=met.length>=IG_GROEI.partnerMin&&zonder.length>=IG_GROEI.partnerMin?Math.max(1,Math.min(IG_GROEI.partnerMax,med(met)/med(zonder))):null;
  const uit={f,met:met.length,zonder:zonder.length};IG_PF_C.set(sl,uit);return uit;
}
/* normaal eindbereik voor post p (of zonder p: geef g + sit mee). Opties: voor = alleen posts van vóór dit tijdstip (standaard: vóór p),
   zonder = Set met media_id's die nie mee mogen tellen (Kansâh: posts van andere challenges), sit = situatie (standaard igSituatie(p)).
   → {waarde, n, sinds, sit, factor, genoeg, gemengd} */
function igNormaalEind(p,{voor=null,zonder=null,g=null,sit}={}){
  g=g||soortGroep(p);
  if(voor==null)voor=p&&p.gepost_om?Date.parse(p.gepost_om):Date.now();
  if(sit===undefined)sit=p?igSituatie(p):null;
  const oud=Date.now()-2*864e5;
  const pool=igPostsVan(g).filter(q=>q!==p&&q.gepost_om&&+q.bereik>0&&Date.parse(q.gepost_om)<voor&&Date.parse(q.gepost_om)<oud&&!(zonder&&zonder.has(q.media_id)))
    .sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om)).slice(0,IG_GROEI.normaalPosts);
  if(pool.length<IG_GROEI.normaalMin)return {waarde:null,n:pool.length,sinds:null,sit,factor:null,genoeg:false,gemengd:true};
  const F=igPartnerFactor(voor).f,sinds=pool[pool.length-1].gepost_om;
  if(!F||sit==null)return {waarde:med(pool.map(q=>+q.bereik)),n:pool.length,sinds,sit,factor:F,genoeg:true,gemengd:true};
  const lvl=med(pool.map(q=>+q.bereik/(igSituatie(q)==="partner"?F:1)));
  return {waarde:sit==="partner"?lvl*F:lvl,n:pool.length,sinds,sit,factor:F,genoeg:true,gemengd:false};
}
// grenzen warm / lekkâh / fik als "× je normaal", uit je eigen posts van het afgelopen jaar
let IG_GRENZEN_C=null;
function igGrenzen(){
  const sl=(IG.posts||[]).length+"|"+((typeof IGS!=="undefined"&&IGS&&IGS.partners)||[]).length+"|"+Math.floor(Date.now()/864e5);
  if(IG_GRENZEN_C&&IG_GRENZEN_C.sl===sl)return IG_GRENZEN_C;
  const nu=Date.now(),r=[];
  igPostsVan("foto").forEach(q=>{const t=Date.parse(q.gepost_om);if(!(t>nu-IG_GROEI.grenzenDagen*864e5&&t<nu-2*864e5&&+q.bereik>0))return;
    const n=igNormaalEind(q);if(n.genoeg&&n.waarde>0)r.push(+q.bereik/n.waarde)});
  const P=IG_GROEI.grenzenPct,S=IG_GROEI.grenzenStd;
  let G=r.length>=IG_GROEI.grenzenMin?{warm:igPctl(r,P.warm),lekker:igPctl(r,P.lekker),fik:igPctl(r,P.fik),eigen:true}:{...S,eigen:false};
  G.warm=Math.max(1.1,G.warm);G.lekker=Math.max(G.warm*1.2,G.lekker);G.fik=Math.max(G.lekker*1.3,G.fik);
  return IG_GRENZEN_C={...G,n:r.length,sl};
}

/* ---------- Hittemetâh: hoe heet is mijn nieuwe post? (12-10, chat 32; regels vernieuwd in chat 17) ----------
   Supabase meet elke nieuwe post tot 48 uur na het posten elk uur (klusje instagram-post-uur op :10) en
   ook bij elke ververs-ronde (ig_live → ig_media_dag → trigger). Tabel ig_post_uur: leeftijd in minuten + cijfers (25_post_uur.sql).
   REGELS (chat 17; staan in igLekkerNormaal en igLekkerOordeel, op basis van het blok "Groei, normaal en verwachte eindstand" hierboven):
     verwachte eindstand = bereik nu ÷ igGroeiDeel (hoeveel een post op die leeftijd meestal al heeft)
     snel (× je normaal) = verwachte eindstand ÷ igNormaalEind (eigen soort, eigen situatie met/zonder partner)
     warm / lekkâh / fik = snel ≥ igGrenzen().warm / .lekker / .fik (beter dan 3 op 4 · beste 10% · beste 4% van je posts)
   Vervallen (chat 17, terugkijktest 12-10): vaste grenzen 500 kijkâhs / 2× / 20 likes en "likes per kijkâh ≥ normaal"
   (grote posts hebben juist mínder likes per kijkâh). Delen + bewaren voor de fik → chat 27. Likes blijven als info op de kaart.
   DE METÂH leest ALLEEN igLekkerHitte(p): temperatuur 0–100, fase, wat nog mist, afkoelen, verloop.
   Chat 27 (per soort, ook stories) verandert de regels via igLekkerNormaal/igLekkerOordeel/igLekkerHitte; igHitteHTML blijft.
   Reels: weinig data → altijd "voorzichtig". Stories doen nog nie mee (komt in chat 27). Verwijderde posts tellen nie (igPostsVan/IG.posts). */
const IG_LEKKER={
  kaartUur:48,           // uurmetingen ophalen tot zo oud
  minMinuut:60,          // jonger dan een uur: nog nie beoordelen (Meta loopt in het begin achter)
  zeker:IG_GROEI.normaalPosts   // normaal rust op minder posts → "voorzichtig"
};
async function igPostUurLaden(){   // Map media_id → metingen [{m, r, l, om}] op leeftijd; tabel er nog nie (25 nie gedraaid)? → leeg
  const uit=new Map();
  try{
    const since=new Date(Date.now()-130*864e5).toISOString();
    const rij=await igAlles(()=>sb.from("ig_post_uur").select("media_id,om,minuut,bereik:cijfers->reach,likes:cijfers->likes")
      .gte("om",since).lte("minuut",IG_LEKKER.kaartUur*60).is("fout",null).order("om"));
    rij.forEach(x=>{if(x.bereik==null||isNaN(+x.bereik))return;
      const a=uit.get(x.media_id)||[];a.push({m:+x.minuut,r:+x.bereik,l:x.likes==null?null:+x.likes,om:x.om});uit.set(x.media_id,a)});
    uit.forEach(a=>a.sort((p,q)=>p.m-q.m));
  }catch(e){}
  return uit;
}
// stand van een eerdere post na m minuten: meting binnen 10 min, anders ingevuld tussen 2 metingen die ≤ 3 uur uit elkaar liggen
// (het moment van posten telt als 0), anders null (dan telt die post nie mee)
function igPuStand(rij,m){
  let lo={m:0,r:0,l:0},hi=null;
  for(const x of rij){if(x.m<=m)lo=x;else{hi=x;break}}
  if(lo.m>0&&m-lo.m<=10)return lo;
  if(hi&&hi.m-m<=10)return hi;
  if(!hi||hi.m-lo.m>180)return null;
  const f=(m-lo.m)/(hi.m-lo.m);
  return {m,r:lo.r+(hi.r-lo.r)*f,l:lo.l==null||hi.l==null?null:lo.l+(hi.l-lo.l)*f};
}
// wat is normaal voor post p op leeftijd m (minuten)? → {g, eind (normaal eindbereik), verwacht (normaal op deze leeftijd), deel, n, sit, factor, grenzen, likesPk, voorzichtig}
function igLekkerNormaal(p,m){
  const g=soortGroep(p),ne=igNormaalEind(p);
  if(!ne.genoeg||!(ne.waarde>0))return null;
  const deel=igGroeiDeel(p,m),t0=Date.parse(p.gepost_om);
  const oud=igPostsVan(g).filter(q=>q.gepost_om&&Date.parse(q.gepost_om)<t0&&Date.parse(q.gepost_om)<Date.now()-2*864e5);
  const nl=igNormaal(g,q=>+q.bereik>0&&q.likes!=null?(+q.likes)/(+q.bereik):null,{posts:oud,dagen:[90,365,null]});   // alleen als info op de kaart
  return {g,eind:ne.waarde,verwacht:ne.waarde*deel,deel,n:ne.n,sit:ne.sit,factor:ne.factor,gemengd:ne.gemengd,grenzen:igGrenzen(),
          likesPk:nl.genoeg?nl.waarde:null,voorzichtig:g==="reel"||ne.n<IG_LEKKER.zeker};
}
function igLekkerOordeel(p,x){   // x = meting {m, r, l}
  const N=igLekkerNormaal(p,x.m);if(!N||!(N.verwacht>0))return null;
  const snel=x.r/N.verwacht,lpk=x.l!=null&&x.r>0?x.l/x.r:null,G=N.grenzen,V=igVerwacht(p,x.r,x.m);
  return {N,snel,lpk,V,warm:snel>=G.warm,lekker:snel>=G.lekker,fik:snel>=G.fik};
}
/* ---- Temperatuur (chat 17; schaal Marnix 12-10 blijft: Normaal 30 · Warm 45 · Lekkâh 70 · Fik 100) ----
   snel = verwachte eindstand ÷ je normaal. 0,5× = 0% · 1× = 30% (Normaal) · grens warm = 45% · grens lekkâh = 70% · grens fik = 100%
   (grenzen uit je eigen posts: igGrenzen). Daartussen glijdend (op een log-schaal: 2× zo snel voelt overal even veel heter).
   ---- Afkoelen (keuze Marnix 12-10, na de terugkijktest) ----
   Meetpunten = elk heel uur + de laatste meting. Het kwik "zakt" als hij > 3% trager gaat dan bij het vorige meetpunt (t.o.v. normaal).
   Weg als het 2 meetpunten op rij zakt én hij dan trager gaat dan normaal (< 1×). Eén trage meting kan toeval zijn: dan blijft hij staan.
   Zakken tussen 01:00 en 07:00 telt nie mee (dan zakt elke post en 's ochtends trekt hij weer bij).
   ---- Opleven (keuze Marnix 12-10) ----
   Weg is nie voorgoed: gaat een verdwenen post 2 meetpunten op rij > 3% sneller (ook 's nachts: dat is juist bijzonder) én weer
   minstens even snel als normaal, dan komt hij terug met "Leeft weer op!". Daarna geldt de afkoelregel weer.
   De metâh volgt een post tot IG_HITTE.maxUur (48): zolang meet Supabase elk uur (ig_post_uur). Opleven ná 48 uur → actie 32.2. */
const IG_HITTE={
  lekker:70,                       // streepje Lekkâh
  streepjes:[[30,"Normaal"],[45,"Warm"],[70,"Lekkâh"],[100,"Fik"]],
  zakMarge:.03,                    // zakken = meer dan 3% trager dan het vorige meetpunt
  zakKeer:2,                       // zoveel keer op rij zakken (én onder normaal) = weg
  stijgKeer:2,                     // zoveel keer op rij > zakMarge sneller (én ≥ 1× normaal) = verdwenen post komt terug ("Leeft weer op!")
  maxUur:48,                       // de metâh volgt een post zo lang (= zolang ig_post_uur elk uur meet, IG_LEKKER.kaartUur)
  nachtVan:1,nachtTot:7,           // meetpunten tussen 01:00 en 07:00 (Den Haag) tellen nie mee voor het zakken
  kleuren:[[0,[74,149,236]],[30,[92,194,117]],[45,[245,197,24]],[70,[240,122,63]],[100,[217,67,47]]]   // zee-blauw → groen → geel → oranje → rood
};
const IG_HITTE_FASE={
  wacht:{kop:"Nieuwe post: effe wachte…",naam:"wacht op meting",icoon:"⏳"},
  koud:{kop:"Nog lauw",naam:"lauw",icoon:"·"},
  normaal:{kop:"Loopt normaal",naam:"normaal",icoon:"→"},
  warm:{kop:"Wordt warm!",naam:"warm",icoon:"↗"},
  lekker:{kop:"Gaat lekkâh!",naam:"lekkâh",icoon:"↗"},
  fik:{kop:"In de fik!",naam:"in de fik",icoon:"🔥"}};
const IG_HITTE_UUR=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",hour:"2-digit",hourCycle:"h23"});
function igIsNacht(ts){const h=+IG_HITTE_UUR.format(ts)%24;return h>=IG_HITTE.nachtVan&&h<IG_HITTE.nachtTot}
function igHitteKleur(t){const k=IG_HITTE.kleuren;t=Math.max(0,Math.min(100,t));
  for(let i=1;i<k.length;i++)if(t<=k[i][0]){const [a,ca]=k[i-1],[b,cb]=k[i],f=(t-a)/(b-a);
    return "rgb("+ca.map((c,j)=>Math.round(c+(cb[j]-c)*f)).join(",")+")"}
  return "rgb("+k[k.length-1][1].join(",")+")";
}
// temperatuur van één meting: o = igLekkerOordeel(p, x), x = {m, r, l}
function igHitteTemp(o,x){
  const G=o.N.grenzen,s=o.snel;
  if(o.fik)return {t:100};
  const pts=[[.5,0],[1,30],[G.warm,45],[G.lekker,70],[G.fik,100]];
  if(!(s>pts[0][0]))return {t:0};
  for(let i=1;i<pts.length;i++)if(s<=pts[i][0]){const [a,ta]=pts[i-1],[b,tb]=pts[i];
    return {t:Math.min(99,ta+(tb-ta)*Math.log(s/a)/Math.log(b/a))}}
  return {t:99};
}
function igHitteFase(t,o){return o.fik?"fik":o.lekker?"lekker":t>=45?"warm":t>=30?"normaal":"koud"}
// wat mist nog in gewone woorden: hoe ver is de verwachte eindstand van de volgende grens?
function igHitteMist(o,x){
  const N=o.N,G=N.grenzen,V=o.V;
  if(o.fik)return [];
  const doel=o.lekker?{n:"fik",x:G.fik,w:"je beste 4%"}:{n:"lekkâh",x:G.lekker,w:"je beste 10%"};
  const nodig=N.eind*doel.x;
  return [`verwachte eindstand ± ${nf0.format(Math.round(V?V.eind:x.r/N.deel))} kijkâhs; ${doel.n} = ± ${nf0.format(Math.round(nodig/50)*50)} of meâh (${igNf1.format(doel.x)}× je normaal, ${doel.w})`];
}
/* DE functie voor de metâh. Geeft null (geen metâh) of:
   {p, g, leeftijd (min), fase, t (0–100 nu), van (t vorige meetpunt), punten [{m, r, l, om, snel, lpk, o, t, fase, nacht, zakt, stijgt, weg}],
    nu (laatste punt), N (normaal), mist [teksten], koelt, nachtrust, weg (nu weg), wegNa (min, laatste keer weg), opgeleefd (terug na weg), voorzichtig}
   koelt = zakt nu én het kwik staat lager dan bij het vorige meetpunt (overdag); nachtrust = idem tussen 01:00 en 07:00.
   fase "wacht" = nog geen meting van minstens IG_LEKKER.minMinuut (Meta loopt ± 1 uur achter). Stories → null (chat 27).
   Ouder dan IG_HITTE.maxUur → null. */
function igLekkerHitte(p,nu=Date.now()){
  if(!p||!p.gepost_om)return null;
  const g=soortGroep(p);if(g==="story")return null;
  const t0=Date.parse(p.gepost_om),leeftijd=(nu-t0)/6e4;
  if(!(leeftijd>=0)||leeftijd>=IG_HITTE.maxUur*60)return null;
  const rij=((IG.pu||new Map()).get(p.media_id)||[]).filter(x=>x.m<=leeftijd+5);
  const basis={p,g,leeftijd,fase:"wacht",t:0,van:0,punten:[],nu:null,N:null,mist:[],koelt:false,nachtrust:false,weg:false,wegNa:null,opgeleefd:false,voorzichtig:g==="reel"};
  const laatst=rij[rij.length-1];
  if(!laatst||laatst.m<IG_LEKKER.minMinuut)return basis;
  const pts=[];   // elk heel uur (echte meting binnen 10 min, anders ingevuld tussen 2 metingen) + de laatste meting
  for(let h=1;h*60<=laatst.m+10;h++){const x=igPuStand(rij,h*60);if(x)pts.push({m:Math.min(h*60,laatst.m),r:x.r,l:x.l,om:x.om||null})}
  if(!pts.length||laatst.m-pts[pts.length-1].m>10)pts.push({m:laatst.m,r:laatst.r,l:laatst.l,om:laatst.om||null});
  const punten=[];let zak=0,stijg=0,weg=false,wegNa=null,opgeleefd=false;
  for(const x of pts){
    const o=igLekkerOordeel(p,x);if(!o)continue;
    const T=igHitteTemp(o,x),nacht=igIsNacht(t0+x.m*6e4),vorig=punten[punten.length-1];
    const zakt=!!vorig&&o.snel<vorig.snel*(1-IG_HITTE.zakMarge),stijgt=!!vorig&&o.snel>vorig.snel*(1+IG_HITTE.zakMarge);
    if(!nacht)zak=zakt?zak+1:0;   // 's nachts zakken: telt nie mee (ook nie als "weer gestegen")
    stijg=stijgt?stijg+1:0;        // stijgen telt altijd, ook 's nachts
    if(!weg&&zak>=IG_HITTE.zakKeer&&o.snel<1){weg=true;wegNa=x.m;opgeleefd=false;stijg=0}
    else if(weg&&stijg>=IG_HITTE.stijgKeer&&o.snel>=1){weg=false;opgeleefd=true;zak=0}
    const t=Math.round(T.t);   // hele procenten: wat je op de bol ziet, bepaalt ook de fase
    punten.push({m:x.m,r:x.r,l:x.l,om:x.om,snel:o.snel,lpk:o.lpk,o,t,fase:igHitteFase(t,o),nacht,zakt,stijgt,weg});
  }
  if(!punten.length)return null;   // geen normaal (te weinig eerdere posts in deze groep)
  const n=punten[punten.length-1],v=punten[punten.length-2];
  return {...basis,fase:n.fase,t:n.t,van:v?v.t:0,punten,nu:n,N:n.o.N,mist:igHitteMist(n.o,n),
    koelt:!!v&&n.zakt&&!n.nacht&&n.t<v.t-1,nachtrust:!!v&&n.zakt&&n.nacht&&n.t<v.t-1,weg,wegNa,opgeleefd,voorzichtig:n.o.N.voorzichtig};
}
function igHitteLijst(nu=Date.now()){
  return (IG.posts||[]).map(p=>igLekkerHitte(p,nu)).filter(h=>h&&!h.weg)
    .sort((a,b)=>(b.t-a.t)||(Date.parse(b.p.gepost_om)-Date.parse(a.p.gepost_om)));   // heetste eerst, dan de jongste
}
function igLeeftijd(m){return m<120?`${Math.round(m)} min oud`:`${Math.floor(m/60)} uur oud`}
function igHitteUurLabel(m){return m<120?`${Math.round(m)} min`:`${Math.floor(m/60)} u`}
// de thermometer zelf (HTML + CSS; animatie: kwik van de vorige meting naar nu)
function igHitteMeterHTML(h){
  const t=Math.round(h.t),van=Math.round(h.van),F=IG_HITTE_FASE[h.fase];
  const bel=h.t>=45&&h.fase!=="wacht"?`<i></i><i></i><i></i><i></i>`:"";
  return `<div class="hmeter" role="img" aria-label="Hittemetâh: ${t}% (${esc(F.naam)})" style="--van:${van}%;--naar:${t}%;--kleur:${igHitteKleur(h.t)}">
    <div class="hbuis"><div class="hkwik">${bel}</div>
      ${IG_HITTE.streepjes.map(([v,n])=>`<span class="hstreep${h.t>=v&&h.fase!=="wacht"?" aan":""}" style="bottom:calc(4% + ${v*.96}%)"><em>${n}</em></span>`).join("")}
      ${h.fase==="fik"?`<div class="hvlam" aria-hidden="true"><i></i><i></i><i></i></div>`:""}</div>
    <div class="hbol"><b>${h.fase==="wacht"?"…":t+"%"}</b></div>
  </div>`;
}
// verloop: één staafje per meetpunt op leeftijd 0–24 uur; aanwijzen/tikken = "2 u · 45% warm" (staafGetal, zoals de andere grafieken)
function igHitteVerloopHTML(h){
  if(h.punten.length<2)return "";
  const W=300,H=64,top=10,bodem=50,uren=IG_HITTE.maxUur,x=m=>m/60/uren*W,y=t=>bodem-(bodem-top)*Math.max(2,t)/100,sw=W/uren,bw=Math.max(3,Math.min(5,sw-1.5));
  const lijnen=IG_HITTE.streepjes.filter(([v])=>v<100).map(([v])=>`<line class="grid" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join("");
  const staaf=h.punten.map(pt=>{const xm=Math.min(W-3,Math.max(3,x(pt.m)));
    return `<rect x="${(xm-bw/2).toFixed(1)}" y="${y(pt.t).toFixed(1)}" width="${bw.toFixed(1)}" height="${(bodem-y(pt.t)).toFixed(1)}" rx="1.5" fill="${igHitteKleur(pt.t)}"${pt.weg?` fill-opacity=".3"`:pt.nacht?` fill-opacity=".55"`:""}/>`}).join("");
  const hits=h.punten.map(pt=>{const xm=Math.min(W-3,Math.max(3,x(pt.m)));
    return `<rect class="hit" x="${(xm-sw/2).toFixed(1)}" y="0" width="${sw.toFixed(1)}" height="${bodem}"${staafGetal(xm,y(pt.t),`${Math.round(pt.t)}% ${IG_HITTE_FASE[pt.fase].naam}${pt.weg?" (afgekoeld)":pt.nacht?" (nacht)":""}`,igHitteUurLabel(pt.m))}/>`}).join("");
  const as=[0,1,2,3,4].map(i=>i*uren/4).map(u=>`<text x="${Math.min(W-6,Math.max(6,x(u*60)))}" y="${H-2}" text-anchor="middle">${u} u</text>`).join("");
  return `<div class="chart hverloop"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verloop van de temperatuur per meting">${lijnen}<line class="base" x1="0" x2="${W}" y1="${bodem}" y2="${bodem}"/>${staaf}${as}${hits}</svg></div>`;
}
// mini-verloop voor de ingeklapte kaart (14-10): doorlopende lijn + vlak (altijd aaneengesloten, ook bij 2 metingen),
// van de eerste tot de laatste meting; kleur loopt mee met de hoogte (zelfde kleuren als de thermometer); streepje = normaal (30%)
let igMiniNr=0;
function igHitteMiniHTML(h){
  const pts=h.punten||[];if(pts.length<2)return "";
  const W=220,H=80,top=8,bodem=64,m0=pts[0].m,m1=Math.max(pts[pts.length-1].m,m0+1),
    x=m=>6+(W-12)*(m-m0)/(m1-m0),y=t=>bodem-(bodem-top)*Math.max(2,Math.min(100,t))/100,id="hkg"+(++igMiniNr);
  const xy=pts.map(pt=>[x(pt.m),y(pt.t)]);
  // vloeiende lijn (monotone, schiet nie boven/onder de metingen uit)
  const n=xy.length,d=[];for(let i=0;i<n-1;i++)d.push((xy[i+1][1]-xy[i][1])/(xy[i+1][0]-xy[i][0]));
  const tg=xy.map((_,i)=>i===0?d[0]:i===n-1?d[n-2]:(d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2));
  let lijn=`M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for(let i=0;i<n-1;i++){const [x0,y0]=xy[i],[x1,y1]=xy[i+1],dx=(x1-x0)/3;
    lijn+=` C${(x0+dx).toFixed(1)},${(y0+tg[i]*dx).toFixed(1)} ${(x1-dx).toFixed(1)},${(y1-tg[i+1]*dx).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`}
  const vlak=`${lijn} L${xy[n-1][0].toFixed(1)},${bodem} L${xy[0][0].toFixed(1)},${bodem} Z`;
  const kl=[[0,"#4a95ec"],[30,"#5cc275"],[45,"#f5c518"],[70,"#f07a3f"],[100,"#d9432f"]];
  const grad=`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${y(0)}" y2="${y(100)}">${kl.map(([v,k])=>`<stop offset="${v}%" stop-color="${k}"/>`).join("")}</linearGradient>
    <linearGradient id="${id}v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
    <mask id="${id}m"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id}v)"/></mask>`;
  const [xl,yl]=xy[n-1],laatste=pts[n-1];
  const hits=pts.map((pt,i)=>{const l=i?(xy[i][0]+xy[i-1][0])/2:0,r=i<n-1?(xy[i][0]+xy[i+1][0])/2:W;
    return `<rect class="hit" x="${l.toFixed(1)}" y="0" width="${(r-l).toFixed(1)}" height="${bodem}"${staafGetal(xy[i][0],xy[i][1],`${Math.round(pt.t)}% ${IG_HITTE_FASE[pt.fase].naam}${pt.nacht?" (nacht)":""}`,igHitteUurLabel(pt.m))}/>`}).join("");
  const yN=y(30).toFixed(1);
  return `<div class="chart hkgraf"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verloop van de temperatuur, ${n} metingen, nu ${Math.round(laatste.t)}%"><defs>${grad}</defs>
    <line class="grid" x1="0" x2="${W}" y1="${yN}" y2="${yN}"/><text x="6" y="${(pts[0].t>=30?+yN+9:+yN-3).toFixed(1)}" class="hknorm">normaal</text>
    <line class="base" x1="0" x2="${W}" y1="${bodem}" y2="${bodem}"/>
    <path class="hkvlak" d="${vlak}" fill="url(#${id})" mask="url(#${id}m)"/>
    <path class="hklijn" d="${lijn}" pathLength="1" fill="none" stroke="url(#${id})" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle class="hkpuls" cx="${xl.toFixed(1)}" cy="${yl.toFixed(1)}" r="4" fill="${igHitteKleur(laatste.t)}"/>
    <circle cx="${xl.toFixed(1)}" cy="${yl.toFixed(1)}" r="3.5" fill="${igHitteKleur(laatste.t)}" stroke="var(--surface)" stroke-width="1.5"/>
    <text x="6" y="${H-2}">${igHitteUurLabel(pts[0].m)}</text><text x="${W-6}" y="${H-2}" text-anchor="end">${igHitteUurLabel(laatste.m)}</text>${hits}</svg></div>`;
}
function igHitteKaartHTML(h){
  const p=h.p,G=IG_GROEPEN[h.g],F=IG_HITTE_FASE[h.fase],x=h.nu,N=h.N;
  const post=`<div class="hpost"${pdAttr(p)}><a class="igthumb klein" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</a>
      <p><b>${soortNaam(p)} · ${igLeeftijd(h.leeftijd)}</b><span class="pc"> · ${esc(igEersteRegel(p.bijschrift).slice(0,70))}</span></p></div>`;
  let midden;
  if(h.fase==="wacht"){
    midden=`<p>Geplaatst om ${tijdAms(p.gepost_om)}. Meta loopt in het begin ± 1 uur achter: na de eerste meting gaat de metâh lopen.</p>`;
  }else{
    const normTxt=`normaal ± ${nf0.format(Math.round(x.r/x.snel))} na ${igHitteUurLabel(x.m).replace(" u"," uur")}`;
    const likesTxt=x.l==null?"likes nog nie bekend":`${nf0.format(Math.round(x.l))} likes · likes per kijkâh ${x.lpk==null?"?":igPct1(x.lpk)}${N.likesPk!=null?` (normaal ${igPct1(N.likesPk)})`:""}`;
    const mistKop=h.fase==="fik"?"":h.fase==="lekker"?"Voâh de fik:":"Voâh lekkâh:";
    const sitTxt=N.sit==="partner"?"met partner":N.sit==="solo"?"zonder partner":"partner nog onbekend";
    midden=`<p class="hgetal"><b class="lkx">${igNf1.format(x.snel)}×</b> zo snel as normaal${h.koelt?` <span class="chip hkoel">koelt af</span>`:h.nachtrust?` <span class="chip mute">'s nachts rustig</span>`:""}</p>
      <p>${nf0.format(Math.round(x.r))} kijkâhs · ${normTxt} <span class="chip mute">${sitTxt}</span></p>
      <p>${likesTxt}</p>
      <p class="hmist">${h.fase==="fik"?`<b>Bij je beste 4%!</b> Verwachte eindstand ± ${nf0.format(Math.round(x.o.V?x.o.V.eind:x.r/N.deel))} kijkâhs.`:`<b>${mistKop}</b> ${esc(h.mist.join(" · "))}`}</p>
      ${h.voorzichtig?`<p class="lksub"><span class="chip">voorzichtig</span> ${h.g==="reel"?"Je hebt maar weinig reels, dus":`Je normaal rust op maar ${N.n} ${G.kort}, dus`} neem 't met een korreltje zout.</p>`:""}`;
  }
  const tip={wacht:"",koud:"Nog rustig. Gaat-ie 2 metingen op rij trager dan normaal, dan verdwijnt de metâh vanzelf.",
    normaal:"Loopt as een gewone post.",warm:"Hij wordt warm: reageer op de reacties, dan blijft-ie lopen.",
    lekker:"Tip: deel 'm nâh in je story, nâh 't loopt!",fik:"Deel 'm nâh in je story en reageer op de reacties!"}[h.fase];
  const onder=[tip,x&&x.om?`gemeten ${tijdAms(x.om)}`:""].filter(Boolean).join(" · ");
  const opKop=h.opgeleefd&&["koud","normaal","warm"].includes(h.fase);   // terug na afkoelen: kop "Leeft weer op!" (bij lekkâh/fik een chip)
  // ingeklapt (14-10): alleen foto + thermometer + score, met een animatie die past bij de temperatuur
  const t=Math.round(h.t),anim=h.koelt?"koud":h.fase;
  const animIn={wacht:"<i></i>",koud:"<i>❄</i><i>❄</i><i>❄</i><i>❄</i>",normaal:"",warm:"<i></i><i></i><i></i>",lekker:"<i></i><i></i><i></i><i></i><i></i>",fik:"<i></i><i></i><i></i><i></i>"}[anim]||"";
  const kort=`<div class="hkort">${igHitteMeterHTML(h)}
    <div class="hkfoto a-${anim}"${pdAttr(p)}><a class="igthumb" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}</a><span class="hkanim" aria-hidden="true">${animIn}</span></div>
    <div class="hkscore"><b>${h.fase==="wacht"?"…":t+"%"}</b><span>${esc(opKop?"leeft weer op":h.koelt?"koelt af":F.naam)}</span><small>${soortNaam(p)} · ${igLeeftijd(h.leeftijd)}</small></div>
    ${igHitteMiniHTML(h)}</div>`;   // klein verloop-grafiekje ernaast (14-10)
  const dicht=igHitteDicht();
  return `<div class="alarm hitte f-${h.fase}${h.koelt?" koelt":""}" role="status">
    <button class="htoggle" type="button" data-hdicht aria-expanded="${!dicht}" title="${dicht?"Uitklappe":"Inklappe"}" aria-label="${dicht?"Hittemetâh uitklappe":"Hittemetâh inklappe"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
    ${kort}
    <div class="hvol">
    <div class="alarmkop"><span class="alarmicoon" aria-hidden="true">${opKop?"↺":F.icoon}</span><h2>${opKop?"Leeft weer op!":F.kop}</h2>${h.opgeleefd&&!opKop?`<span class="chip hop">leeft weer op</span>`:""}</div>
    <div class="hrij">${igHitteMeterHTML(h)}<div class="htekst">${post}${midden}</div>${igHitteVerloopHTML(h)}</div>
    ${onder?`<p class="lksub">${onder}</p>`:""}
    <details class="lkuitleg"><summary>Hoe werkt de hittemetâh?</summary>
      <p>Supabase meet je nieuwe posts elk uur (en als je het dashboard opent). De metâh rekent uit welke <b>eindstand</b> je post haalt
      (bereik nu ÷ hoeveel een post op die leeftijd meestal al heeft) en zet die naast je normaal: <b>${N?`± ${nf0.format(Math.round(N.eind))}`:"je normaal"}</b>
      = de middelste van je laatste ${N?N.n:IG_GROEI.normaalPosts} ${G.kort}${N&&!N.gemengd?`, eerlijk gemaakt voor partner (een post met partner haalt bij jou ± ${igNf1.format(N.factor)}× zoveel)`:N&&N.sit==null?` (partner nog onbekend: met en zonder partner samen)`:""}.</p>
      <p><b>Normaal</b> (30%) = even goed als normaal · <b>Warm</b> (45%) = beter dan 3 op 4 van je posts${N?` (${igNf1.format(N.grenzen.warm)}×)`:""} ·
      <b>Lekkâh</b> (70%) = bij je beste 10%${N?` (${igNf1.format(N.grenzen.lekker)}×)`:""} · <b>Fik</b> (100%) = bij je beste 4%${N?` (${igNf1.format(N.grenzen.fik)}×)`:""}.
      Die grenzen komen uit je eigen posts van het afgelopen jaar en schuiven vanzelf mee. In de eerste uren is de schatting nog ruw (± 35–60%), na een dag ± 10%.</p>
      <p>      Gaat-ie 2 metingen op rij trager dan bij de vorige meting én trager dan normaal, dan is-ie afgekoeld en verdwijnt de metâh. Tussen 01:00 en 07:00 telt dat zakken nie (dan zakt elke post). Gaat een verdwenen post 2 metingen op rij weer sneller én minstens even snel als normaal, dan komt-ie terug: <b>Leeft weer op!</b> De metâh volgt een post ${IG_HITTE.maxUur} uur (zolang meet Supabase elk uur).</p>
      <p><b>Kijk niet steeds zelf naar je nieuwe post.</b> Je eigen kijken telt hooguit 1× mee en maakt hem niet sneller; dit dashboard houdt het voor je bij.</p>
    </details>
    </div>
  </div>`;
}
// Ovâhzicht → #ovAlarm (bovenaan, vóór de alarmen): één metâh per nieuwe post, heetste eerst
function igHitteHTML(){
  const l=igHitteLijst();if(!l.length)return "";
  return `<div class="hittes${l.length>1?" meer":""}${igHitteDicht()?" dicht":""}">${l.map(igHitteKaartHTML).join("")}</div>`;
}
// in-/uitklappen (14-10): één knop per kaart, klapt ze allemaal tegelijk (blijven dan even hoog), keuze onthouden in deze browser
function igHitteDicht(){return store.get("hc_hitte_dicht")==="1"}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-hdicht]");if(!b)return;
  e.preventDefault();e.stopPropagation();
  const box=b.closest(".hittes");if(!box)return;
  const d=!box.classList.contains("dicht");
  box.classList.toggle("dicht",d);store.set("hc_hitte_dicht",d?"1":"0");
  box.querySelectorAll("[data-hdicht]").forEach(x=>{x.setAttribute("aria-expanded",String(!d));x.title=d?"Uitklappe":"Inklappe";x.setAttribute("aria-label",d?"Hittemetâh uitklappe":"Hittemetâh inklappe")});
});
