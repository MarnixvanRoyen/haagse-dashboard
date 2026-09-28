// insta.js — onderdeel Insta (@the_hague_beachlife). Data uit Supabase (09_insta.sql + 09b_insta_extra.sql).
// Let op: Meta rekent dagen in Los Angeles-tijd (9 uur achter op Den Haag). Account-cijfers per dag gebruiken die "Meta-dag".

let IG={acc:null,profiel:[],dag:[],posts:[],stories:[],err:null};
let igKies="soort";            // "Wat werkt": waarop vergelijken
let igLabelAantal=20;          // hoeveel posts in de muziek-lijst
let igAlleenLeeg=false;        // alleen posts zonder muziek-label tonen

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
      sb.from("ig_story").select("media_id,soort,gepost_om,permalink,cijfers,fout").gte("gepost_om",since).order("gepost_om",{ascending:false}).range(0,499)]);
    for(const r of [a,p,d,s])if(r.error)throw r.error;
    IG={acc:a.data[0]||null,profiel:p.data,dag:d.data.map(x=>({dag:String(x.dag).slice(0,10),c:x.cijfers||{}})),posts:m,stories:s.data,err:null};
  }catch(e){IG={acc:null,profiel:[],dag:[],posts:[],stories:[],err:e.message||String(e)}}
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
  const s={dagen:0};
  IG.dag.forEach(r=>{if(r.dag<van||r.dag>tot)return;s.dagen++;
    for(const [k,v] of Object.entries(r.c))if(typeof v==="number")s[k]=(s[k]||0)+v});
  return s;
}

function igCompute(){
  const vandaag=vandaagLA(),gist=dagMin(vandaag,1);
  const w=igSom(dagMin(vandaag,7),gist), vw=igSom(dagMin(vandaag,14),dagMin(vandaag,8)), nu=igSom(vandaag,vandaag);
  const metSplit=IG.dag.filter(r=>r.dag>=dagMin(vandaag,7)&&r.dag<=gist&&r.c.reach_nieuw!=null);
  const nieuw=metSplit.reduce((a,r)=>a+r.c.reach_nieuw,0), volg=metSplit.reduce((a,r)=>a+(r.c.reach_volgers||0),0);
  const vNieuw=metSplit.reduce((a,r)=>a+(r.c.views_nieuw||0),0), vVolg=metSplit.reduce((a,r)=>a+(r.c.views_volgers||0),0);
  const posts7=IG.posts.filter(p=>p.gepost_om&&Date.parse(p.gepost_om)>Date.now()-7*864e5);
  return {vandaag,w,vw,nu,
    bereikDag:w.dagen?(w.reach||0)/w.dagen:null, bereikDagV:vw.dagen?(vw.reach||0)/vw.dagen:null,
    nieuwPct:nieuw+volg?nieuw/(nieuw+volg):null, viewsNieuwPct:vNieuw+vVolg?vNieuw/(vNieuw+vVolg):null,
    kwal:w.reach?((w.shares||0)+(w.saves||0))*1000/w.reach:null, kwalV:vw.reach?((vw.shares||0)+(vw.saves||0))*1000/vw.reach:null,
    follows:w.follows||0, unfollows:w.unfollows||0, posts7:posts7.length,
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
function igTrackTitels(){
  const t=new Set();(SCL.tracks||[]).forEach(x=>x.title&&t.add(x.title.trim()));
  return [...t].sort((a,b)=>a.localeCompare(b,"nl"));
}
function igPlaysEffect(titel,postDag){
  const tr=(SCL.tracks||[]).find(x=>x.title&&x.title.trim().toLowerCase()===titel.toLowerCase());if(!tr)return null;
  const s=(SCL.snaps||[]).filter(x=>x.track_id===tr.track_id).sort((a,b)=>a.snap_date<b.snap_date?-1:1);
  const op=d=>{let v=null;for(const x of s){if(x.snap_date<=d)v=+x.plays;else break}return v};
  const vandaag=vandaagAms(),eind=dagMin(postDag,-6)<vandaag?dagMin(postDag,-6):vandaag;
  const v0=op(dagMin(postDag,1)),vMin=op(dagMin(postDag,8)),v1=op(eind);
  if(v0==null||v1==null)return null;
  const dagenNa=Math.max(1,Math.round((Date.parse(eind)-Date.parse(dagMin(postDag,1)))/864e5));
  return {na:v1-v0,dagenNa,voor:vMin==null?null:v0-vMin,url:tr.permalink_url};
}

/* ---------- tekenen ---------- */
function igKolommen(el,data,aria){   // gestapelde kolommen: data=[{d,parts:[{v,c}]}]
  const W=Math.max(300,Math.round(el.clientWidth||1000)),H=W<600?180:220,ml=40,mr=6,mt=10,mb=26,iw=W-ml-mr,ih=H-mt-mb;
  const top=niceMax(Math.max(1,...data.map(d=>d.parts.reduce((a,p)=>a+p.v,0)))),bw=iw/data.length;
  const y=v=>mt+ih-v/top*ih;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">`;
  [0,top/2,top].forEach(t=>{s+=`<line class="${t?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${y(t)}" y2="${y(t)}"/><text x="${ml-6}" y="${y(t)+4}" text-anchor="end">${nf0.format(t)}</text>`});
  data.forEach((d,i)=>{let acc=0;const x=ml+i*bw+bw*.15;
    const vis=d.parts.filter(p=>p.v>0);
    vis.forEach((p,j)=>{const h=p.v/top*ih;const yt=y(acc+p.v);
      s+=j===vis.length-1?`<path d="${roundTop(x,yt,bw*.7,h,3)}" fill="var(--${p.c})"/>`:`<rect x="${x}" y="${yt}" width="${bw*.7}" height="${h}" fill="var(--${p.c})"/>`;acc+=p.v});
    s+=`<rect class="hit" x="${ml+i*bw}" y="${mt}" width="${bw}" height="${ih}"><title>${d.tip}</title></rect>`;
    if((data.length-1-i)%7===0)s+=`<text x="${ml+i*bw+bw/2}" y="${H-8}" text-anchor="middle">${dLabel(d.d)}</text>`});
  el.innerHTML=s+"</svg>";
}
function igStat(k,v,s){return `<div class="ytstat"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`}
function igVs(a,b,pctMode){if(a==null||b==null||!b)return "";const d=a/b-1;
  return ` · vorige week ${pctMode?nf0.format(b):nf0.format(b)}${d>0.05?' <span class="up">↑ '+pct(d)+"</span>":d<-0.05?' <span class="down">↓ '+pct(-d)+"</span>":""}`}

function renderInsta(){
  if(!$("igStats"))return;
  const leeg=IG.err||!IG.acc;
  $("igBlok").hidden=!!leeg;$("igNog").hidden=!leeg;
  if(leeg){$("igNogTekst").innerHTML=IG.err?(/ig_post_stats|relation|schema cache/i.test(IG.err)
      ?"De Insta-tabellen zijn nog niet compleet. Draai <code>supabase/09_insta.sql</code> en <code>09b_insta_extra.sql</code>."
      :"Insta-cijfâhs ophale lukte nie: "+esc(IG.err)):"Nog geen metingen. Wacht tot vannacht of draai <code>select public.ig_refresh(7, 20);</code> in Supabase.";return}
  const c=igCompute();

  // 1. tegels
  $("igSub").innerHTML=`@${esc(IG.acc.gebruikersnaam||"the_hague_beachlife")} · elke nacht vanzelf bijgewerkt, en als je het dashboard opent (hooguit 1x per 10 min)${liveStatus("ig","09b_insta_extra.sql")}. Dagen zijn Meta-dagen (Amerikaanse tijd).`;
  $("igStats").innerHTML=[
    igStat("Volgâhs",nf0.format(IG.acc.volgers||0),`${plus(c.follows-c.unfollows)} netto laatste 7 dagen (+${nf0.format(c.follows)} erbè, −${nf0.format(c.unfollows)} eraf)`),
    igStat("Bereik per dag",c.bereikDag==null?"—":nf0.format(c.bereikDag),"gemiddeld, laatste 7 dagen"+igVs(c.bereikDag,c.bereikDagV)+(c.nu.reach?` · vandaag tot nu ${nf0.format(c.nu.reach)}`:"")),
    igStat("Nieuwe mensen",c.nieuwPct==null?"—":pct(c.nieuwPct),c.nieuwPct==null?"komt na de eerste nacht met 09b":"van je bereik volgt je (nog) nie"+(c.viewsNieuwPct!=null?` · ${pct(c.viewsNieuwPct)} van de weergaven`:"")),
    igStat("Gedeeld + bewaard",c.kwal==null?"—":nf0.format(c.kwal),`per 1.000 bereik, laatste 7 dagen${igVs(c.kwal,c.kwalV)} · delen/bewaren weegt zwaar bij Insta`),
    igStat("Posts",nf0.format(c.posts7),"laatste 7 dagen"+(c.laatstePost?` · laatste ${dLabel(dagNL(c.laatstePost.gepost_om))}`:""))
  ].join("");

  // 2. bereik per dag, volgers vs nieuw
  const dagen=[];for(let i=30;i>=1;i--)dagen.push(dagMin(c.vandaag,i-1));
  const per=new Map(IG.dag.map(r=>[r.dag,r.c]));
  igKolommen($("igChart"),dagen.map(d=>{const x=per.get(d)||{};const split=x.reach_nieuw!=null;
    const parts=split?[{v:x.reach_volgers||0,c:"groen"},{v:x.reach_nieuw||0,c:"hy"}]:[{v:x.reach||0,c:"muted"}];
    return {d,parts,tip:`${dLabel(d,1)}${d===c.vandaag?" (tot nu)":""}: bereik ${nf0.format(x.reach||0)}`+(split?` · volgers ${nf0.format(x.reach_volgers)} · nieuw ${nf0.format(x.reach_nieuw)}`:"")+(x.follows!=null?` · +${x.follows} / −${x.unfollows||0} volgâhs`:"")}}),"Bereik per dag");

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

  // 4. toppers laatste 90 dagen
  const t90=IG.posts.filter(p=>p.bereik!=null&&Date.parse(p.gepost_om)>Date.now()-90*864e5).sort((a,b)=>b.bereik-a.bereik).slice(0,10);
  $("igTop").innerHTML=t90.length?`<thead><tr><th class="n">#</th><th>Post</th><th class="n">Bereik</th><th class="n">Kwaliteit</th><th class="n">Volgâhs erbè</th><th class="n">Profielbezoek</th></tr></thead><tbody>`+
    t90.map((p,i)=>`<tr><td class="n">${i+1}</td><td><a href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${dLabel(dagNL(p.gepost_om))} · ${soortNaam(p)}</a> <span class="igcap">${esc((p.bijschrift||"").replace(/^Oh oh #thehague,?\s*/i,"").slice(0,70))}</span></td>
      <td class="n">${nf0.format(p.bereik)}</td><td class="n">${p.kwaliteit==null?"—":nf0.format(p.kwaliteit)}</td><td class="n">${p.nieuwe_volgers==null?"—":nf0.format(p.nieuwe_volgers)}</td><td class="n">${p.profielbezoeken==null?"—":nf0.format(p.profielbezoeken)}</td></tr>`).join("")+"</tbody>"
    :'<tbody><tr><td class="sub">Nog geen posts met cijfâhs in de laatste 90 dagen.</td></tr></tbody>';

  renderIgStories();
  renderIgSneek();
  renderIgMuziek();
}

function renderIgStories(){
  const st=IG.stories.filter(s=>Date.parse(s.gepost_om)>Date.now()-7*864e5);
  if(!st.length){$("igStories").innerHTML='<p class="sub">Nog geen stories gemeten in de laatste 7 dagen. Stories worden elk uur opgehaald zolang ze online staan (24 uur).</p>';return}
  // per dag in volgorde van posten: zo zie je waar mensen afhaken
  const perDag=new Map();[...st].reverse().forEach(s=>{const d=dagNL(s.gepost_om);if(!perDag.has(d))perDag.set(d,[]);perDag.get(d).push(s)});
  let h=`<div class="tablewrap"><table><thead><tr><th>Story</th><th class="n">Bereik</th><th class="n">Weergaven</th><th class="n">Tikte weg</th><th class="n">Reacties</th><th class="n">Sneek-bezoek</th></tr></thead><tbody>`;
  const links=new Map((GC.bronnen||[]).filter(r=>/^story-/i.test(r.bron)).map(r=>[String(r.bron).toLowerCase(),0]));
  (GC.bronnen||[]).forEach(r=>{const k=String(r.bron).toLowerCase();if(links.has(k))links.set(k,links.get(k)+(+r.aantal||0))});
  [...perDag].reverse().forEach(([d,rij])=>{
    const eerste=rij[0].cijfers&&rij[0].cijfers.reach;
    const ddmm=d.slice(8,10)+d.slice(5,7);const sneek=[...links].filter(([k])=>k.startsWith("story-"+ddmm)).reduce((a,[,n])=>a+n,0);
    rij.forEach((s,i)=>{const x=s.cijfers||{};const weg=x.nav_weg!=null&&(x.views||x.reach)?x.nav_weg/(x.views||x.reach):null;
      const vast=eerste&&x.reach!=null&&i?` <span class="sub">(${pct(x.reach/eerste)} van de 1e)</span>`:"";
      h+=`<tr><td><a href="${esc(s.permalink||"#")}" target="_blank" rel="noopener">${dLabel(d)} ${tijdAms(s.gepost_om)}</a> · ${i+1}/${rij.length}</td>
      <td class="n">${x.reach==null?(s.fout?'<span class="sub" title="'+esc(s.fout)+'">nog geen</span>':"—"):nf0.format(x.reach)+vast}</td><td class="n">${x.views==null?"—":nf0.format(x.views)}</td>
      <td class="n">${weg==null?"—":pct(weg)}</td><td class="n">${x.replies==null?"—":nf0.format(x.replies)}</td><td class="n">${i===0&&sneek?nf0.format(sneek)+" (hele dag)":""}</td></tr>`})});
  $("igStories").innerHTML=h+'</tbody></table></div><p class="sub" style="margin:10px 0 0"><b>Tikte weg</b> = deel van de weergaven waarbij iemand de stories wegtikte (hoe lager, hoe betâh). <b>Sneek-bezoek</b> telt alleen met een eigen link (<code>?ref=story-…</code>).</p>';
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

function renderIgMuziek(){
  const titels=igTrackTitels();
  const recent=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>titels.includes(t)).slice(0,3);
  const opties=`<option value="">— nog niet gekozen —</option><option value="(geen)">Geen eigen muziek</option>`+
    (recent.length?`<optgroup label="Laatst gekozen">${recent.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`:"")+
    `<optgroup label="Alle nummâhs (SoundCloud)">${titels.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</optgroup>`;
  let lijst=IG.posts.filter(p=>p.gepost_om);
  if(igAlleenLeeg)lijst=lijst.filter(p=>!labelsVan(p,"muziek").length);
  const zonder=IG.posts.filter(p=>!labelsVan(p,"muziek").length).length;
  $("igLabelSub").innerHTML=`Meta vertelt niet welk geluid onder een post zit, dus dat kies je hier zelf. Nog ${nf0.format(zonder)} van de ${nf0.format(IG.posts.length)} posts zonder keuze. Begin bij de nieuwste: daar heb je de meeste cijfâhs van.`;
  $("igLabels").innerHTML=lijst.slice(0,igLabelAantal).map(p=>{
    const m=labelsVan(p,"muziek")[0]||"",ond=labelsVan(p,"onderwerp");
    const eff=m&&m!=="(geen)"&&m!=="(eigen muziek)"?igPlaysEffect(m,dagNL(p.gepost_om)):null;
    const effTxt=eff?`<span class="igeff" title="SoundCloud-plays van dit nummâh">♪ na de post: ${plus(eff.na)} plays in ${eff.dagenNa} dag${eff.dagenNa>1?"en":""}${eff.voor!=null?` (week ervoor ${plus(eff.voor)})`:""}</span>`:"";
    return `<div class="igpost" data-id="${esc(p.media_id)}">
      <a class="igthumb" href="${esc(p.permalink||"#")}" target="_blank" rel="noopener">${p.plaatje?`<img src="${esc(p.plaatje)}" alt="" loading="lazy" onerror="this.remove()">`:""}<span>${soortNaam(p)}</span></a>
      <div class="iginfo"><b>${dLabel(dagNL(p.gepost_om),1)}</b> · ${p.bereik==null?"nog geen cijfâhs":"bereik "+nf0.format(p.bereik)+(p.kwaliteit!=null?" · kwaliteit "+nf0.format(p.kwaliteit):"")}
        <span class="igcap">${esc((p.bijschrift||"").replace(/^Oh oh #thehague,?\s*/i,"").slice(0,90))}</span>
        <span class="igchips">${ond.map(o=>`<span class="chip mute">${esc(o)}</span>`).join("")}${effTxt}</span></div>
      <select class="igsel" aria-label="Muziek onder deze post">${opties.replace(`value="${esc(m)}"`,`value="${esc(m)}" selected`)}${m&&m!=="(geen)"&&!titels.includes(m)?`<option value="${esc(m)}" selected>${esc(m)}</option>`:""}</select>
    </div>`}).join("")||'<p class="sub">Alle posts hebben een keuze. Top, âhwe!</p>';
  $("igMeer").hidden=lijst.length<=igLabelAantal;
}

async function igZetMuziek(id,nieuw){
  const p=IG.posts.find(x=>x.media_id===id);if(!p)return;
  const oud=labelsVan(p,"muziek")[0]||"";
  const {data,error}=nieuw?await sb.rpc("ig_label_zet",{p_media_id:id,p_soort:"muziek",p_label:nieuw,p_aan:true})
                           :await sb.rpc("ig_label_zet",{p_media_id:id,p_soort:"muziek",p_label:oud,p_aan:false});
  if(error){showMsg("Opslaan lukte nie: "+error.message);renderIgMuziek();return}
  p.labels=data||[];
  if(nieuw&&nieuw!=="(geen)"){const r=JSON.parse(store.get("hc_ig_nummers")||"[]").filter(t=>t!==nieuw);r.unshift(nieuw);store.set("hc_ig_nummers",JSON.stringify(r.slice(0,5)))}
  renderInsta();
}

/* ---------- knoppen ---------- */
document.addEventListener("change",e=>{const s=e.target.closest(".igsel");if(s)igZetMuziek(s.closest(".igpost").dataset.id,s.value)});
document.addEventListener("click",async e=>{
  const k=e.target.closest("#igKies button");if(k){igKies=k.dataset.v;renderInsta();return}
  if(e.target.closest("#igMeer")){igLabelAantal+=20;renderIgMuziek();return}
  if(e.target.closest("#igAlleenLeeg")){igAlleenLeeg=!igAlleenLeeg;e.target.setAttribute("aria-pressed",igAlleenLeeg);igLabelAantal=20;renderIgMuziek();return}
  const l=e.target.closest("[data-iglink]");if(l){
    const url=igNieuweLink(l.dataset.iglink);$("igLinkUit").value=url;$("igLinkUit").hidden=false;
    const ref=url.split("ref=")[1];if(ref!=="bio"){const r=JSON.parse(store.get("hc_ig_links")||"[]");r.push(ref);store.set("hc_ig_links",JSON.stringify(r.slice(-50)))}
    try{await navigator.clipboard.writeText(url);showMsg("Link gekopieerd: "+url+" — plak hem in je link-sticker.",true)}
    catch(err){$("igLinkUit").select();showMsg("Kopiëren lukte nie vanzelf: selecteer de link en kopieer hem zelf.",false)}
    return}
  if(e.target.closest("#igRefresh")){const b=$("igRefresh");b.disabled=true;b.textContent="Effe geduld…";
    const {data,error}=await sb.rpc("ig_live",{min_minuten:5});
    if(error)showMsg("Insta verversen lukte nie: "+error.message);
    else{LIVE.ig=data;await Promise.all([loadIG(),loadGC()]);renderInsta();
      showMsg(data&&data.ververst?(data.fout?"Deels bijgewerkt: "+data.fout:"Insta bijgewerkt, âhwe!"):"Net al bijgewerkt (om "+tijdAms(data&&data.om)+"), probeer het over een paar minuten nog eens.",!(data&&data.fout))}
    b.disabled=false;b.textContent="Nâh ververse"}
});
let igRsz;addEventListener("resize",()=>{clearTimeout(igRsz);igRsz=setTimeout(()=>{if(sectie==="insta")renderInsta()},150)});

/* ---------- tegel op het Ovâhzicht ---------- */
function instaTegel(){
  if(IG.err||!IG.acc)return `<article class="tegel binnenkort">
    <div class="tkop"><h2>Insta</h2><span class="tag">@the_hague_beachlife</span></div>
    <p class="kd">Nog geen cijfâhs</p><p class="s">${IG.err?"Ophalen lukte nie: "+esc(IG.err):"Wacht tot vannacht, dan staan ze erin."}</p>
    <button class="btn" type="button" data-ga="insta">Kèk bè Insta</button></article>`;
  const c=igCompute(),g=igSneek();
  return `<article class="tegel">
    <div class="tkop"><h2>Insta</h2><span class="tag">@${esc(IG.acc.gebruikersnaam||"the_hague_beachlife")}</span></div>
    <p class="tlbl">Volgâhs</p>
    <div class="tgroot">${nf0.format(IG.acc.volgers||0)}</div>
    <p class="s">${plus(c.follows-c.unfollows)} netto laatste 7 dagen</p>
    <div class="trijen">
      ${tegelRij("Bereik per dag",c.bereikDag==null?"—":nf0.format(c.bereikDag),"gemiddeld, laatste 7 dagen"+igVs(c.bereikDag,c.bereikDagV)+(c.nu.reach?` · vandaag tot nu ${nf0.format(c.nu.reach)}`:"")+liveStatus("ig","09b_insta_extra.sql"))}
      ${tegelRij("Nieuwe mensen",c.nieuwPct==null?"—":pct(c.nieuwPct),"van je bereik volgt je (nog) nie")}
      ${tegelRij("Naâh Sneek",nf0.format(g.d7),"bezoekâhs via Insta + Facebook, laatste 7 dagen")}
    </div>
    <button class="btn yellow" type="button" data-ga="insta">Kèk bè Insta</button>
  </article>`;
}
