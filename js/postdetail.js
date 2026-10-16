// postdetail.js — pop-up "Post in detail" (14-10-2026, chat 44)
// Tik op een post of story (waar die ook staat: wachtkamâh, muziek-lijst, toppâhs, Top 5, Stories, hittemetâh, Kansâh)
// → pop-up met de hele performance van die ene post: tegels t.o.v. normaal, groei, partner, tijdstip, kwaliteit,
// volgâhs, muziek, Threads en z'n plek tussen je andere posts. Voor jezelf (delen = later, chat 44.1).
//
// Hoe aantikbaar: een element met data-pd="<media_id>" (stories: ook data-pdst="1"). Eén klik-luisteraar hieronder.
// Tik op de rij (ook op het plaatje) = pop-up. Uitzonderingen: keuzelijsten/knoppen in de rij, links naar iets anders
// dan de post zelf, en Cmd/Ctrl-klik (= gewoon Insta openen in een nieuw tabblad, Mac).
//
// Rekenregels: ALLEEN de bestaande functies uit insta.js (igNormaalEind, igNormaal, igGrenzen, igVerwacht, igGroeiDeel,
// igSituatie, igPartnersVan, igPartnerFactor, igLekkerHitte, igWatWerkt, igStory*) en samenwerking.js (igSamen),
// threads.js (thKoppel, thInsta). Geen tweede curve, normaal of partnerregel.
// Supabase: bij openen hooguit één kleine vraag, alleen voor die ene post (groei per dag uit ig_media_dag, of de
// metingen van een story uit ig_story_uur). Lukt die nie, dan gewoon zonder (rest van de pop-up werkt).

let PD=null;   // {id, st, x, terug (element om de focus naar terug te zetten), dag (rijen ig_media_dag of ig_story_uur), groei ("uur"/"dag")}
const PD_KLAAR_DAGEN=2;   // optellende cijfers (likes, volgâhs, …) pas vergelijken met normaal als de post zo oud is
const PD_RANG_N=30;       // plek tussen je laatste zoveel posts van dezelfde soort
const PD_STORY_N=30;      // normaal story = middelste van je laatste zoveel stories (met cijfâhs)

/* ---------- vinden ---------- */
function pdZoek(id,st){
  if(st)return (IG.stories||[]).find(s=>s.media_id===id)||null;
  return (IG.posts||[]).find(p=>p.media_id===id)||(IG.stories||[]).find(s=>s.media_id===id)||null;
}
const pdIsStory=x=>soortGroep(x)==="story";
const pdLeeftijdMin=x=>(Date.now()-Date.parse(x.gepost_om))/6e4;
function pdLeeftijdTxt(m){const u=m/60,d=u/24;
  return m<90?`${Math.max(1,Math.round(m))} min oud`:u<36?`${Math.round(u)} uur oud`:d<14?`${Math.round(d)} dagen oud`:d<60?`${Math.round(d/7)} weken oud`:`${Math.round(d/30.4)} maanden oud`}
const pdUurAms=ts=>+IG_HITTE_UUR.format(new Date(ts))%24;
const PD_HM=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function pdMinVanDag(ts){const [h,m]=PD_HM.format(new Date(ts)).split(":").map(Number);return (h%24)*60+m}   // minuten sinds middernacht, Haagse tijd

/* ---------- getallen ---------- */
const pdF=v=>v==null||isNaN(v)?"—":Math.abs(v)<10&&v%1?igNf1.format(v):nf0.format(Math.round(v));
const pdX=(v,n)=>v!=null&&n>0?v/n:null;
const pdXcls=x=>x==null?"":x>=1.2?"up":x<=0.8?"down":"";
const pdXtxt=x=>x==null?"":`<b class="${pdXcls(x)}">×${igNf1.format(x)}</b>`;
const pdP1k=(a,b)=>a!=null&&b>0?a*1000/b:null;
// "normaal" voor een gewoon cijfer van een post: middelste van eerdere posts van dezelfde soort (≥ 2 dagen oud)
function pdNorm(p,f){
  const t0=Date.parse(p.gepost_om),oud=Date.now()-PD_KLAAR_DAGEN*864e5;
  const posts=igPostsVan(soortGroep(p)).filter(q=>q!==p&&q.gepost_om&&Date.parse(q.gepost_om)<oud);
  return igNormaal(soortGroep(p),f,{voor:t0,posts});
}
// normaal voor een story: middelste van je laatste PD_STORY_N stories van vóór deze (met cijfâhs)
function pdStoryNorm(s,f){
  const t0=Date.parse(s.gepost_om);
  const l=(IG.stories||[]).filter(q=>q!==s&&q.gepost_om&&Date.parse(q.gepost_om)<t0&&q.cijfers&&q.cijfers.reach>0)
    .sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om)).slice(0,PD_STORY_N).map(f).filter(v=>v!=null&&!isNaN(v));
  return {waarde:l.length>=5?med(l.map(Number)):null,n:l.length};
}

/* ---------- eindstand van een post (of verwachte eindstand als hij nog loopt) ---------- */
function pdEind(p){
  if(p.bereik==null)return null;
  const m=pdLeeftijdMin(p),r=+p.bereik;
  const V=igVerwacht(p,r,m),klaar=m>=PD_KLAAR_DAGEN*1440;
  // schat = de eindstand is (nog) een verwachting, nie het echte bereik — ook na 2 dagen als de groeicurve zegt dat er nog wat bijkomt
  return {eind:V?V.eind:r,klaar,schat:!!(V&&V.deel<.99),V:V||null};
}
// hoe uitzonderlijk: woord bij "× normaal" (zelfde grenzen als de hittemetâh)
function pdFase(x){
  if(x==null)return null;const G=igGrenzen();
  return x>=G.fik?{k:"fik",t:"in de fik (bij je beste 4%)"}:x>=G.lekker?{k:"lekker",t:"lekkâh (bij je beste 10%)"}
    :x>=G.warm?{k:"warm",t:"warm (beter dan 3 op 4 van je posts)"}:x>=0.8?{k:"normaal",t:"normaal"}:{k:"koud",t:"onder je normaal"};
}

/* ---------- openen / sluiten ---------- */
function pdOpen(id,st,terug){
  const x=pdZoek(id,st);if(!x)return false;
  PD={id,st:pdIsStory(x),x,terug:terug||document.activeElement,dag:null,dagFout:null,groei:null};
  $("pdPop").hidden=false;document.body.classList.add("popopen");
  pdTeken();$("pdDicht").focus({preventScroll:true});
  pdLaadExtra(PD);
  return true;
}
function pdDicht(){
  if(!PD)return;const t=PD.terug;PD=null;$("pdPop").hidden=true;hideTip();
  if(![...document.querySelectorAll(".vnpop")].some(x=>!x.hidden))document.body.classList.remove("popopen");   // er kan nog een andere pop-up onder liggen
  if(t&&t.isConnected&&t.focus)t.focus({preventScroll:true});
}
// één kleine vraag bij openen, alleen voor deze post
async function pdLaadExtra(staat){
  try{
    let r;
    if(staat.st)r=await sb.from("ig_story_uur").select("minuut,om,cijfers,fout").eq("media_id",staat.id).order("minuut").limit(200);
    else r=await sb.from("ig_media_dag").select("dag,om:gemeten_om,reach:cijfers->reach,likes:cijfers->likes").eq("media_id",staat.id).order("dag").limit(120);
    if(r.error)throw r.error;
    staat.dag=r.data||[];
  }catch(e){
    staat.dagFout=e.message||String(e);
    staat.dag=[];
    if(!staat.st&&typeof KM!=="undefined"&&KM&&KM.dag)staat.dag=KM.dag.filter(x=>x.id===staat.id).map(x=>({dag:x.dag,om:x.om,reach:x.reach,likes:null}));   // al geladen (Kansâh, 75 dagen)
  }
  if(PD===staat)pdTeken(true);
}

/* ---------- de pop-up tekenen ---------- */
function pdTeken(alleenGroei){
  if(!PD)return;const x=PD.x;
  if(alleenGroei&&$("pdGroei")){pdGroeiTeken();return}
  const st=PD.st,lijst=pdBuren(x),i=lijst.indexOf(x);
  $("pdTitel").textContent=st?`Story · ${dKort(dagNL(x.gepost_om))} ${tijdAms(x.gepost_om)}`:`${soortNaam(x)} · ${dKort(dagNL(x.gepost_om))} ${tijdAms(x.gepost_om)}`;
  $("pdSub").textContent=pdLeeftijdTxt(pdLeeftijdMin(x))+(i>=0?` · ${st?"story":IG_GROEPEN[soortGroep(x)].een} ${lijst.length-i} van ${lijst.length}`:"");
  $("pdVorige").disabled=!(i>=0&&i<lijst.length-1);$("pdVolgende").disabled=!(i>0);
  $("pdInhoud").innerHTML=st?pdStoryHTML(x):pdPostHTML(x);
  pdGroeiTeken();
  $("pdInhoud").scrollTop=0;$("pdPop").querySelector(".vnpopkaart").scrollTop=0;
}
// vorige / volgende (zelfde soort, op volgorde van posten): nieuw → oud
function pdBuren(x){
  return pdIsStory(x)?[...(IG.stories||[])].filter(s=>s.gepost_om).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om))
    :igPostsVan(soortGroep(x)).filter(p=>p.gepost_om).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));
}
function pdNaar(stap){   // stap -1 = nieuwer (volgende), +1 = ouder (vorige)
  if(!PD)return;const l=pdBuren(PD.x),i=l.indexOf(PD.x),n=l[i+stap];if(!n)return;
  const terug=PD.terug;PD={id:n.media_id,st:pdIsStory(n),x:n,terug,dag:null,dagFout:null,groei:null};
  pdTeken();pdLaadExtra(PD);
}

/* ---------- onderdelen ---------- */
const pdBlok=(kop,inhoud,cls="")=>inhoud?`<section class="pdblok ${cls}"><h3>${kop}</h3>${inhoud}</section>`:"";
function pdKop(x,{beeld,chips,tekst,link,samen}){
  return `<div class="pdkop">
    <a class="igthumb pdbeeld${PD.st?" story":""}" ${link?`href="${esc(link)}" target="_blank" rel="noopener"`:`aria-disabled="true"`} aria-label="Kèk op Insta">${beeld?`<img src="${esc(beeld)}" alt="" onerror="this.remove()">`:""}</a>
    <div class="pdkoptekst">
      ${samen?`<p class="pdsamen">${samen}</p>`:""}
      ${chips.length?`<p class="pdchips">${chips.join("")}</p>`:""}
      ${tekst?`<p class="pdcap">${esc(tekst)}</p>`:""}
      ${link?`<a class="btn yellow pdinsta" href="${esc(link)}" target="_blank" rel="noopener">Kèk op Insta ↗</a>`:`<p class="sub pdinsta">${PD.st?"Story is verlopen: op Insta nie meâh te zien.":""}</p>`}
    </div></div>`;
}
// tegel: waarde, × normaal (of "loopt nog")
function pdTegel(k,v,norm,{klaar=true,fmt=pdF,uitleg="",normTxt,omgekeerd=false}={}){
  if(v==null)return "";
  const x=klaar?pdX(v,norm):null;
  const xt=x==null?"":omgekeerd?`<b class="${x>=1.2?"down":x<=0.8?"up":""}">×${igNf1.format(x)}</b>`:pdXtxt(x);
  const s=!klaar?`loopt nog${norm!=null?` · normaal ${fmt(norm)}`:""}`:x!=null?`${xt} normaal (${normTxt||fmt(norm)})`:norm==null?"nog geen normaal":"";
  return `<div class="ytstat"><span class="k">${k}</span><span class="v">${fmt(v)}</span><span class="s">${s}${uitleg?` · ${uitleg}`:""}</span></div>`;
}
// liggende balkjes (HTML, past zich aan de breedte aan): rijen [{naam, v, txt, sub, aan}]
function pdBalken(rijen,aria){
  const mx=Math.max(...rijen.map(r=>r.v||0),1);
  return `<div class="pdbalken" role="list" aria-label="${esc(aria)}">${rijen.map(r=>`<div class="pdbalk${r.aan?" aan":""}" role="listitem">
    <span class="k">${r.naam}${r.aan?' <span class="chip mute">deze</span>':""}</span>
    <span class="b"><i style="width:${r.v>0?Math.max(2,r.v/mx*100).toFixed(1):0}%"></i></span>
    <span class="v">${r.txt}${r.sub?`<small>${r.sub}</small>`:""}</span></div>`).join("")}</div>`;
}
// deze post naast normaal (2 balkjes), voor kwaliteit en volgâhs
function pdNaast(naam,v,norm,fmt,eenheid){
  if(v==null)return "";
  const x=pdX(v,norm);
  return `<div class="pdnaast"><p><b>${naam}</b>: ${fmt(v)} ${eenheid}${x!=null?` · ${pdXtxt(x)} je normaal`:""}</p>
    ${pdBalken([{naam:"Deze",v,txt:fmt(v),aan:false},...(norm!=null?[{naam:"Normaal",v:norm,txt:fmt(norm)}]:[])],naam)}</div>`;
}
// plek tussen je laatste PD_RANG_N posts van dezelfde soort (of de PD_RANG_N tot en met deze, als hij ouder is)
function pdRang(x,lijst,f,naam){
  const l=lijst.filter(q=>q.gepost_om).sort((a,b)=>Date.parse(b.gepost_om)-Date.parse(a.gepost_om));
  let i=l.indexOf(x);if(i<0)return null;
  const begin=i<PD_RANG_N?0:Math.max(0,Math.min(i-Math.floor(PD_RANG_N/2),l.length-PD_RANG_N));   // oudere post: de 30 posts eromheen
  const venster=l.slice(begin,begin+PD_RANG_N);
  const met=venster.filter(q=>f(q)!=null&&!isNaN(f(q)));if(met.length<5||f(x)==null)return null;
  const nr=1+met.filter(q=>q!==x&&+f(q)>+f(x)).length;
  return {nr,van:met.length,laatste:begin===0,naam};
}
function pdRangHTML(rangen,wat){
  const r=rangen.filter(Boolean);if(!r.length)return "";
  return `<ul class="pdlijst">${r.map(x=>`<li><b class="${x.nr<=3?"up":x.nr>x.van*.75?"down":""}">nr. ${x.nr}</b> van ${x.laatste?`je laatste ${x.van}`:`de ${x.van} rond deze`} ${wat} op <b>${x.naam}</b>${x.nr===1?" 🏆":""}</li>`).join("")}</ul>`;
}
// muziek: welk nummâh en wat deed het na de post (igPlaysEffect)
function pdMuziekHTML(x){
  const m=labelsVan(x,"muziek")[0]||"";
  if(!m)return `<p class="sub">Nog nie gekozen welke muziek eronder zat (kies het in de Insta-tab of de wachtkamâh).</p>`;
  if(!igIsNummer(m))return `<p>${esc(igMuziekNaam(m))}${m==="(eigen muziek)"?" (welk nummâh weet het dashboard nie)":""}.</p>`;
  const eff=igPlaysEffect(m,dagNL(x.gepost_om));
  return `<p>♪ <b>${esc(m)}</b></p>${eff?`<p class="pdeff">${igEffectHTML(eff)}</p><p class="sub">×2 = twee keer zoveel plays per dag as in de dagen vóór de post.</p>`:`<p class="sub">Nog geen plays-metingen van dit nummâh rond de post.</p>`}`;
}

/* ---------- POST ---------- */
function pdPostHTML(p){
  const g=soortGroep(p),G=IG_GROEPEN[g],m=pdLeeftijdMin(p),klaar=m>=PD_KLAAR_DAGEN*1440;
  const E=pdEind(p),NE=igNormaalEind(p),sit=igSituatie(p),partners=igPartnersVan(p);
  const xE=E&&NE.genoeg?pdX(E.eind,NE.waarde):null,F=pdFase(xE);
  // --- samenvatting
  const kw=v=>IG_TOP_OP.kwaliteit.v(v);
  const nKw=pdNorm(p,q=>+q.bereik>=100?kw(q):null),xKw=kw(p)!=null&&+p.bereik>=100?pdX(kw(p),nKw.waarde):null;
  const vPk=q=>q.nieuwe_volgers!=null&&+q.bereik>0?q.nieuwe_volgers*1000/q.bereik:null;
  const nVp=pdNorm(p,vPk),xVp=klaar?pdX(vPk(p),nVp.waarde):null;
  const zin=[];
  if(xE!=null)zin.push(`<b class="${pdXcls(xE)}">${igNf1.format(xE)}×</b> je normaal${E.schat?" (verwacht)":""}: <b>${F.t}</b>`);
  else if(p.bereik==null)zin.push("nog geen cijfâhs van Meta");
  if(sit==="partner")zin.push(`met partnâh ${partners.map(n=>"@"+esc(n)).join(", ")}`);
  if(xKw!=null&&xKw>=1.25)zin.push("gedeeld + bewaard hoog");else if(xKw!=null&&xKw<=0.8)zin.push("gedeeld + bewaard laag");
  if(xVp!=null&&xVp>=1.25)zin.push("trok veel volgâhs");
  const chips=[`<span class="chip mute">${soortNaam(p)}</span>`,
    ...partners.map(n=>`<span class="chip kbron" style="--c:var(--hy)">@${esc(n)}</span>`),
    ...(labelsVan(p,"muziek")[0]?[`<span class="chip mute">♪ ${esc(igMuziekNaam(labelsVan(p,"muziek")[0]))}</span>`]:[]),
    ...labelsVan(p,"onderwerp").map(o=>`<span class="chip mute">${esc(o)}</span>`)];
  let h=pdKop(p,{beeld:p.plaatje,chips,tekst:String(p.bijschrift||"").split(/\n\s*\n/)[0].replace(/(\s*#[^\s#]+)+\s*$/,"").trim().slice(0,240),link:p.permalink,samen:zin.join(" · ")});
  // --- tegels
  const n=f=>pdNorm(p,f).waarde;
  const bereikTegel=p.bereik==null?"":`<div class="ytstat"><span class="k">Bereik</span><span class="v">${pdF(+p.bereik)}</span><span class="s">${
    E&&E.schat?`verwacht ± ${pdF(E.eind)}${xE!=null?` = ${pdXtxt(xE)}`:""} · `:xE!=null?`${pdXtxt(xE)} · `:""}normaal ${NE.genoeg?pdF(NE.waarde):"?"}${NE.genoeg&&!NE.gemengd?(sit==="partner"?" mét partner":" zonder partner"):""}</span></div>`;
  h+=`<div class="ytstats pdtegels">${bereikTegel}
    ${pdTegel("Weergaven",p.weergaven,n(q=>q.weergaven),{klaar})}
    ${pdTegel("Likes",p.likes,n(q=>q.likes),{klaar})}
    ${pdTegel("Reacties",p.reacties,n(q=>q.reacties),{klaar})}
    ${pdTegel("Gedeeld",p.gedeeld,n(q=>q.gedeeld),{klaar})}
    ${pdTegel("Bewaard",p.bewaard,n(q=>q.bewaard),{klaar})}
    ${pdTegel("Nieuwe volgâhs",p.nieuwe_volgers,n(q=>q.nieuwe_volgers),{klaar})}
    ${pdTegel("Profielbezoek",p.profielbezoeken,n(q=>q.profielbezoeken),{klaar})}
    ${g==="reel"?pdTegel("Kijktijd",p.kijktijd_sec,n(q=>q.kijktijd_sec),{fmt:v=>igNf1.format(v)+" s",uitleg:"gemiddeld per keer"}):""}
  </div>`;
  const uitlegT=[];
  if(!klaar)uitlegT.push(`Post is jonger dan ${PD_KLAAR_DAGEN} dagen: de cijfâhs groeien nog, dus alleen bereik wordt al vergeleken (met de verwachte eindstand).`);
  if(g==="reel")uitlegT.push("Reels: Meta geeft geen nieuwe volgâhs en profielbezoek per reel.");
  uitlegT.push(`Normaal = middelste van je eerdere ${G.kort} (bereik: je laatste ${IG_GROEI.normaalPosts}, eerlijk gemaakt voor partner; rest: laatste 120 dagen).`);
  h+=`<p class="sub pdnoot">${uitlegT.join(" ")}</p>`;
  // --- groei
  h+=pdBlok("Groei",`<div class="seg pdgroeikies" id="pdGroeiKies" role="group" aria-label="Groei bekijken per">
      <button type="button" data-v="uur">Eerste 48 uur</button><button type="button" data-v="dag">Per dag</button></div>
    <div class="chart pdgroei" id="pdGroei"></div><p class="sub pdgroeisub" id="pdGroeiSub"></p>${pdHitteHTML(p)}`);
  // --- partner
  h+=pdBlok("Partnâh",pdPartnerHTML(p,E,sit,partners));
  // --- tijdstip
  h+=pdBlok("Tijdstip",pdTijdHTML(p,E));
  // --- kwaliteit + volgâhs
  const lpk=q=>q.likes!=null&&+q.bereik>0?q.likes/q.bereik:null,nLpk=pdNorm(p,lpk);
  const prk=q=>q.profielbezoeken!=null&&+q.bereik>0?q.profielbezoeken*1000/q.bereik:null,nPr=pdNorm(p,prk);
  h+=pdBlok("Kwaliteit",
    (+p.bereik>=100?pdNaast("Gedeeld + bewaard",kw(p),nKw.waarde,v=>igKwalF(v),"per 1.000 kijkâhs"):`<p class="sub">Te weinig bereik (< 100) om kwaliteit eerlijk te meten.</p>`)
    +pdNaast("Likes per kijkâh",lpk(p),nLpk.waarde,v=>igPct1(v),"")
    +`<p class="sub">Gedeeld + bewaard weegt bij Insta zwaarder dan likes. Let op: grote posts hebben vaak juist mínder likes per kijkâh.</p>`);
  if(g!=="reel")h+=pdBlok("Volgâhs en profiel",(klaar?"":`<p class="sub">Loopt nog: vergelijken kan vanaf ${PD_KLAAR_DAGEN} dagen oud.</p>`)
    +pdNaast("Nieuwe volgâhs",vPk(p),klaar?nVp.waarde:null,v=>igNf1.format(v),"per 1.000 kijkâhs")
    +pdNaast("Profielbezoek",prk(p),klaar?nPr.waarde:null,v=>igNf1.format(v),"per 1.000 kijkâhs")
    +(p.nieuwe_volgers==null?`<p class="sub">Meta gaf (nog) geen volgâhs-cijfer voor deze post.</p>`:""));
  // --- muziek + threads
  h+=pdBlok("Muziek",pdMuziekHTML(p));
  h+=pdBlok("Threads",pdThreadsHTML(p));
  // --- plek
  const posts=igPostsVan(g).filter(q=>q===p||Date.parse(q.gepost_om)<Date.now()-PD_KLAAR_DAGEN*864e5);
  h+=pdBlok("Plek tussen je andere posts",pdRangHTML([
      pdRang(p,posts,q=>q===p&&E?E.eind:q.bereik,E&&E.schat?"bereik (verwachte eindstand)":"bereik"),
      pdRang(p,posts.filter(q=>+q.bereik>=100),kw,"kwaliteit"),
      g!=="reel"?pdRang(p,posts,q=>q.nieuwe_volgers,"nieuwe volgâhs"):null,
      pdRang(p,posts,q=>q.likes,"likes")],G.kort)
    +(klaar?"":`<p class="sub">Post loopt nog: z'n plek kan nog stijgen.</p>`));
  return h;
}
// hittemetâh-verloop van de eerste 48 uur (hergebruikt igLekkerHitte + igHitteVerloopHTML)
function pdHitteHTML(p){
  if(!IG.pu||!IG.pu.get(p.media_id))return "";
  const t0=Date.parse(p.gepost_om),h=igLekkerHitte(p,Math.min(Date.now(),t0+IG_HITTE.maxUur*36e5-6e4));
  if(!h||h.punten.length<2)return "";
  const top=h.punten.reduce((a,b)=>b.t>a.t?b:a),F=IG_HITTE_FASE[top.fase];
  return `<div class="pdhitte"><p><b>Hittemetâh</b> · heetst: <b style="color:${igHitteKleur(top.t)}">${top.t}% ${esc(F.naam)}</b> na ${igHitteUurLabel(top.m)}${h.weg?` · afgekoeld na ${igHitteUurLabel(h.wegNa)}`:""}</p>${igHitteVerloopHTML(h)}</div>`;
}
function pdPartnerHTML(p,E,sit,partners){
  const PF=igPartnerFactor(Date.parse(p.gepost_om)),F=PF.f;
  let h="";
  if(sit==null)return `<p class="sub">Partnâh nog nie gecheckt (dat gebeurt in de eerste uren na het posten).</p>`;
  if(sit==="solo"&&soortGroep(p)==="reel")return `<p>Zonder partnâh.</p><p class="sub">Het partner-effect rekent het dashboard alleen voor foto's & carrousels uit (te weinig reels mét partnâh).</p>`;
  if(sit==="solo"){
    h+=`<p>Zonder partnâh.${F?` Met een partnâh haal je bij foto's & carrousels meestal <b>± ${igNf1.format(F)}×</b> zoveel bereik (${PF.met} posts mét, ${PF.zonder} zonder).`:""}</p>`;
    if(F&&E)h+=`<p class="sub">Met een gemiddelde partnâh had deze post ± ${pdF(E.eind*F)} kunnen halen (schatting).</p>`;
    return h;
  }
  // per partner: oordeel uit Partnâhs (igSamen) + hun grootte + wat je eerder samen deed
  let S=null;try{S=typeof igSamen==="function"&&typeof IGS!=="undefined"&&IGS&&!IGS.err?(IGS_S||igSamen()):null}catch(e){S=null}
  const rij=n=>S&&S.rijen?S.rijen.find(r=>r.naam===n):null;
  const info=n=>typeof IGS!=="undefined"&&IGS&&IGS.info?IGS.info.find(i=>i.partner===n):null;
  const t0=Date.parse(p.gepost_om),g=soortGroep(p);
  h+=`<ul class="pdlijst">${partners.map(n=>{
    const r=rij(n),i=info(n);
    const eerder=igPostsVan(g).filter(q=>q!==p&&q.gepost_om&&Date.parse(q.gepost_om)<t0&&+q.bereik>0&&igPartnersVan(q).includes(n));
    const eMed=eerder.length>=3?med(eerder.map(q=>+q.bereik)):null;
    const ordl=r&&r.zeker?`<span class="chip ${IGS_OORDEEL[r.oordeel][0]}">${IGS_OORDEEL[r.oordeel][1]}</span>`:r?`<span class="chip mute">nog te vroeg voor een oordeel (${r.n} ${r.n===1?"post":"posts"})</span>`:"";
    return `<li><b>@${esc(n)}</b> ${ordl}${i&&i.volgers!=null?` · ${igsKort(i.volgers)} volgâhs`:""}
      <br><span class="sub">${eerder.length?`${eerder.length} eerdere ${eerder.length===1?"post":"posts"} samen${eMed!=null?`, middelste bereik ${pdF(eMed)}${E?` → deze: ${pdXtxt(pdX(E.eind,eMed))}`:""}`:" (te weinig om te vergelijken)"}`:"eerste keer samen"}</span></li>`}).join("")}</ul>`;
  if(F&&E&&soortGroep(p)!=="reel"){
    const zonder=E.eind/F,erbij=E.eind-zonder;
    h+=`<p><b>Schatting:</b> zonder partnâh ± <b>${pdF(zonder)}</b> bereik, dus de partnâh leverde ± <b>${pdF(erbij)}</b> kijkâhs op${E.schat?" (verwacht)":""}.</p>
      <p class="sub">± schatting: Meta geeft bij een samenwerking één set cijfâhs voor de hele post, nie per account. Gerekend met je vaste partner-factor ±&nbsp;${igNf1.format(F)}× (middelste post mét partner ÷ zonder, ${PF.met} en ${PF.zonder} posts).</p>`;
  }else h+=`<p class="sub">Nog te weinig posts met én zonder partnâh om het effect te schatten.</p>`;
  return h;
}
const pdDdTxt=dd=>{const m=/^(\S+) \((.*)\)$/.exec(dd);return m?`${m[1].toLowerCase()}, ${m[2]} uur`:esc(dd.toLowerCase())};
function pdTijdHTML(p,E){
  const g=soortGroep(p),uur=p.uur??pdUurAms(p.gepost_om),dd=dagdeel(uur),wd=DAGEN_LANG[(p.weekdag||1)-1];
  const W=igWatWerkt("tijd",g),D=igWatWerkt("dag",g),G=IG_GROEPEN[g];
  const rij=(r,naam)=>({naam:esc(r.naam.replace(/ \(.*\)/,"")),v:r.med||0,txt:r.med==null?"—":pdF(r.med),sub:` ${r.n} ${r.n===1?"post":"posts"}`,aan:r.naam===naam});
  const deze=W.rijen.find(r=>r.naam===dd);
  let h=`<p>Gepost op <b>${wd}</b> om <b>${tijdAms(p.gepost_om)}</b> (${pdDdTxt(dd)}).`;
  if(deze&&deze.n>=3)h+=` ${G.naam} in dit dagdeel halen middelste <b>${pdF(deze.med)}</b> bereik${deze.idx!=null?` (${pdXtxt(deze.idx)} al je ${G.kort})`:""}${E?`; deze post deed ${pdXtxt(pdX(E.eind,deze.med))} daarvan`:""}.`;
  else if(deze)h+=` <span class="sub">Maar ${deze.n} ${deze.n===1?"post":"posts"} in dit dagdeel: te weinig om iets te zeggen.</span>`;
  h+=`</p>`;
  if(W.rijen.length)h+=`<p class="pdtkop">Middelste bereik per dagdeel <span class="sub">(${G.kort}, laatste jaar)</span></p>`+pdBalken(W.rijen.map(r=>rij(r,dd)),"Bereik per dagdeel");
  if(D.rijen.length)h+=`<p class="pdtkop">Per weekdag</p>`+pdBalken(D.rijen.map(r=>rij(r,wd)),"Bereik per weekdag");
  h+=`<p class="sub">Middelste bereik van al je ${G.kort} van het afgelopen jaar, met én zonder partnâh samen. Onder de 3 posts per balkje: toeval.</p>`;
  return h;
}
function pdThreadsHTML(p){
  if(typeof thKoppel!=="function"||typeof TH==="undefined"||!TH||TH.err||!TH.posts)return "";
  const k=thKoppel(),c=k.paren.find(x=>x.ig.media_id===p.media_id);
  const eerste=TH.posts.reduce((m,q)=>!m||q.gepost_om<m?q.gepost_om:m,null);
  if(!c)return eerste&&p.gepost_om>=eerste?`<p class="sub">Deze post staat nie op Threads (of het dashboard herkent hem nie: zelfde tijd én tekst).</p>`:"";
  const th=c.th,vs=thInsta(),x=th.views!=null&&+p.weergaven>0?th.views/(+p.weergaven):null;
  return `<p>Ook op Threads: <b>${pdF(th.views)}</b> weergaven · ${pdF(th.likes)} likes · ${pdF(th.replies)} reacties${th.reposts?` · ${pdF(th.reposts)} repost${th.reposts===1?"":"s"}`:""}.</p>
    ${x!=null?`<p>Dat is <b>+${pct(x)}</b> bovenop je Insta-weergaven${vs.erbij!=null?` (normaal +${pct(vs.erbij)})`:""}.</p>`:""}
    ${th.permalink?`<p><a href="${esc(th.permalink)}" target="_blank" rel="noopener">Kèk op Threads ↗</a></p>`:""}`;
}

/* ---------- STORY ---------- */
function pdStoryHTML(s){
  const c=s.cijfers||{},m=pdLeeftijdMin(s),loopt=m<1440;
  const N=f=>pdStoryNorm(s,f).waarde;
  const reach=x=>(x.cijfers||{}).reach,nR=N(reach),xR=c.reach!=null&&!loopt?pdX(c.reach,nR):null;
  // story van die dag: hoeveelste en hoeveel van de eerste bleef kijken
  const dag=(IG.stories||[]).filter(q=>q.gepost_om&&dagNL(q.gepost_om)===dagNL(s.gepost_om)).sort((a,b)=>Date.parse(a.gepost_om)-Date.parse(b.gepost_om));
  const nr=dag.indexOf(s)+1,eerste=dag[0]&&dag[0].cijfers&&dag[0].cijfers.reach;
  const zin=[];
  if(c.reach==null)zin.push(s.fout?"geen cijfâhs (Meta gaf een fout, bijv. te weinig kijkâhs)":"nog geen cijfâhs");
  else if(loopt)zin.push("loopt nog (story staat 24 uur online)");
  else if(xR!=null)zin.push(`<b class="${pdXcls(xR)}">${igNf1.format(xR)}×</b> je normale story`);
  if(dag.length>1)zin.push(`story ${nr} van ${dag.length} die dag${nr>1&&eerste&&c.reach!=null?(c.reach<eerste?` · ${pct(c.reach/eerste)} van de 1e bleef kijken`:` · meer kijkâhs dan de 1e`):""}`);
  const her=igStoryHerkomst(s),mz=labelsVan(s,"muziek")[0];
  const chips=[`<span class="chip mute">Story</span>`,`<span class="chip mute">${IG_HERKOMST[her]}</span>`,...(mz?[`<span class="chip mute">♪ ${esc(igMuziekNaam(mz))}</span>`]:[])];
  const link=Date.parse(s.gepost_om)>Date.now()-864e5?s.permalink:"";
  let h=pdKop(s,{beeld:igStoryBeeld(s),chips,tekst:String(s.bijschrift||"").trim().slice(0,240),link,samen:zin.join(" · ")});
  const kl=!loopt;
  h+=`<div class="ytstats pdtegels">
    ${pdTegel("Bereik",c.reach,nR,{klaar:kl})}
    ${pdTegel("Weergaven",c.views,N(x=>(x.cijfers||{}).views),{klaar:kl})}
    ${pdTegel("Likes ≈",igStoryLikes(s),N(igStoryLikes),{klaar:kl,uitleg:"berekend"})}
    ${pdTegel("Reacties",c.replies,N(x=>(x.cijfers||{}).replies),{klaar:kl})}
    ${pdTegel("Gedeeld",c.shares,N(x=>(x.cijfers||{}).shares),{klaar:kl})}
    ${pdTegel("Nieuwe volgâhs",c.follows,N(x=>(x.cijfers||{}).follows),{klaar:kl})}
    ${pdTegel("Profielbezoek",c.profile_visits,N(x=>(x.cijfers||{}).profile_visits),{klaar:kl})}
    ${pdTegel("Tikte weg",igStoryWeg(s),N(igStoryWeg),{klaar:kl,fmt:v=>pct(v),uitleg:"hoe lagâh, hoe betâh",omgekeerd:true})}
  </div><p class="sub pdnoot">Normaal = middelste van je laatste ${PD_STORY_N} stories van vóór deze (met cijfâhs). Likes ≈ interacties − gedeeld − reacties.</p>`;
  h+=pdBlok("Groei (24 uur)",`<div class="chart pdgroei" id="pdGroei"></div><p class="sub pdgroeisub" id="pdGroeiSub"></p>`);
  // tijdstip: stories per dagdeel (laatste jaar)
  const jaar=(IG.stories||[]).filter(q=>q.gepost_om&&Date.parse(q.gepost_om)>Date.now()-365*864e5&&reach(q)>0);
  const per=new Map();jaar.forEach(q=>{const d=dagdeel(pdUurAms(q.gepost_om));if(!per.has(d))per.set(d,[]);per.get(d).push(reach(q))});
  const dd=dagdeel(pdUurAms(s.gepost_om));
  const rijen=DAGDELEN.filter(d=>per.has(d)).map(d=>{const a=per.get(d);return {naam:esc(d.replace(/ \(.*\)/,"")),v:med(a),txt:pdF(med(a)),sub:` ${a.length} ${a.length===1?"story":"stories"}`,aan:d===dd}});
  h+=pdBlok("Tijdstip",`<p>Geplaatst om <b>${tijdAms(s.gepost_om)}</b> (${pdDdTxt(dd)}).</p>`
    +(rijen.length?`<p class="pdtkop">Middelste bereik per dagdeel <span class="sub">(stories, laatste jaar)</span></p>`+pdBalken(rijen,"Bereik per dagdeel"):""));
  h+=pdBlok("Kwaliteit",pdNaast("Gedeeld",igStoryKwal(s),N(igStoryKwal),v=>igKwalF(v),"per 1.000 kijkâhs")
    +pdNaast("Likes per kijkâh",igStoryLikes(s)!=null&&c.reach>0?igStoryLikes(s)/c.reach:null,N(x=>igStoryLikes(x)!=null&&reach(x)>0?igStoryLikes(x)/reach(x):null),v=>igPct1(v),"")
    +`<p class="sub">Stories kun je nie bewaren: kwaliteit = gedeeld per 1.000 kijkâhs.</p>`);
  h+=pdBlok("Muziek",pdMuziekHTML(s));
  h+=pdBlok("Plek tussen je andere stories",pdRangHTML([pdRang(s,IG.stories||[],reach,"bereik"),pdRang(s,IG.stories||[],igStoryLikes,"likes"),
    pdRang(s,(IG.stories||[]).filter(q=>reach(q)>=50),igStoryKwal,"kwaliteit")],"stories")+(loopt?`<p class="sub">Story loopt nog: z'n plek kan nog stijgen.</p>`:""));
  return h;
}

/* ---------- groei-grafiek ---------- */
// lijngrafiek: lijnen [{pts:[[x,y]], cls, naam}], punten [{x,y,tekst,datum}] = aanwijsbare meetpunten
function pdLijnSVG(el,{lijnen,punten,xMax,xLabels,aria}){
  const W=Math.max(280,Math.round(el.clientWidth||600)),ml=44,mr=10,mt=14,mb=24,ih=(W<500?150:180)-mt-mb,iw=W-ml-mr,H=mt+ih+mb;
  const yMax=Math.max(1,...lijnen.flatMap(l=>l.pts.map(p=>p[1])));
  const sch=schaal(yMax,3),X=x=>ml+x/xMax*iw,Y=y=>mt+ih-y/sch.top*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">`;
  sch.lijnen.forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text x="${ml-6}" y="${(Y(t)+4).toFixed(1)}" text-anchor="end">${nf0.format(t)}</text>`});
  xLabels.forEach(([x,t])=>{s+=`<text x="${Math.min(W-mr-8,Math.max(ml+8,X(x))).toFixed(1)}" y="${H-6}" text-anchor="middle">${t}</text>`});
  lijnen.forEach(l=>{if(l.pts.length<2)return;
    s+=`<polyline class="pdlijn ${l.cls||""}" points="${l.pts.map(([x,y])=>X(x).toFixed(1)+","+Y(y).toFixed(1)).join(" ")}"/>`});
  (punten||[]).forEach(p=>{s+=`<circle class="pdpunt" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${punten.length>30?2:3}"/>`});
  // aanwijs-vlakken: één per meetpunt (tot halverwege de buren)
  const ps=(punten||[]).map(p=>({...p,px:X(p.x)})).sort((a,b)=>a.px-b.px);
  ps.forEach((p,i)=>{const l=i?(ps[i-1].px+p.px)/2:ml,r=i<ps.length-1?(p.px+ps[i+1].px)/2:W-mr;
    s+=`<rect class="hit" x="${l.toFixed(1)}" y="${mt}" width="${Math.max(1,r-l).toFixed(1)}" height="${ih}"${staafGetal(p.px,Y(p.y),p.tekst,p.datum)}/>`});
  el.innerHTML=s+"</svg>";
}
function pdGroeiTeken(){
  const el=$("pdGroei");if(!el||!PD)return;const x=PD.x,sub=$("pdGroeiSub");
  if(PD.st)return pdStoryGroei(el,sub,x);
  const pu=(IG.pu&&IG.pu.get(x.media_id))||[],heeftUur=pu.length>=2;
  if(!PD.groei)PD.groei=heeftUur?"uur":"dag";
  const kies=$("pdGroeiKies");
  if(kies){kies.querySelectorAll("button").forEach(b=>{b.setAttribute("aria-pressed",b.dataset.v===PD.groei);if(b.dataset.v==="uur")b.disabled=!heeftUur})}
  const NE=igNormaalEind(x),t0=Date.parse(x.gepost_om),leeftijd=pdLeeftijdMin(x);
  const normLijn=(tot,stap,naarX)=>{if(!NE.genoeg)return [];const l=[];for(let m=0;m<=tot;m+=stap)l.push([naarX(m),NE.waarde*igGroeiDeel(x,m)]);return l};
  if(PD.groei==="uur"){
    const tot=Math.min(48*60,Math.max(60,leeftijd));
    const pts=[[0,0],...pu.filter(q=>q.m<=48*60).map(q=>[q.m/60,q.r])];
    pdLijnSVG(el,{lijnen:[{pts:normLijn(tot,30,m=>m/60),cls:"norm"},{pts,cls:"deze"}],
      punten:pu.filter(q=>q.m<=48*60).map(q=>({x:q.m/60,y:q.r,tekst:`${nf0.format(q.r)} bereik`,datum:igHitteUurLabel(q.m)})),
      xMax:tot/60,xLabels:[0,.25,.5,.75,1].map(f=>[f*tot/60,Math.round(f*tot/60)+" u"]),aria:"Bereik in de eerste 48 uur, met je normaal"});
    sub.innerHTML=`<span class="pdleg deze"></span> deze post · <span class="pdleg norm"></span> normaal op die leeftijd${NE.genoeg?` (eindstand ± ${pdF(NE.waarde)})`:" (nog geen normaal)"} · elk uur gemeten, tik op de lijn voor het getal.`;
    return;
  }
  // per dag (ig_media_dag): bereik-stand per Haagse dag, dag 1 = de dag van posten
  if(PD.dag==null){el.innerHTML=`<p class="sub">Groei per dag ophalen…</p>`;sub.textContent="";return}
  const d0=dagNL(x.gepost_om),dagNr=d=>Math.round((Date.parse(d)-Date.parse(d0))/864e5)+1;
  const rij=(PD.dag||[]).filter(r=>r.reach!=null&&dagNr(String(r.dag).slice(0,10))>=1&&dagNr(String(r.dag).slice(0,10))<=14)
    .map(r=>{const d=String(r.dag).slice(0,10);return {n:dagNr(d),d,r:+r.reach,m:r.om?(Date.parse(r.om)-t0)/6e4:null}});
  if(rij.length<2){el.innerHTML=`<p class="sub">${PD.dagFout?"Groei per dag ophalen lukte nie.":"Nog te weinig dagen gemeten voor een lijn."}${heeftUur?" Kies \"Eerste 48 uur\".":""}</p>`;sub.textContent="";return}
  const xMax=Math.max(7,Math.min(14,rij[rij.length-1].n));
  const pts=[[0,0],...rij.map(r=>[r.n,r.r])];
  const norm=NE.genoeg?[[0,0],...Array.from({length:xMax},(_,i)=>i+1).map(n=>{const r=rij.find(q=>q.n===n),m=r&&r.m!=null?r.m:n*1440-pdMinVanDag(x.gepost_om);return [n,NE.waarde*igGroeiDeel(x,Math.max(0,m))]})]:[];
  pdLijnSVG(el,{lijnen:[{pts:norm,cls:"norm"},{pts,cls:"deze"}],punten:rij.map(r=>({x:r.n,y:r.r,tekst:`${nf0.format(r.r)} bereik`,datum:`dag ${r.n} · ${dKort(r.d)}`})),
    xMax,xLabels:Array.from({length:xMax+1},(_,i)=>i).filter(i=>i&&(xMax<=7||i%2===1)).map(i=>[i,"dag "+i]),aria:"Bereik per dag na het posten, met je normaal"});
  const laatst=rij[rij.length-1];
  sub.innerHTML=`<span class="pdleg deze"></span> deze post · <span class="pdleg norm"></span> normaal · stand aan het eind van elke dag (dag 1 = de dag van posten). Na dag ${laatst.n}: ${pdF(laatst.r)} bereik.`;
}
function pdStoryGroei(el,sub,s){
  if(PD.dag==null){el.innerHTML=`<p class="sub">Metingen ophalen…</p>`;sub.textContent="";return}
  const rij=(PD.dag||[]).filter(r=>!r.fout&&r.cijfers&&r.cijfers.reach!=null).map(r=>({m:+r.minuut,r:+r.cijfers.reach}));
  if(rij.length<2){el.innerHTML=`<p class="sub">${PD.dagFout?"Metingen ophalen lukte nie.":Date.parse(s.gepost_om)<Date.parse("2026-10-08")?"Van stories van vóór 8 okt is alleen de eindstand bewaard.":"Nog te weinig metingen voor een lijn."}</p>`;sub.textContent="";return}
  const nR=pdStoryNorm(s,x=>(x.cijfers||{}).reach).waarde;
  pdLijnSVG(el,{lijnen:[...(nR?[{pts:[[0,nR],[24,nR]],cls:"norm"}]:[]),{pts:[[0,0],...rij.map(q=>[q.m/60,q.r])],cls:"deze"}],
    punten:rij.map(q=>({x:q.m/60,y:q.r,tekst:`${nf0.format(q.r)} bereik`,datum:igHitteUurLabel(q.m)})),
    xMax:24,xLabels:[0,6,12,18,24].map(u=>[u,u+" u"]),aria:"Bereik van de story in 24 uur"});
  sub.innerHTML=`<span class="pdleg deze"></span> deze story · <span class="pdleg norm"></span> eindstand van je normale story${nR?` (± ${pdF(nR)})`:""}. Stories hebben (nog) geen eigen groeicurve: daarom alleen de eindstand als lijn.`;
}

/* ---------- aantikken ---------- */
document.addEventListener("click",e=>{
  const t=e.target;if(!t||!t.closest)return;
  // in de pop-up
  if(PD){
    if(t.closest("#pdDicht")||t.id==="pdPop"){pdDicht();return}
    if(t.closest("#pdVorige")){pdNaar(1);return}
    if(t.closest("#pdVolgende")){pdNaar(-1);return}
    const gk=t.closest("#pdGroeiKies button");if(gk&&!gk.disabled){PD.groei=gk.dataset.v;pdGroeiTeken();return}
  }
  const el=t.closest("[data-pd]");if(!el||t.closest("#pdPop"))return;
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;                          // Cmd-klik = gewoon Insta in een nieuw tabblad
  if(t.closest("select,option,input,textarea,label,summary,button"))return;       // keuzelijst (muziek), knoppen: doen hun eigen ding
  const x=pdZoek(el.dataset.pd,el.dataset.pdst==="1");if(!x)return;
  const a=t.closest("a");
  if(a&&a.getAttribute("href")&&a.getAttribute("href")!=="#"&&a.href!==x.permalink&&!a.matches(".igthumb,.kmthumb,.igt5rij"))return;   // link naar iets anders (partner, nummâh)
  e.preventDefault();e.stopPropagation();
  pdOpen(x.media_id,pdIsStory(x),el);
},true);
document.addEventListener("keydown",e=>{
  if(PD&&e.key==="Escape"){e.stopImmediatePropagation();pdDicht();return}   // alleen de bovenste pop-up dicht (bijv. vanuit een Kansâh-rapport)
  if(PD&&!$("pdPop").hidden&&(e.key==="ArrowLeft"||e.key==="ArrowRight")&&!e.target.closest("input,select,textarea")){pdNaar(e.key==="ArrowLeft"?1:-1);return}
  if(e.key!=="Enter"&&e.key!==" ")return;
  const el=e.target.closest&&e.target.closest("[data-pd][tabindex]");
  if(!el||e.target!==el)return;                                                   // alleen als de rij zelf de focus heeft
  e.preventDefault();pdOpen(el.dataset.pd,el.dataset.pdst==="1",el);
},true);
let pdRsz;addEventListener("resize",()=>{clearTimeout(pdRsz);pdRsz=setTimeout(()=>{if(PD)pdGroeiTeken()},150)});
