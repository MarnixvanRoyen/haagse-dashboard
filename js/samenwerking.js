// samenwerking.js — kaart "Samenwerkinge" in de Insta-tab + waarschuwing voor de Facebook-sleutel.
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

let IGS={partners:[],posts:[],info:[],laat:[],fb:null,err:null};
let igsPeriode="365";     // "365" (laatste jaar) of "alles"
let igsSorteer="extra";   // "extra" (extra volgâhs) of "vaak" (vaakst samen)
let igsAlles=false;       // alle partners tonen of de eerste 12
const IGS_MIN=3;          // vanaf zoveel posts een oordeel
const IGS_WACHT=3;        // posts jonger dan zoveel dagen tellen nog niet mee (cijfers groeien nog)
const IGS_LAAT=3*864e5;   // aangenomen meer dan 3 dagen na de post = laat (we checken elke 3 uur, dus ± 2½–3 dagen echt)

async function igSamenLaden(){
  try{
    const [p,pp,i,f,l]=await Promise.all([
      igAlles(()=>sb.from("ig_partner").select("media_id,partner,status,aangenomen_om,weg,weg_om").order("media_id").order("partner")),
      igAlles(()=>sb.from("ig_partner_post").select("media_id,gepost_om,aangenomen,uitgenodigd").order("media_id")),
      sb.from("ig_partner_info").select("partner,volgers,fout").range(0,4999),
      sb.from("fb_token").select("verloopt_op,data_verloopt_op,gelukt_om,fout,fout_om").eq("naam","facebook_access_token").limit(1),
      sb.from("ig_partner_laat_effect").select("media_id,partner,gepost_om,aangenomen_om,basis_om,basis,na_om,na,voor_om,voor").range(0,1999).then(r=>r,()=>({data:[]}))]);
    for(const r of [i,f])if(r.error)throw r.error;
    IGS={partners:p,posts:pp,info:i.data||[],laat:(l&&!l.error&&l.data)||[],fb:(f.data&&f.data[0])||null,err:null};
  }catch(e){IGS={partners:[],posts:[],info:[],laat:[],fb:null,err:e.message||String(e)}}
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

const igsGem=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
function igsKort(v){return v==null?"—":v>=1e6?igNf1.format(v/1e6)+"M":v>=1e4?nf0.format(v/1e3)+"k":v>=1e3?igNf1.format(v/1e3)+"k":nf0.format(v)}

function igSamen(){
  const stats=new Map(IG.posts.map(p=>[p.media_id,p]));
  const grens=igsPeriode==="alles"?0:Date.now()-365*864e5, jong=Date.now()-IGS_WACHT*864e5;
  const pp=IGS.posts.filter(x=>x.gepost_om&&Date.parse(x.gepost_om)>=grens);
  const datum=new Map(pp.map(x=>[x.media_id,x.gepost_om]));
  const actief=IGS.partners.filter(r=>!r.weg&&datum.has(r.media_id));
  const isLaat=r=>r.status==="Accepted"&&!!r.aangenomen_om&&Date.parse(r.aangenomen_om)-Date.parse(datum.get(r.media_id))>IGS_LAAT;
  const perPost=new Map();   // media_id -> {opTijd, laat}: aangenomen partners per post
  actief.forEach(r=>{if(r.status!=="Accepted")return;const x=perPost.get(r.media_id)||{opTijd:0,laat:0};if(isLaat(r))x.laat++;else x.opTijd++;perPost.set(r.media_id,x)});

  // posts met bruikbare cijfers (bereik + nieuwe volgers bekend, minstens 3 dagen oud)
  const bruik=new Map();
  pp.forEach(x=>{const s=stats.get(x.media_id);
    if(!s||!(s.bereik>0)||s.nieuwe_volgers==null||Date.parse(x.gepost_om)>jong)return;
    const a=perPost.get(x.media_id)||{opTijd:0,laat:0};
    if(!a.opTijd&&a.laat)return;                        // alleen late partners: geen solo en geen gewone samenwerking
    bruik.set(x.media_id,{id:x.media_id,aan:a.opTijd,b:s.bereik,v:s.nieuwe_volgers,pr:s.profielbezoeken,lk:(s.likes||0)+(s.gedeeld||0)})});
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

  const info=new Map(IGS.info.map(x=>[x.partner,x]));
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
    return {naam,n,vpp,gewoonV,extra,bx,q:kwal(P),qo:kwal(O),oordeel,zeker:n>=IGS_MIN,u:uit.get(naam),info:info.get(naam)};
  });
  if(igsSorteer==="vaak")rijen.sort((a,b)=>b.n-a.n||(b.extra??-1e9)-(a.extra??-1e9));
  else rijen.sort((a,b)=>b.zeker-a.zeker||(b.extra??-1e9)-(a.extra??-1e9)||b.n-a.n);

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
  if(igsSorteer!=="vaak")rijen.sort((a,b)=>b.zeker-a.zeker||(b.totaal??-1e9)-(a.totaal??-1e9)||b.n-a.n);
  // weggehaald in de laatste 90 dagen (alle posts, ook buiten de periode)
  const alleDatum=new Map(IGS.posts.map(x=>[x.media_id,x.gepost_om]));
  const weg=IGS.partners.filter(r=>r.weg&&r.weg_om&&Date.parse(r.weg_om)>Date.now()-90*864e5)
    .map(r=>({naam:r.partner,post:alleDatum.get(r.media_id),om:r.weg_om,was:r.status})).sort((a,b)=>a.om<b.om?1:-1);
  return {rijen,tel,aan,alles,nooit,zelden,laat,weg,effect,
    collab:{n:collab.length,medB:med(collab.map(x=>x.b)),medV:med(collab.map(x=>x.v)),...kwal(collab)},
    solo:{n:solo.length,medB:med(solo.map(x=>x.b)),medV:med(solo.map(x=>x.v)),...kwal(solo)},
    zonderCijfers:pp.filter(x=>(perPost.get(x.media_id)||{}).opTijd>0&&!bruik.has(x.media_id)).length,
    gecheckt:IGS.posts.length,metGrootte:rijen.some(r=>r.info&&r.info.volgers!=null)};
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

function renderIgSamen(){
  if(!$("igSamen"))return;
  document.querySelectorAll("#igsPeriode button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igsPeriode));
  document.querySelectorAll("#igsSorteer button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===igsSorteer));
  const leeg=msg=>{$("igsSub").innerHTML=msg;$("igsStats").innerHTML="";$("igSamen").innerHTML="";$("igsOnder").innerHTML=""};
  if(IGS.err)return leeg(/relation|schema cache|does not exist/i.test(IGS.err)
    ?"Nog niet klaar: draai eerst <code>supabase/12_samenwerkingen.sql</code> in Supabase."
    :"Samenwerkingen ophalen lukte niet: "+esc(IGS.err));
  if(!IGS.posts.length)return leeg("Nog geen partners opgehaald. Dat gebeurt elke nacht vanzelf (07:05), of draai <code>select public.ig_partners_refresh(45);</code> in Supabase.");

  const s=igSamen(),c=s.collab,o=s.solo;
  $("igsSub").innerHTML=`Welke partners helpen je groeien? Per partner: de posts waarop die partner je uitnodiging <b>aannam</b>, vergeleken met al je andere samenwerkingen${igsPeriode==="365"?" van het laatste jaar":""}. Een partner die niet aannam telt niet mee: dan staat de post niet op hun profiel.`;
  $("igsStats").innerHTML=[
    igStat("Goed voor je",nf0.format(s.tel.goed),"partners: meer nieuwe volgâhs per post"),
    igStat("Alleen bereik",nf0.format(s.tel.bereik),"partners: meer kijkâhs, nie meer volgâhs"),
    igStat("Levert niks op",nf0.format(s.tel.niks),`partners · vanaf ${IGS_MIN} posts samen, de rest is nog te vroeg`),
    igStat("Neme aan",s.alles?pct(s.aan/s.alles):"—",`${nf0.format(s.aan)} van ${nf0.format(s.alles)} uitnodigingen aangenomen`)
  ].join("");

  const toon=igsAlles?s.rijen:s.rijen.slice(0,12);
  $("igSamen").innerHTML=s.rijen.length?`<thead><tr><th>Partnâh</th><th class="n">Posts samen</th><th class="n">Neemt aan</th><th class="n">Kijkâhs</th><th class="n">Volgâhs per post</th><th class="n">Extra volgâhs</th><th class="n">Volgâhs per 1.000</th><th class="n">Profielbezoek per 1.000</th><th class="n">Likes + delen per kijkâh</th>${s.metGrootte?'<th class="n">Grootte</th>':""}<th class="igsoordeel">Oordeel</th></tr></thead><tbody>`+
    toon.map(r=>`<tr><td><a href="https://www.instagram.com/${encodeURIComponent(r.naam)}/" target="_blank" rel="noopener">@${esc(r.naam)}</a>${r.u.laatst?`<span class="igsvs">laatst ${dLabel(dagNL(r.u.laatst),1)}</span>`:""}<div class="igsmob">${igsOordeel(r)}</div></td>
      <td class="n">${nf0.format(r.n)}</td>
      <td class="n">${nf0.format(r.u.aan)} van ${nf0.format(r.u.alles)}${r.u.alles>=5&&r.u.aan/r.u.alles<0.3?'<span class="igsvs">neemt zelden aan</span>':""}${r.u.laat?`<span class="igsvs">${r.u.laat}× te laat</span>`:""}</td>
      <td class="n">${r.bx==null?"—":igNf1.format(r.bx)+"×"}<span class="igsvs">t.o.v. andere</span></td>
      <td class="n">${igsVs(r.vpp,r.gewoonV,v=>igNf1.format(v))}</td>
      <td class="n">${r.totaal==null?"—":`<b class="${r.totaal>=2?"up":r.totaal<=-2?"down":""}">${plus(Math.round(r.totaal))}</b>`}${r.laatN?`<span class="igsvs">waarvan ${plus(Math.round(r.extraLaat))} na laat aannemen</span>`:""}</td>
      <td class="n">${igsVs(r.q.v1k,r.qo.v1k,v=>igsNf2.format(v))}</td>
      <td class="n">${igsVs(r.q.pr1k,r.qo.pr1k,v=>igNf1.format(v))}</td>
      <td class="n">${igsVs(r.q.lk,r.qo.lk,v=>pct(v))}</td>
      ${s.metGrootte?`<td class="n">${r.info&&r.info.volgers!=null?igsKort(r.info.volgers):"—"}</td>`:""}
      <td class="igsoordeel">${igsOordeel(r)}</td></tr>`).join("")+"</tbody>"
    :`<tbody><tr><td class="sub">Nog geen samenwerkingen met cijfers in deze periode.</td></tr></tbody>`;
  $("igsMeer").hidden=s.rijen.length<=12;$("igsMeer").textContent=igsAlles?"Minder tonen":`Alle ${nf0.format(s.rijen.length)} partners tonen`;

  const delen=[];
  if(o.n)delen.push(`<p><b>Zonder partnâh</b> (niemand nam aan): ${nf0.format(o.n)} posts. Kijkers ${c.medB&&o.medB!=null?igNf1.format(o.medB/c.medB)+"×":"—"} een samenwerking, `
    +`maar ${o.v1k==null?"—":igsNf2.format(o.v1k)} volgers per 1.000 kijkers (samenwerkingen ${c.v1k==null?"—":igsNf2.format(c.v1k)}). `
    +`Per post ${o.medV==null?"—":igNf1.format(o.medV)} nieuwe volgers, bij een samenwerking ${c.medV==null?"—":igNf1.format(c.medV)}. Dit is je controlegroep: zo zie je wat een partner extra doet.</p>`);
  if(s.nooit.length)delen.push(`<p><b>Neme nooit aan</b> (3 of meer uitnodigingen): ${s.nooit.slice(0,15).map(([n,u])=>`<a class="chip mute" href="https://www.instagram.com/${encodeURIComponent(n)}/" target="_blank" rel="noopener">@${esc(n)} · 0 van ${u.alles}</a>`).join(" ")}${s.nooit.length>15?` en nog ${s.nooit.length-15}`:""}. Uitnodigen mag, maar reken er niet op.</p>`);
  if(s.zelden.length)delen.push(`<p><b>Neme zelden aan</b>: ${s.zelden.slice(0,10).map(([n,u])=>`@${esc(n)} (${u.aan} van ${u.alles})`).join(", ")}. Als ze wél aannemen kan het veel opleveren: kijk hierboven bij hun rij.</p>`);
  if(s.laat.length){
    const eff=n=>{const l=(s.effect.get(n)||[]);if(!l.length)return "";
      const klaar=l.filter(e=>e.dV!=null||e.dB!=null);
      if(!klaar.length)return " · meet nog";
      const b=klaar.reduce((a,e)=>a+(e.extraB||0),0),v=klaar.reduce((a,e)=>a+(e.extraV||0),0),bezig=l.some(e=>e.meet);
      return ` · na aannemen ${plus(Math.round(b))} kijkers, ${plus(Math.round(v))} volgers${bezig?` (meet nog, dag ${nf0.format(Math.max(...l.map(e=>e.dagen||0)))} van 14)`:""}`};
    delen.push(`<p><b>Laat aangenomen</b> (meer dan ± 3 dagen na je post): ${s.laat.slice(0,12).map(([n,u])=>`@${esc(n)} (${u.laat}×${eff(n)})`).join(", ")}${s.laat.length>12?` en nog ${s.laat.length-12}`:""}. Zulke posts tellen niet mee in het oordeel, want de post had zijn kijkers toen al. Wat de partner daarna nog opleverde, meten we apart: alles wat erbij kwam na het aannemen, min wat de post in zijn eigen tempo nog zou doen. Dat telt mee in <b>Extra volgâhs</b>.</p>`)}
  if(s.weg.length)delen.push(`<p><b>Weggehaald</b> (laatste 90 dagen): ${s.weg.slice(0,12).map(w=>`@${esc(w.naam)}${w.post?` bij post van ${dLabel(dagNL(w.post))}`:""}${w.was==="Accepted"?" (had aangenomen)":""}`).join(", ")}${s.weg.length>12?` en nog ${s.weg.length-12}`:""}. Bewaard als geschiedenis; ze tellen niet mee.</p>`);
  delen.push(`<p class="sub">Hoe het werkt: <b>Volgâhs per post</b> en <b>Kijkâhs</b> = de middelste post met deze partner, tegen de middelste van je andere samenwerkingen ("andere"). Zo telt één virale post niet te zwaar, ook niet als een andere partner die viraal maakte. <b>Extra volgâhs</b> = ongeveer hoeveel volgers de posts met deze partner meer (of minder) opleverden dan evenveel gewone samenwerkingsposts. <b>Per 1.000</b> = kwaliteit: hoeveel van de kijkers volger worden of je profiel bekijken. Een post met meer partners telt bij elke partner mee (de cijfers zijn gedeeld), en posts jonger dan ${IGS_WACHT} dagen tellen nog niet mee. Nam een partner pas later aan, dan telt die post niet voor die partner. Van samenwerkingen van vóór 1 oktober weten we niet wanneer ze aannamen; die tellen gewoon mee.`
    +(s.zonderCijfers?` ${nf0.format(s.zonderCijfers)} samenwerkingen hebben nog geen cijfers; het archief vult zich elke nacht aan.`:"")
    +(s.metGrootte?"":" Partnergrootte komt erbij zodra de Facebook-sleutel het recht <code>instagram_manage_insights</code> heeft.")+`</p>`);
  $("igsOnder").innerHTML=delen.join("");
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
      <li>Ga naar de <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a>. Rechts: <b>Meta App</b> = haagse-dashboard, <b>User or Page</b> = User Token, en bij Permissions <code>instagram_basic</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>.</li>
      <li>Klik <b>Generate Access Token</b>. Kies in het venster "<b>current Pages only</b>" (The Hague Beachlife) en "<b>current Instagram accounts only</b>" (the_hague_beachlife).</li>
      <li>Klik op het blauwe <b>i</b>-rondje links in het sleutelvak → <b>Open in Access Token Tool</b> → <b>Extend Access Token</b> → <b>Debug</b>. Bij <i>Expires</i> moet nu "in about 2 months" staan.</li>
      <li>Kopieer de sleutel uit het vak bovenaan (klik erin, Cmd+A, Cmd+C). Plak hem nergens anders dan in de Vault.</li>
      <li>Supabase → <b>Integrations</b> → <b>Vault</b> → <code>facebook_access_token</code> → <b>Edit</b> → plakken → <b>Save</b>.</li>
      <li>Wil je niet tot vannacht wachten: SQL Editor → <code>select public.fb_token_check(), public.ig_partners_refresh(45);</code> → Run. Daarna verdwijnt deze melding.</li>
    </ol>${k.detail?`<p class="sub">Melding van Meta: ${esc(k.detail)}</p>`:""}</details>
  </div>`;
}

document.addEventListener("click",e=>{
  const p=e.target.closest("#igsPeriode button");if(p){igsPeriode=p.dataset.v;renderIgSamen();return}
  const s=e.target.closest("#igsSorteer button");if(s){igsSorteer=s.dataset.v;renderIgSamen();return}
  if(e.target.closest("#igsMeer")){igsAlles=!igsAlles;renderIgSamen()}
});
