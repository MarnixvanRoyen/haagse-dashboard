// muziek.js — alles van de muziek: SoundCloud, DJ·World, YouTube, Spotify + tabbladen en knoppen

let LABEL={periods:[],tracks:[],generated:null,paidOut:0,outside:0,toBook:0};

const PARTNERS={SOUNDCLOUD:"SoundCloud",FACEBOOK:"Facebook & Instagram",YOUTUBE_ART_TRACK:"YouTube Music",APPLE:"Apple Music",AMAZON:"Amazon Music",PANDORA:"Pandora",NETEASE:"NetEase",SNAP:"Snapchat",TENCENT:"Tencent",KKBOX:"KKBOX",BOOMPLAY:"Boomplay",SAAVN:"JioSaavn",SPOTIFY:"Spotify",TIKTOK:"TikTok",DEEZER:"Deezer",TIDAL:"Tidal"};
const TYPES={SUB_STREAM:"Stream door betalende abonnee",AD_STREAM:"Gratis stream (met reclame)",UNKNOWN_STREAM:"Stream, soort onbekend",VIEW:"Videoweergave",CREATE:"Gebruikt in video (Reels e.d.)",SRAV_AD_ART_TRACK:"YouTube art track, gratis",SRAV_SUB_ART_TRACK:"YouTube art track, abonnee",AD_VIDEO_STREAM:"Video, gratis",SUB_VIDEO_STREAM:"Video, abonnee",SRAV_AD_SR:"YouTube geluidsopname, gratis"};

function normArtist(a){
  const first=String(a||"").split(",")[0].trim();
  const l=first.toLowerCase();
  if(l==="beuk")return "Beuk";
  if(l==="marreman"||l==="marreman rojas")return "Marreman Rojas";
  return first||"Onbekend";
}
function toRows(db){return db.map(r=>({m:String(r.reporting_period).slice(0,7),artist:normArtist(r.artist),track:r.track||"",partner:r.partner||"",type:r.type||"",country:r.country||"",units:+r.units||0,usd:+r.revenue_usd||0}))}
let SC=[];

const state={from:null,to:null,artist:"all",source:"all",basis:"net",rate:0.86,tab:"overzicht",sortKey:"total",sortDir:-1,search:""};
try{const s=JSON.parse(store.get("mi_state")||"{}");for(const k of ["artist","source","basis","rate","tab"]) if(s[k]!=null) state[k]=s[k];}catch(e){}
// telefoon (smal scherm): een paar tabbladen en alle details/uploads zitten alleen op de computer (class "pc" in stijl.css)
const isTel=()=>matchMedia("(max-width:700px)").matches;
const PC_TABS=["nummers","landen"];
function saveState(){store.set("mi_state",JSON.stringify({artist:state.artist,source:state.source,basis:state.basis,rate:state.rate,tab:state.tab}))}


/* ---------- months ---------- */
function allMonths(){
  const set=new Set(SC.map(r=>r.m));LABEL.periods.forEach(p=>set.add(p.m));
  const arr=[...set].sort();if(!arr.length)return[];
  const out=[];let [y,m]=arr[0].split("-").map(Number);const [ey,em]=arr[arr.length-1].split("-").map(Number);
  while(y<ey||(y===ey&&m<=em)){out.push(y+"-"+String(m).padStart(2,"0"));m++;if(m>12){m=1;y++}}
  return out;
}
let MONTH_LIST=allMonths();

/* ---------- filtered data ---------- */
function inRange(m){return m>=state.from&&m<=state.to}
function isFullRange(){return state.from===MONTH_LIST[0]&&state.to===MONTH_LIST[MONTH_LIST.length-1]}
function useSC(){return state.source!=="lb"}
function useLB(){return state.source!=="sc"&&state.artist==="all"}
function scRows(){if(!useSC())return[];return SC.filter(r=>inRange(r.m)&&(state.artist==="all"||r.artist===state.artist))}
function lbPeriods(){if(!useLB())return[];return LABEL.periods.filter(p=>inRange(p.m))}
function lbVal(o){return state.basis==="net"?o.net:o.gross}
function ex(v){return v*state.rate}

function compute(){
  const rows=scRows(), lps=lbPeriods();
  const scUSD=rows.reduce((a,r)=>a+r.usd,0);
  const scEUR=ex(scUSD);
  const lb=lps.reduce((a,p)=>a+lbVal(p),0);
  const lbGross=lps.reduce((a,p)=>a+p.gross,0), lbNet=lps.reduce((a,p)=>a+p.net,0);
  // months
  const months=MONTH_LIST.filter(inRange).map(m=>({m,sc:0,lb:0}));
  const mi=Object.fromEntries(months.map((o,i)=>[o.m,i]));
  rows.forEach(r=>{if(mi[r.m]!=null)months[mi[r.m]].sc+=ex(r.usd)});
  lps.forEach(p=>{if(mi[p.m]!=null)months[mi[p.m]].lb+=lbVal(p)});
  // tracks
  const tr=new Map();
  const key=(t,a)=>t.toLowerCase().trim();
  rows.forEach(r=>{const k=key(r.track);let o=tr.get(k);if(!o){o={track:r.track,artists:new Set(),sc:0,lb:0,units:0,subUnits:0,subUSD:0,usd:0};tr.set(k,o)}
    o.artists.add(r.artist);o.sc+=ex(r.usd);o.usd+=r.usd;o.units+=r.units;if(r.type==="SUB_STREAM"){o.subUnits+=r.units;o.subUSD+=r.usd}});
  const lbTracksOk=useLB()&&isFullRange();
  if(lbTracksOk)LABEL.tracks.forEach(t=>{const name=t.v?t.t+" ("+t.v+")":t.t;const k="lb:"+name.toLowerCase();
    const sk=key(t.t);let o=(!t.v&&tr.get(sk))||tr.get(k);if(!o){o={track:name,artists:new Set(),sc:0,lb:0,units:0,subUnits:0,subUSD:0,usd:0,lbOnly:true};tr.set(k,o)}
    if(t.a)o.artists.add(t.a);const v=lbVal(t);o.lb+=v;o.units+=t.sc||0;o.lbStreams=(o.lbStreams||0)+(t.sc||0);o.lbDl=(o.lbDl||0)+(t.dc||0);o.lbStreamVal=(o.lbStreamVal||0)+(t.gross>0?v*t.streams/t.gross:0)});
  const tracks=[...tr.values()].map(o=>({...o,artist:[...o.artists].join(", ")||"—",total:o.sc+o.lb}));
  // partners
  const pm=new Map();rows.forEach(r=>pm.set(r.partner,(pm.get(r.partner)||0)+ex(r.usd)));
  const partners=[...pm].map(([p,v])=>({name:pName(p),sc:v,lb:0,total:v}));
  if(useLB()&&lb>0)partners.push({name:"DJ·World (label)",sc:0,lb,total:lb});
  partners.sort((a,b)=>b.total-a.total);
  // types
  const tm=new Map();rows.forEach(r=>{let o=tm.get(r.type);if(!o){o={type:r.type,usd:0,units:0};tm.set(r.type,o)}o.usd+=r.usd;o.units+=r.units});
  const types=[...tm.values()].sort((a,b)=>b.usd-a.usd);
  // countries
  const cm=new Map();rows.forEach(r=>{let o=cm.get(r.country);if(!o){o={c:r.country,v:0,units:0};cm.set(r.country,o)}o.v+=ex(r.usd);o.units+=r.units});
  const countries=[...cm.values()].sort((a,b)=>b.v-a.v);
  return {rows,lps,scUSD,scEUR,lb,lbGross,lbNet,total:scEUR+lb,months,tracks,partners,types,countries,lbTracksOk,units:rows.reduce((a,r)=>a+r.units,0),
    lbStreams:useLB()?LABEL.tracks.reduce((a,t)=>a+(t.sc||0),0):0,lbDl:useLB()?LABEL.tracks.reduce((a,t)=>a+(t.dc||0),0):0};
}

/* ---------- render ---------- */
function bar(name,parts,max,val,title,rank){
  const w=v=>max>0?Math.max(v>0?0.6:0,v/max*100):0;
  const spans=parts.filter(p=>p.v>0).map(p=>`<span style="width:${w(p.v)}%;background:var(--${p.c})"></span>`).join("");
  return `<div class="bar" title="${esc(title||name)}"><span class="rank">${rank??""}</span><span class="name">${esc(name)}</span><span class="track">${spans}</span><span class="val">${val}</span></div>`;
}

function renderKPIs(d){
  const best=[...d.tracks].sort((a,b)=>b.total-a.total)[0];
  const bestM=[...d.months].sort((a,b)=>(b.sc+b.lb)-(a.sc+a.lb))[0];
  const scShare=d.total>0?d.scEUR/d.total:0;
  const parts=nf2.format(d.total);
  const vibe=d.total>=50?"Lekker bezig, jonguh.":d.total>=10?"Gaat de goeie kant op.":d.total>0?"Elke cent telt, toch?":"Niks te zien hier.";
  $("kpis").innerHTML=`
  <div>
    <p class="total-lbl">Alles bè mekaâh binnegehaald</p>
    <div class="total"><small>€</small>${parts}</div>
    <p class="total-sub"><b>${mLabel(state.from,1)} – ${mLabel(state.to,1)}</b> · ${vibe}</p>
    <div class="splitbar" role="img" aria-label="${pct(scShare)} SoundCloud, ${pct(1-scShare)} label"><span style="width:${scShare*100}%;background:var(--sc)"></span><span style="width:${(1-scShare)*100}%;background:var(--lb)"></span></div>
  </div>
  <div class="stats">
    <div class="stat"><span class="k"><i class="dot sc"></i>SoundCloud</span><span class="v">${eur(d.scEUR)}</span><span class="s">${usd(d.scUSD)} · ${nf0.format(d.units)} plays</span></div>
    <div class="stat"><span class="k"><i class="dot lb"></i>Label ${state.basis==="net"?"netto":"bruto"}</span><span class="v">${eur(d.lb)}</span><span class="s">${useLB()?`${nf0.format(d.lbStreams)} streams · ${nf0.format(d.lbDl)} downloads`:(state.source==="sc"?"uitgefilterd":"niet per artiest")}</span></div>
    <div class="stat"><span class="k">Beste nummâh</span><span class="v" title="${best?esc(best.track):""}">${best?esc(best.track):"—"}</span><span class="s">${best?eur(best.total)+" · "+pct(d.total?best.total/d.total:0)+" van alles":""}</span></div>
    <div class="stat"><span class="k">Beste maand</span><span class="v">${bestM?mLabel(bestM.m,1):"—"}</span><span class="s">${bestM?eur(bestM.sc+bestM.lb):""}</span></div>
  </div>`;
}

function renderChart(d){
  const W=Math.max(300,Math.round($("monthChart").clientWidth||1000)),H=W<600?230:300,ml=46,mr=8,mt=12,mb=30,iw=W-ml-mr,ih=H-mt-mb;
  const ms=d.months, n=ms.length||1;
  const max=niceMax(Math.max(0,...ms.map(o=>o.sc+o.lb)));
  const y=v=>mt+ih-v/max*ih, bw=iw/n, bar=Math.max(2,Math.min(44,bw*0.66));
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Inkomsten per maand">`;
  for(let i=0;i<=4;i++){const v=max*i/4,yy=y(v);s+=`<line class="${i?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${yy}" y2="${yy}"/><text x="${ml-8}" y="${yy+4}" text-anchor="end">€${v>=10?nf0.format(v):nf2.format(v).replace(",00","")}</text>`}
  const every=Math.ceil(n/(W<600?6:12));
  ms.forEach((o,i)=>{
    const x=ml+bw*i+(bw-bar)/2, tot=o.sc+o.lb;
    const hs=o.sc/max*ih, hl=o.lb/max*ih;
    const gap=(hs>0&&hl>0)?2:0;
    if(hs>0)s+=`<path fill="var(--sc)" d="${roundTop(x,y(o.sc),bar,hs,hl>0?0:Math.min(4,hs))}"/>`;
    if(hl>0)s+=`<path fill="var(--lb)" d="${roundTop(x,y(tot)-0,bar,Math.max(0.5,hl-gap),Math.min(4,hl))}"/>`;
    if((i%every===0&&n-1-i>=every/2)||i===n-1)s+=`<text x="${ml+bw*i+bw/2}" y="${H-10}" text-anchor="middle">${mLabel(o.m)}</text>`;
    s+=`<rect class="hit" data-i="${i}" x="${ml+bw*i}" y="${mt}" width="${bw}" height="${ih}"${staafGetal(ml+bw*i+bw/2,y(tot),eur(tot),mLabel(o.m,1))}/>`;
  });
  s+="</svg>";
  $("monthChart").innerHTML=s;
  $("chartSub").textContent=useLB()?"Label-bedragen staan in de maand van de afrekening":"SoundCloud-bedragen per luistermaand";
  $("monthChart").querySelectorAll(".hit").forEach(r=>{
    r.addEventListener("mousemove",e=>{const o=ms[+r.dataset.i];showTip(e,`<div class="t">${mLabel(o.m,1)}</div>
      <div class="r"><span><i class="dot sc"></i>SoundCloud</span><b class="num">${eur(o.sc,o.sc<0.01)}</b></div>
      <div class="r"><span><i class="dot lb"></i>Label</span><b class="num">${eur(o.lb,o.lb<0.01&&o.lb>0)}</b></div>
      <div class="r" style="border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><span>Totaal</span><b class="num">${eur(o.sc+o.lb)}</b></div>`)});
    r.addEventListener("mouseleave",hideTip);
  });
}

function renderOverview(d){
  const tt=[...d.tracks].sort((a,b)=>b.total-a.total).slice(0,8);const mx=tt[0]?tt[0].total:0;
  $("topTracks").innerHTML=tt.length?tt.map((t,i)=>bar(t.track,[{v:t.sc,c:"sc"},{v:t.lb,c:"lb"}],mx,eur(t.total),`${t.track} — ${t.artist}`,i+1)).join(""):'<p class="sub">Niks te zien in deze selectie.</p>';
  const pp=d.partners.slice(0,8);const pm=pp[0]?pp[0].total:0;
  $("topPartners").innerHTML=pp.length?pp.map((p,i)=>bar(p.name,[{v:p.sc,c:"sc"},{v:p.lb,c:"lb"}],pm,eur(p.total),null,i+1)).join(""):'<p class="sub">Niks te zien in deze selectie.</p>';
}

function renderTracks(d){
  const cols=[{k:"track",l:"Nummer"},{k:"artist",l:"Artiest"},{k:"src",l:"Bron",ns:1},{k:"sc",l:"SoundCloud",n:1},{k:"lb",l:"Label",n:1},{k:"total",l:"Totaal",n:1},{k:"units",l:"Streams",n:1},{k:"per1k",l:"€ / 1.000 streams",n:1},{k:"share",l:"Aandeel",ns:1}];
  let list=d.tracks.map(t=>({...t,per1k:t.units>=25?(t.sc+(t.lbStreamVal||0))/t.units*1000:null}));
  if(state.search)list=list.filter(t=>t.track.toLowerCase().includes(state.search.toLowerCase()));
  const k=state.sortKey,dir=state.sortDir;
  list.sort((a,b)=>{const va=a[k],vb=b[k];if(typeof va==="string")return va.localeCompare(vb,"nl")*dir;return((va??-1)-(vb??-1))*dir});
  const tot=d.total||1;
  const sums=list.reduce((a,t)=>({sc:a.sc+t.sc,lb:a.lb+t.lb,total:a.total+t.total,units:a.units+t.units}),{sc:0,lb:0,total:0,units:0});
  let h="<thead><tr>"+cols.map(c=>`<th class="${c.n?"n ":""}${c.ns?"":"sortable"}" ${c.ns?"":`data-k="${c.k}" tabindex="0"`} ${k===c.k?`aria-sort="${dir<0?"descending":"ascending"}"`:""}>${c.l}</th>`).join("")+"</tr></thead><tbody>";
  h+=list.map(t=>`<tr><td><b>${esc(t.track)}</b></td><td>${esc(t.artist)}</td>
    <td>${t.sc>0||t.units-(t.lbStreams||0)>0?'<span class="chip sc">SC</span> ':""}${t.lb>0?'<span class="chip lb">Label</span>':""}</td>
    <td class="n">${t.sc?eur(t.sc):"—"}</td><td class="n">${t.lb?eur(t.lb):"—"}</td><td class="n"><b>${eur(t.total)}</b></td>
    <td class="n">${t.units?nf0.format(t.units):"—"}</td><td class="n">${t.per1k!=null?eur(t.per1k):"—"}</td>
    <td><div class="mini" title="${pct(t.total/tot)}"><span style="width:${Math.max(2,t.total/tot*100)}%;background:var(--${t.lb>t.sc?"lb":"sc"})"></span></div></td></tr>`).join("");
  h+=`</tbody><tfoot><tr><td>Totaal (${list.length})</td><td></td><td></td><td class="n">${eur(sums.sc)}</td><td class="n">${eur(sums.lb)}</td><td class="n">${eur(sums.total)}</td><td class="n">${nf0.format(sums.units)}</td><td></td><td></td></tr></tfoot>`;
  $("trackTable").innerHTML=h;
  $("trackTable").querySelectorAll("th.sortable").forEach(th=>{const go=()=>{const nk=th.dataset.k;if(state.sortKey===nk)state.sortDir*=-1;else{state.sortKey=nk;state.sortDir=(nk==="track"||nk==="artist")?1:-1}renderTracks(compute())};
    th.addEventListener("click",go);th.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}})});
}

function renderSources(d){
  const mx=d.partners[0]?d.partners[0].total:0;
  $("partnerBars").innerHTML=d.partners.length?d.partners.map((p,i)=>bar(p.name,[{v:p.sc,c:"sc"},{v:p.lb,c:"lb"}],mx,eur(p.total),null,i+1)).join(""):'<p class="sub">Geen data.</p>';
  $("typeTable").innerHTML=`<thead><tr><th>Soort</th><th class="n">Aantal</th><th class="n">Ontvangen</th><th class="n">Per 1.000</th></tr></thead><tbody>`+
    d.types.map(t=>`<tr><td>${esc(TYPES[t.type]||t.type)}</td><td class="n">${nf0.format(t.units)}</td><td class="n">${eur(ex(t.usd))}</td><td class="n">${t.units?eur(ex(t.usd)/t.units*1000):"—"}</td></tr>`).join("")+"</tbody>";
  const ps=LABEL.periods.filter(p=>inRange(p.m));
  const sum=k=>ps.reduce((a,p)=>a+p[k],0);
  $("labelTable").innerHTML=`<thead><tr><th>Periode</th><th class="n">Bruto</th><th class="n">Aggregator</th><th class="n">DJ·World</th><th class="n">Jouw netto</th><th>Status</th></tr></thead><tbody>`+
    ps.map(p=>`<tr><td>${esc(p.name)}</td><td class="n">${eur(p.gross,1)}</td><td class="n">${eur(p.agg,1)}</td><td class="n">${eur(p.djw,1)}</td><td class="n"><b>${eur(p.net,1)}</b></td>
      <td><span class="chip ${p.status==="nog te boeken"?"warn":"mute"}">${esc(p.status)}</span></td></tr>`).join("")+
    `</tbody><tfoot><tr><td>Totaal</td><td class="n">${eur(sum("gross"),1)}</td><td class="n">${eur(sum("agg"),1)}</td><td class="n">${eur(sum("djw"),1)}</td><td class="n">${eur(sum("net"),1)}</td><td>${sum("gross")?pct(sum("net")/sum("gross"))+" komt bij jou":""}</td></tr></tfoot>`;
}

function renderCountries(d){
  const cc=d.countries.slice(0,20);const mx=cc[0]?cc[0].v:0;
  $("countryBars").innerHTML=cc.length?cc.map((c,i)=>bar(cName(c.c),[{v:c.v,c:"sc"}],mx,eur(c.v),`${cName(c.c)}: ${nf0.format(c.units)} streams`,i+1)).join("")+(d.countries.length>20?`<p class="sub" style="margin:6px 0 0">+ ${d.countries.length-20} andere landen samen ${eur(d.countries.slice(20).reduce((a,c)=>a+c.v,0))}</p>`:""):'<p class="sub">Geen SoundCloud-data in deze selectie.</p>';
}

function renderInsights(d){
  const out=[];
  const T=Object.fromEntries(d.types.map(t=>[t.type,t]));
  const sub=T.SUB_STREAM, ad=T.AD_STREAM;
  if(sub&&d.scUSD>0){
    const share=sub.usd/d.scUSD, subPer=ex(sub.usd)/sub.units*1000, adPer=ad&&ad.units?ex(ad.usd)/ad.units*1000:0;
    out.push({big:pct(share),h:"van je SoundCloud-geld komt van betalende abonnees",
      p:`${nf0.format(sub.units)} abonnee-streams leverden ${eur(ex(sub.usd))} op. Dat is ${eur(subPer)} per 1.000 streams${adPer?`, tegen ${eur(adPer)} bij gratis luisteraars (${nf0.format(subPer/adPer)}× zo veel)`:""}.`,
      a:"<b>Kans:</b> SoundCloud betaalt per fan, niet per stream. Trouwe luisteraars met een Go+ of Artist-account zijn veel meer waard dan losse plays. Focus op een vaste luisterkring (reposts, volgers, DJ-sets met je eigen tracks)."});
  }
  const tt=[...d.tracks].sort((a,b)=>b.total-a.total);
  if(tt.length>=3&&d.total>0){const top3=tt.slice(0,3).reduce((a,t)=>a+t.total,0);
    out.push({big:pct(top3/d.total),h:"van alle inkomsten komt uit je top 3 nummers",
      p:`${tt.slice(0,3).map(t=>esc(t.track)).join(", ")}. De andere ${tt.length-3} nummers delen de rest.`,
      a:"<b>Kans:</b> kijk wat deze nummers gemeen hebben (stijl, tempo, promotie, releasemoment) en gebruik dat bij je volgende release."});}
  const lbAll=LABEL.periods.reduce((a,p)=>a+p.gross,0), lbNetAll=LABEL.periods.reduce((a,p)=>a+p.net,0);
  const lbGrossT=LABEL.tracks.reduce((a,x)=>a+x.gross,0), lbNetT=LABEL.tracks.reduce((a,x)=>a+x.net,0);
  const lbSc=LABEL.tracks.reduce((a,x)=>a+(x.sc||0),0), lbDc=LABEL.tracks.reduce((a,x)=>a+(x.dc||0),0);
  const lbStrNet=LABEL.tracks.reduce((a,x)=>a+(x.gross>0?x.net*x.streams/x.gross:0),0), lbDlGross=LABEL.tracks.reduce((a,x)=>a+x.downloads,0);
  const scAll=SC.reduce((a,r)=>a+r.usd,0)*state.rate, scUnitsAll=SC.reduce((a,r)=>a+r.units,0);
  if(lbSc>0&&scUnitsAll>0){const lbPer=lbStrNet/lbSc*1000, scPer=scAll/scUnitsAll*1000;
    out.push({big:eur(lbPer),h:"netto per 1.000 streams via het label",
      p:`${nf0.format(lbSc)} label-streams leverden jou ${eur(lbStrNet)} op. Via SoundCloud-distributie krijg je ${eur(scPer)} per 1.000 plays, dat is ${nf0.format(scPer/lbPer)}× zo veel.`,
      a:"<b>Kans:</b> streams via het label brengen per stuk weinig op. Het label loont vooral als het veel extra luisteraars oplevert. Laat nieuwe tracks die jij zelf kunt pushen via SoundCloud lopen."});}
  if(lbDc>0)out.push({big:nf0.format(lbDc)+" downloads",h:`brachten ${eur(lbDlGross)} bruto op${lbDlGross>LABEL.tracks.reduce((a,x)=>a+x.streams,0)?`, meer dan alle ${nf0.format(lbSc)} label-streams samen`:""}`,
      p:`Dat is ${eur(lbDlGross/lbDc)} bruto per download, tegen ${eur(LABEL.tracks.reduce((a,x)=>a+x.streams,0))} bruto voor alle streams. Van het bruto label-bedrag houd je ${lbAll>0?pct(lbNetAll/lbAll):"—"} over; de rest gaat naar de aggregator en DJ·World.`,
      a:"<b>Kans:</b> DJ's kopen tracks (Beatport, Traxsource). Clubtracks die DJ's draaien kunnen via downloads meer opleveren dan via streams. Denk aan een DJ-vriendelijke versie (extended mix)."});
  const partnersNoSC=d.partners.filter(p=>p.name!=="SoundCloud"&&p.name!=="DJ·World (label)");
  const other=partnersNoSC.reduce((a,p)=>a+p.total,0);
  const hasSpotify=SC.some(r=>r.partner==="SPOTIFY");
  if(d.scEUR>0)out.push({big:pct(other/d.scEUR),h:"van je distributie-geld komt van buiten SoundCloud",
    p:`${partnersNoSC.slice(0,3).map(p=>esc(p.name)+" "+eur(p.total)).join(", ")}.${hasSpotify?"":" Spotify komt niet voor in dit rapport."}`,
    a:`<b>Kans:</b> ${hasSpotify?"kijk welke dienst per stream het meest oplevert.":"controleer in SoundCloud for Artists of je releases ook naar Spotify gaan. Het ontbreken ervan kan een bewuste keuze of een instelling zijn."}`});
  if(d.countries.length){const c0=d.countries[0],sum=d.countries.reduce((a,c)=>a+c.v,0);
    out.push({big:pct(c0.v/sum),h:`van je SoundCloud-geld komt uit ${cName(c0.c)}`,
      p:`Daarna volgen ${d.countries.slice(1,4).map(c=>cName(c.c)).join(", ")}. Je luisteraars zitten verspreid over ${d.countries.length} landen.`,
      a:"<b>Kans:</b> je thuismarkt is sterk. Landen als Duitsland en de VS betalen per abonnee-stream vaak goed; gerichte promotie daar kan relatief veel opleveren."});}
  if(LABEL.generated)out.push({big:eur(LABEL.toBook),h:"staat bij DJ·World nog te boeken",
    p:`Al uitbetaald: ${eur(LABEL.paidOut)}. Daarnaast is ${eur(LABEL.outside)} buiten de tool om afgerekend (overzicht van ${LABEL.generated}).`,
    a:"<b>Actie:</b> houd bij wanneer dit saldo wordt uitbetaald; bij volgende overzichten zie je hier of het is verwerkt."});
  if(!out.length){$("insights").innerHTML='<p class="sub">Nog niks te zien. Laad eerst je SoundCloud-CSV in.</p>';return}
  $("insights").innerHTML=out.map(o=>`<article class="ins"><span class="big">${o.big}</span><h3>${o.h}</h3><p>${o.p}</p><div class="act">${o.a}</div></article>`).join("");
}

function renderNotes(){
  const n=[];
  if(state.artist!=="all"&&state.source!=="sc")n.push("<b>Label-data is niet per artiest uitgesplitst</b>, dus bij een gekozen artiest zie je alleen SoundCloud.");
  if(useLB()&&!isFullRange())n.push("<b>Label-bedragen per nummer</b> zijn alleen als totaal beschikbaar; ze verschijnen in de nummerlijst bij de volledige periode.");
  $("notes").innerHTML=n.join("<br>");$("notes").hidden=!n.length;
}

function render(){
  const d=compute();
  renderNotes();renderKPIs(d);
  if(state.tab==="overzicht"){renderChart(d);renderOverview(d)}
  if(state.tab==="nummers")renderTracks(d);
  if(state.tab==="bronnen")renderSources(d);
  if(state.tab==="landen")renderCountries(d);
  if(state.tab==="kansen")renderInsights(d);
  if(state.tab==="youtube")renderYouTube();
  if(state.tab==="sclive")renderSCLive();
  if(state.tab==="spotify")renderSpotify();
  if(state.tab==="nieuw")renderVerschil();
  $("srcInfo").textContent=`Uit Supabase: ${nf0.format(SC.length)} SoundCloud-regels${LAST_IMPORT?" (laatste import: "+LAST_IMPORT+")":""} · DJ·World-overzicht ${LABEL.generated?LABEL.generated:"nog niet ingeladen"}.`;
}

/* ---------- controls ---------- */
function fillSelects(){
  MONTH_LIST=allMonths();
  const opts=MONTH_LIST.map(m=>`<option value="${m}">${mLabel(m,1)}</option>`).join("");
  $("fFrom").innerHTML=opts;$("fTo").innerHTML=opts;
  if(!MONTH_LIST.length){const n=new Date();MONTH_LIST=[n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0")];$("fFrom").innerHTML=$("fTo").innerHTML=`<option value="${MONTH_LIST[0]}">${mLabel(MONTH_LIST[0],1)}</option>`}
  state.from=MONTH_LIST[0];state.to=MONTH_LIST[MONTH_LIST.length-1];
  $("fFrom").value=state.from;$("fTo").value=state.to;
  const artists=[...new Set(SC.map(r=>r.artist))].sort();
  if(state.artist!=="all"&&!artists.includes(state.artist))state.artist="all";
  if(isTel()){state.artist="all";state.basis="net";syncSeg("fBasis","net")}   // die keuzes staan op de telefoon nie in beeld, dus altijd alles/netto
  $("fArtist").innerHTML=`<option value="all">Alle artiesten</option>`+artists.map(a=>`<option>${esc(a)}</option>`).join("");
  $("fArtist").value=state.artist;
}
function syncSeg(id,val){$(id).querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===val))}
function setTab(t){if(isTel()&&PC_TABS.includes(t))t="overzicht";state.tab=t;document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  ["overzicht","nieuw","nummers","bronnen","landen","youtube","sclive","spotify","kansen"].forEach(x=>{if($("p-"+x))$("p-"+x).hidden=x!==t});saveState();render()}

$("fFrom").addEventListener("change",e=>{state.from=e.target.value;if(state.to<state.from){state.to=state.from;$("fTo").value=state.to}render()});
$("fTo").addEventListener("change",e=>{state.to=e.target.value;if(state.from>state.to){state.from=state.to;$("fFrom").value=state.from}render()});
$("fArtist").addEventListener("change",e=>{state.artist=e.target.value;saveState();render()});
$("fSource").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;state.source=b.dataset.v;syncSeg("fSource",state.source);saveState();render()});
$("fBasis").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;state.basis=b.dataset.v;syncSeg("fBasis",state.basis);saveState();render()});
$("fRate").addEventListener("input",e=>{const v=parseFloat(String(e.target.value).replace(",","."));if(v>0.3&&v<2){state.rate=v;saveState();render()}});
document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
$("trackSearch").addEventListener("input",e=>{state.search=e.target.value;renderTracks(compute())});

/* CSV import */
function parseCSV(text){
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;else if(c===","){row.push(f);f=""}else if(c==="\n"){row.push(f);rows.push(row);row=[];f=""}else if(c!=="\r")f+=c}
  if(f||row.length){row.push(f);rows.push(row)}
  return rows;
}
$("fFile").addEventListener("change",async e=>{
  const file=e.target.files[0];e.target.value="";if(!file)return;
  const rows=parseCSV(await file.text());const hd=(rows[0]||[]).map(h=>h.trim());
  const ix=n=>hd.indexOf(n);
  const need=["Reporting Period","Accounting Period","Artist(s)","Track","Partner","Type","Country","Units","Revenue (USD)"];
  const miss=need.filter(n=>ix(n)<0);
  if(miss.length){showMsg(`Dit bestand mist de kolommen: ${miss.join(", ")}. Kies het earnings report uit SoundCloud for Artists.`);return}
  const g=(r,n)=>ix(n)<0?"":(r[ix(n)]||"").trim();
  const num=v=>{const x=Number(v);return isFinite(x)?x:0};
  const payload=rows.slice(1).filter(r=>r.length>=hd.length-1&&g(r,"Reporting Period")).map(r=>({
    reporting_period:g(r,"Reporting Period").slice(0,10),accounting_period:g(r,"Accounting Period").slice(0,10),
    artist:g(r,"Artist(s)"),release:g(r,"Release"),track:g(r,"Track"),upc:g(r,"UPC"),isrc:g(r,"ISRC"),
    partner:g(r,"Partner"),country:g(r,"Country"),type:g(r,"Type"),
    units:num(g(r,"Units")),revenue_usd:num(g(r,"Revenue (USD)")),
    revenue_share:num(g(r,"Revenue Share (%)")),split_share:num(g(r,"Split Pay Share (%)"))}));
  if(!payload.length){showMsg("Geen regels gevonden in dit bestand.");return}
  const laatsteAfr=payload.reduce((a,r)=>r.accounting_period>a?r.accounting_period:a,"").slice(0,7);
  // check vooraf: is dit bestand ouder dan wat er al staat? Dan zou het latere correcties terugdraaien.
  const scVorige=(IMP.lijst||[]).filter(i=>i.bron==="sc").slice(-1)[0],vAfr=scVorige&&scVorige.samenvatting&&scVorige.samenvatting.laatste_afrekening;
  if(vAfr&&laatsteAfr&&laatsteAfr<vAfr&&!confirm(`Dit bestand gaat t/m afrekening ${mLabel(laatsteAfr,1)}, je vorige upload t/m ${mLabel(vAfr,1)}. Het is dus óuder. Inladen kan latere correcties van SoundCloud terugdraaien. Toch inladen?`)){
    showMsg("Niks ingeladen: het bestand was ouder dan je vorige upload.",true);return}
  showMsg(`Bezig met opslaan van ${nf0.format(payload.length)} regels in Supabase…`,true,true);
  const scVoor=IMP.lijst.filter(i=>i.bron==="sc").length;
  const {data,error}=await sb.rpc("import_soundcloud",{rows:payload,file_name:file.name});
  if(error){showMsg("Opslaan lukte niet: "+error.message);return}
  await loadData();
  const scNa=IMP.lijst.filter(i=>i.bron==="sc").length;
  if(!IMP.err&&scNa===scVoor&&scVoor>0){      // momentopname niet bewaard = zelfde inhoud als de vorige upload
    VS.gelijk.sc={bestand:file.name,tekst:`is precies hetzelfde als je vorige upload (laatste afrekening ${laatsteAfr?mLabel(laatsteAfr,1):"onbekend"}). SoundCloud zet meestal één keer per maand een nieuwe maand in het rapport.`};setTab("nieuw");
    showMsg(`${file.name} is precies hetzelfde als je vorige upload: niks nieuws. De laatste afrekening erin is ${laatsteAfr?mLabel(laatsteAfr,1):"onbekend"}. SoundCloud zet meestal één keer per maand een nieuwe maand in het rapport.`,false,true);return}
  VS.gelijk.sc=null;
  if(!IMP.err&&scNa>1)setTab("nieuw");   // meteen laten zien wat er veranderd is
  showMsg(`${file.name} opgeslagen: ${nf0.format(data.inserted)} regels erin, ${nf0.format(data.deleted)} oude regels van dezelfde afrekenperiodes vervangen.${!IMP.err&&scNa>1?" Kèk bij 'Wat is d'r nieuw?' wat er veranderd is.":""}`,true);
});

/* init */
let rsz;addEventListener("resize",()=>{clearTimeout(rsz);rsz=setTimeout(()=>{if(isTel()&&PC_TABS.includes(state.tab)){setTab("overzicht");return}if(state.tab==="overzicht")renderChart(compute());if(state.tab==="youtube")renderYouTube();if(state.tab==="sclive")renderSCLive()},150)});

/* ---------- DJ·World totaaloverzicht (PDF) uitlezen ---------- */
async function pdfLines(pdfjs,data){
  const doc=await pdfjs.getDocument({data}).promise;const lines=[];
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p);const tc=await page.getTextContent();
    const rows=[];
    for(const it of tc.items){if(!it.str||!it.str.trim())continue;const x=it.transform[4],y=it.transform[5];
      let r=rows.find(r=>Math.abs(r.y-y)<3);if(!r){r={y,items:[]};rows.push(r)}r.items.push({x,s:it.str,w:it.width||0})}
    rows.sort((a,b)=>b.y-a.y);
    for(const r of rows){r.items.sort((a,b)=>a.x-b.x);let s="",end=null;
      for(const it of r.items){if(end!==null)s+=(it.x-end>1.5?" ":"");s+=it.s;end=it.x+it.w}
      lines.push(s.replace(/\s+/g," ").trim())}
  }
  return lines;
}
const DJ_MONTHS={jan:1,januari:1,january:1,feb:2,februari:2,february:2,mrt:3,maart:3,mar:3,march:3,apr:4,april:4,mei:5,may:5,jun:6,juni:6,june:6,jul:7,juli:7,july:7,aug:8,augustus:8,august:8,sep:9,sept:9,september:9,okt:10,oktober:10,oct:10,october:10,nov:11,november:11,dec:12,december:12};
function djPeriodMonth(name){
  let m=name.match(/\b(\d{1,2})[-\/](20\d{2})\b/);if(m)return m[2]+"-"+String(+m[1]).padStart(2,"0")+"-01";
  m=name.match(/(20\d{2})[-\/](\d{1,2})\b/);if(m)return m[1]+"-"+String(+m[2]).padStart(2,"0")+"-01";
  const y=(name.match(/20\d{2}/)||[])[0];const w=name.toLowerCase().match(/[a-z]+/g)||[];
  for(const x of w)if(DJ_MONTHS[x]&&y)return y+"-"+String(DJ_MONTHS[x]).padStart(2,"0")+"-01";
  return null;
}
function djNum(s){if(s==null)return 0;const neg=/-/.test(s);const v=parseFloat(String(s).replace(/[^\d,]/g,"").replace(",","."));return (neg?-1:1)*(isFinite(v)?v:0)}
function djInt(s){return parseInt(String(s).replace(/\./g,""),10)||0}
function parseDJWorld(lines){
  const EUR="-?€ ?-?[\\d.]+,\\d+";
  const res={statement_date:null,summary:{},periods:[],tracks:[],warnings:[]};
  const all=lines.join("\n");
  const d=all.match(/Opgemaakt op (\d{2})-(\d{2})-(\d{4})/);if(d)res.statement_date=`${d[3]}-${d[2]}-${d[1]}`;
  const eurs=s=>(s.match(new RegExp(EUR,"g"))||[]).map(djNum);
  for(let i=0;i<lines.length;i++){
    const L=lines[i].toUpperCase();
    if(L.includes("BRUTO INKOMSTEN")&&L.includes("JOUW NETTO")){const v=eurs(lines[i+1]||"");[res.summary.gross,res.summary.net,res.summary.paid_out]=v}
    if(L.includes("OPENSTAAND SALDO")&&L.includes("NOG TE BOEKEN")){const v=eurs(lines[i+1]||"");[res.summary.open_balance,res.summary.to_book,res.summary.in_process]=v}
  }
  const out=all.match(new RegExp("("+EUR+") hiervan is buiten de tool"));res.summary.outside_tool=out?djNum(out[1]):0;
  let sec=null;
  const perRe=new RegExp(`^(.+?) (${EUR}) (${EUR}) (${EUR}) (${EUR}) ?(.*)$`);
  const trRe=new RegExp(`^(.+?) (\\d+)% ([\\d.]+) ([\\d.]+) (${EUR}) (${EUR})$`);
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(/^Inkomsten per periode/i.test(l)){sec="p";continue}
    if(/^Inkomsten per nummer/i.test(l)){sec="t";continue}
    if(/^Opbouw van het saldo/i.test(l)){sec=null;continue}
    if(!sec||/^(Periode|Nummer) /.test(l)||/^Totaal\b/.test(l))continue;
    if(sec==="p"){const m=l.match(perRe);if(!m)continue;
      const month=djPeriodMonth(m[1]);if(!month)res.warnings.push("Periode niet herkend: "+m[1]);
      res.periods.push({name:m[1].trim(),period_month:month,gross:djNum(m[2]),aggregator:djNum(m[3]),djworld:djNum(m[4]),net:djNum(m[5]),status:(m[6]||"").trim()})}
    if(sec==="t"){const m=l.match(trRe);if(!m)continue;
      const next=eurs(lines[i+1]||"");
      res.tracks.push({track:m[1].trim(),share:+m[2],stream_count:djInt(m[3]),download_count:djInt(m[4]),gross:djNum(m[5]),net:djNum(m[6]),streams:next[0]||0,downloads:next[1]||0})}
  }
  // zelfde titel meerdere keren -> versies nummeren
  const cnt={};res.tracks.forEach(t=>cnt[t.track]=(cnt[t.track]||0)+1);
  const seen={};res.tracks.forEach(t=>{t.version=cnt[t.track]>1?"versie "+(seen[t.track]=(seen[t.track]||0)+1):""});
  const g=res.tracks.reduce((a,t)=>a+t.gross,0);
  if(!res.periods.length||!res.tracks.length)res.warnings.push("Geen periodes of nummers gevonden. Is dit een DJ·World totaaloverzicht?");
  if(res.summary.gross!=null&&Math.abs(g-res.summary.gross)>0.02)res.warnings.push("Som per nummer wijkt af van het totaal.");
  return res;
}

let pdfjsReady=null;
function loadPdfJs(){
  if(pdfjsReady)return pdfjsReady;
  pdfjsReady=new Promise((res,rej)=>{const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";res(window.pdfjsLib)};
    s.onerror=()=>{pdfjsReady=null;rej(new Error("PDF-lezer kon niet laden. Check je internet."))};document.head.appendChild(s)});
  return pdfjsReady;
}
$("fPdf").addEventListener("change",async e=>{
  const file=e.target.files[0];e.target.value="";if(!file)return;
  try{
    showMsg("PDF lezen…",true,true);
    const pdfjs=await loadPdfJs();
    const r=parseDJWorld(await pdfLines(pdfjs,new Uint8Array(await file.arrayBuffer())));
    if(!r.periods.length||!r.tracks.length){showMsg("Dit lijkt geen DJ·World totaaloverzicht in het nieuwe format (met streams per nummer). "+r.warnings.join(" "));return}
    if(!r.statement_date){showMsg("De datum 'Opgemaakt op' niet gevonden in de PDF.");return}
    // check vooraf: een óuder overzicht vervangt je periodes en nummers door die oude stand
    const dNL=d=>String(d).slice(0,10).split("-").reverse().join("-");
    const lbVorige=(IMP.lijst||[]).filter(i=>i.bron==="label").slice(-1)[0],vDat=lbVorige&&lbVorige.samenvatting&&lbVorige.samenvatting.overzicht_van;
    if(vDat&&r.statement_date<String(vDat).slice(0,10)&&!confirm(`Deze PDF is opgemaakt op ${dNL(r.statement_date)}, je vorige overzicht op ${dNL(vDat)}. Dit is dus een óuder overzicht: inladen zet je label-cijfers terug naar die oude stand. Toch inladen?`)){
      showMsg("Niks ingeladen: de PDF was ouder dan je vorige overzicht.",true);return}
    const lbVoor=(IMP.lijst||[]).filter(i=>i.bron==="label").length;
    showMsg(`Opslaan: ${r.periods.length} periodes en ${r.tracks.length} nummers…`,true,true);
    r.bestand=file.name;                              // voor de momentopname (Wat is d'r nieuw?)
    const {data,error}=await sb.rpc("import_djworld",{doc:r});
    if(error){showMsg("Opslaan lukte niet: "+error.message);return}
    await loadData();
    const lbNa=IMP.lijst.filter(i=>i.bron==="label").length;
    if(!IMP.err&&lbNa===lbVoor&&lbVoor>0){   // momentopname niet bewaard = zelfde inhoud als het vorige overzicht
      VS.gelijk.label={bestand:file.name,tekst:`is precies hetzelfde als je vorige overzicht (opgemaakt op ${dNL(r.statement_date)}).`};setTab("nieuw");
      showMsg(`${file.name} is precies hetzelfde als je vorige DJ·World-overzicht: niks nieuws.`,false,true);return}
    VS.gelijk.label=null;
    if(!IMP.err&&lbNa>1)setTab("nieuw");   // meteen laten zien wat er veranderd is
    showMsg(`Label-overzicht van ${r.statement_date.split("-").reverse().join("-")} opgeslagen: ${data.periods} periodes, ${data.tracks} nummers.${!IMP.err&&lbNa>1?" Kèk bij 'Wat is d'r nieuw?' wat er veranderd is.":""}${r.warnings.length?" Let op: "+r.warnings.join(" "):""}`,!r.warnings.length);
  }catch(err){showMsg("PDF inladen lukte niet: "+err.message)}
});

/* ---------- YouTube ---------- */
let YT={videos:[],snaps:[],own:[],err:null};
async function loadYT(){
  try{
    const since=new Date(Date.now()-400*864e5).toISOString().slice(0,10);
    const [cfg,vids]=await Promise.all([
      sb.from("yt_config").select("channel_ids"),
      sb.from("yt_videos").select("video_id,title,channel_id,published_at")]);
    if(cfg.error)throw cfg.error;if(vids.error)throw vids.error;
    let snaps=[],from=0;const size=1000;
    for(;;){const {data,error}=await sb.from("yt_snapshots").select("video_id,snap_date,views,likes,comments")
      .gte("snap_date",since).order("snap_date").order("video_id").range(from,from+size-1);
      if(error)throw error;snaps=snaps.concat(data);if(data.length<size)break;from+=size}
    YT={videos:vids.data,snaps,own:(cfg.data[0]||{}).channel_ids||[],err:null};
  }catch(e){YT={videos:[],snaps:[],own:[],err:e.message}}
}
const MUZIEK_DAGEN=31;   // "erbè", groeiâhs en best bekeken/beluisterd: laatste 31 dagen
function ytCompute(venster=7){
  const dates=[...new Set(YT.snaps.map(s=>s.snap_date))].sort();
  const last=dates[dates.length-1];
  const cut=last?new Date(new Date(last).getTime()-venster*864e5).toISOString().slice(0,10):null;
  const baseCands=dates.filter(d=>d<=cut);
  const base=baseCands.length?baseCands[baseCands.length-1]:dates[0];
  const by=new Map();YT.snaps.forEach(s=>{let m=by.get(s.video_id);if(!m){m={};by.set(s.video_id,m)}m[s.snap_date]=s});
  const vids=YT.videos.map(v=>{const m=by.get(v.video_id)||{};const cur=m[last];
    const ds=Object.keys(m).sort();const b=m[base]||m[ds.find(d=>d>=base)]||cur;
    return {id:v.video_id,title:v.title,own:YT.own.includes(v.channel_id),pub:v.published_at?String(v.published_at).slice(0,10):"",
      views:cur?+cur.views:0,likes:cur?+cur.likes:0,comments:cur?+cur.comments:0,grow:cur&&b?(+cur.views)-(+b.views):0}}).filter(v=>v.views||v.pub);
  const daily=dates.map((d,i)=>{const tot=YT.snaps.filter(s=>s.snap_date===d).reduce((a,s)=>a+(+s.views),0);return {d,tot}});
  daily.forEach((o,i)=>o.add=i?Math.max(0,o.tot-daily[i-1].tot):null);
  const groups=new Map();vids.forEach(v=>{const k=v.title.toLowerCase().trim();let g=groups.get(k);if(!g){g={title:v.title,views:0,grow:0,n:0};groups.set(k,g)}g.views+=v.views;g.grow+=v.grow;g.n++});
  return {dates,last,base,vids,daily,groups:[...groups.values()],multiDay:dates.length>1,venster};
}
// zijn er nog geen 31 dagen metingen? dan kort erbij zetten vanaf wanneer er gemeten wordt
function muziekKort(y,days){return y.multiDay&&days<y.venster-1?` · metingen pas vanaf ${dLabel(y.base)}`:""}
function renderYouTube(){
  if(YT.err){$("ytStats").innerHTML=`<p class="sub">YouTube-cijfers ophalen lukte niet: ${esc(YT.err)}</p>`;return}
  const y=ytCompute(MUZIEK_DAGEN);
  if(!y.last){$("ytStats").innerHTML='<p class="sub">Nog geen metingen. Tik bovenaan op Ververse.</p>';$("ytChart").innerHTML="";$("ytTop").innerHTML="";$("ytGrow").innerHTML="";$("ytTable").innerHTML="";$("cmpStats").innerHTML="";$("cmpTable").innerHTML="";return}
  const views=y.vids.reduce((a,v)=>a+v.views,0),likes=y.vids.reduce((a,v)=>a+v.likes,0),grow=y.vids.reduce((a,v)=>a+v.grow,0);
  const days=Math.round((new Date(y.last)-new Date(y.base))/864e5);
  const tracks=y.vids.filter(v=>!v.own).length, own=y.vids.length-tracks;
  const best=[...y.groups].filter(g=>g.grow>0).sort((a,b)=>b.grow-a.grow)[0];   // meeste weergaven erbè in de laatste 31 dagen
  const kort=muziekKort(y,days);
  const g=dagGroei(YT.snaps,"video_id","views"),li=liveInfo("yt",g),vd=g&&g.vandaag;
  $("ytSub").textContent=`Openbare cijfers, ververst zodra je het dashboard opent (hooguit 1x per 10 min) · laatste meting ${laatsteMeting("yt",g)}. De filters hierboven gelden hier niet.`;
  $("ytStats").innerHTML=`
    <div class="ytstat"><span class="k">Vandaag erbè</span><span class="v">${li.v}</span><span class="s">${li.s.replace(/^vandaag erbè \((.*?)\)/,"$1")}</span></div>
    <div class="ytstat"><span class="k">Weergaven totaal</span><span class="v">${nf0.format(views)}</span><span class="s">${y.vids.length} tracks en video's</span></div>
    <div class="ytstat"><span class="k">Erbè laatste 31 dagen</span><span class="v">${y.multiDay?"+"+nf0.format(grow):"—"}</span><span class="s">${y.multiDay?(days?nf0.format(grow/days)+" per dag gemiddeld"+kort:""):"vanaf morgen te zien"}</span></div>
    <div class="ytstat"><span class="k">Best bekeken · 31 dagen</span><span class="v" style="font-size:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${best?esc(best.title):""}">${best?esc(best.title):"—"}</span><span class="s">${best?"+"+nf0.format(best.grow)+" weergaven"+(grow?" · "+pct(best.grow/grow)+" van wat erbè kwam":""):y.multiDay?"geen nieuwe weergaven":"vanaf morgen te zien"}</span></div>
    <div class="ytstat"><span class="k">Likes</span><span class="v">${nf0.format(likes)}</span><span class="s">${tracks} tracks · ${own} eigen video${own===1?"":"'s"}</span></div>`;
  // grafiek: erbij per dag
  const pts=y.daily.filter(o=>o.add!=null);
  if(pts.length<1){$("ytChart").innerHTML='<p class="sub" style="margin:0">Na de tweede meting (vannacht) zie je hier per dag hoeveel weergaven erbij kwamen.</p>'}
  else{
    const W=Math.max(300,Math.round($("ytChart").clientWidth||1000)),H=W<600?200:240,ml=46,mr=8,mt=12,mb=30,iw=W-ml-mr,ih=H-mt-mb;
    const n=pts.length,sch=schaal(Math.max(...pts.map(o=>o.add)),4),max=sch.top,yy=v=>mt+ih-v/max*ih,bw=iw/n,bar=Math.max(2,Math.min(36,bw*0.66));
    let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nieuwe YouTube-weergaven per dag">`;
    sch.lijnen.forEach((v,i)=>{const t=yy(v);s+=`<line class="${i?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${t}" y2="${t}"/><text x="${ml-8}" y="${t+4}" text-anchor="end">${nf0.format(v)}</text>`})
    const every=Math.ceil(n/(W<600?6:12));
    pts.forEach((o,i)=>{const x=ml+bw*i+(bw-bar)/2,h=o.add/max*ih;
      if(h>0)s+=`<path fill="var(--yt)" d="${roundTop(x,yy(o.add),bar,h,Math.min(4,h))}"/>`;
      if((i%every===0&&n-1-i>=every/2)||i===n-1)s+=`<text x="${ml+bw*i+bw/2}" y="${H-10}" text-anchor="middle">${dLabel(o.d)}</text>`;
      s+=`<rect class="hit" data-i="${i}" x="${ml+bw*i}" y="${mt}" width="${bw}" height="${ih}"${staafGetal(ml+bw*i+bw/2,yy(o.add),(o.add>0?"+":"")+nf0.format(o.add),dKort(o.d))}/>`});
    $("ytChart").innerHTML=s+"</svg>";
    $("ytChart").querySelectorAll(".hit").forEach(r=>{r.addEventListener("mousemove",e=>{const o=pts[+r.dataset.i];
      showTip(e,`<div class="t">${dLabel(o.d,1)}${o.d===vandaagAms()?" · tot nu":""}</div><div class="r"><span><i class="dot yt"></i>Erbij</span><b class="num">+${nf0.format(o.add)}</b></div><div class="r"><span>Totaal</span><b class="num">${nf0.format(o.tot)}</b></div>`)});
      r.addEventListener("mouseleave",hideTip)});
  }
  // top en groeiers
  const top=[...y.groups].sort((a,b)=>b.views-a.views).slice(0,10),mt2=top[0]?top[0].views:0;
  $("ytTop").innerHTML=top.map((g,i)=>bar(g.title,[{v:g.views,c:"yt"}],mt2,nf0.format(g.views),g.n>1?`${g.title}: ${g.n} versies samen`:g.title,i+1)).join("");
  const gr=[...y.groups].filter(g=>g.grow>0).sort((a,b)=>b.grow-a.grow).slice(0,10),mg=gr[0]?gr[0].grow:0;
  $("ytGrowSub").textContent=y.multiDay?"Weergaven erbij in de laatste 31 dagen"+kort:"Weergaven erbij, per track";
  $("ytGrow").innerHTML=!y.multiDay?'<p class="sub">Vanaf de tweede meting (vannacht) zie je hier welke tracks groeien.</p>':gr.length?gr.map((g,i)=>bar(g.title,[{v:g.grow,c:"yt"}],mg,"+"+nf0.format(g.grow),null,i+1)).join(""):'<p class="sub">Nog geen nieuwe weergaven in deze periode.</p>';
  // tabel
  const list=[...y.vids].sort((a,b)=>b.views-a.views);
  $("ytTable").innerHTML=`<thead><tr><th>Titel</th><th>Soort</th><th>Uitgebracht</th><th class="n">Weergaven</th>${vd?'<th class="n">Vandaag</th>':""}<th class="n">${y.multiDay?"31 dagen":"—"}</th><th class="n">Likes</th><th class="n">Reacties</th></tr></thead><tbody>`+
    list.map(v=>`<tr><td><a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" target="_blank" rel="noopener"><b>${esc(v.title)}</b></a></td>
      <td>${v.own?'<span class="chip mute">Eigen video</span>':'<span class="chip yt">Track</span>'}</td>
      <td class="mono" style="font-size:13px;white-space:nowrap">${v.pub?dLabel(v.pub,1):"—"}</td>
      <td class="n"><b>${nf0.format(v.views)}</b></td>${vd?`<td class="n">${(g.per.get(v.id)||0)>0?`<span class="up">+${nf0.format(g.per.get(v.id))}</span>`:"0"}</td>`:""}<td class="n">${y.multiDay?(v.grow>0?`<span class="up">+${nf0.format(v.grow)}</span>`:"0"):"—"}</td>
      <td class="n">${nf0.format(v.likes)}</td><td class="n">${nf0.format(v.comments)}</td></tr>`).join("")+
    `</tbody><tfoot><tr><td>Totaal (${list.length})</td><td></td><td></td><td class="n">${nf0.format(views)}</td>${vd?`<td class="n">+${nf0.format(g.erbe)}</td>`:""}<td class="n">${y.multiDay?"+"+nf0.format(grow):""}</td><td class="n">${nf0.format(likes)}</td><td class="n">${nf0.format(list.reduce((a,v)=>a+v.comments,0))}</td></tr></tfoot>`;
  renderYtCompare(y);
}
/* ---------- YouTube vs. SoundCloud-afrekening ---------- */
// Titel -> sleutel: kleine letters, zonder (Original Mix)/[..], zonder leestekens. Spaties eromheen = hele woorden matchen.
function tKey(s){return " "+String(s||"").toLowerCase().replace(/\(.*?\)|\[.*?\]/g," ").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim()+" "}
function ytCompare(y){
  const isYT=r=>/YOUTUBE/.test(r.partner)||/^SRAV_/.test(r.type);
  const art=r=>/ART_TRACK/.test(r.type)||(r.partner==="YOUTUBE_ART_TRACK"&&!/_SR$/.test(r.type));
  const map=new Map();
  SC.filter(isYT).forEach(r=>{const k=tKey(r.track);if(!k.trim())return;
    let o=map.get(k);if(!o){o={title:r.track.replace(/\s*[\(\[].*$/,"")||r.track,paid:0,other:0,usd:0,last:"",views:0,nv:0};map.set(k,o)}
    o.paid+=r.units;if(!art(r))o.other+=r.units;o.usd+=r.usd;if(r.m>o.last)o.last=r.m});
  const keys=[...map.keys()].sort((a,b)=>b.length-a.length); // langste eerst: "deep summer soul" gaat voor "soul"
  const labelKeys=LABEL.tracks.map(t=>tKey(t.t)).filter(k=>k.trim());
  const loose=new Map();
  y.vids.forEach(v=>{const vk=tKey(v.title);const k=keys.find(k=>vk.includes(k));
    if(k){const o=map.get(k);o.views+=v.views;o.nv++;return}
    let o=loose.get(vk);if(!o){o={title:v.title,paid:0,other:0,usd:0,last:"",views:0,nv:0,label:labelKeys.some(k=>vk.includes(k))};loose.set(vk,o)}o.views+=v.views;o.nv++});
  return [...map.values(),...loose.values()];
}
function cmpStatus(o){
  if(!o.paid&&o.label)return {c:"lb",t:"Via label",w:"Dit nummer staat in je DJ·World-overzicht. Het YouTube-geld komt dan via het label, niet via SoundCloud."};
  if(!o.paid)return {c:"warn",t:"Niet via SoundCloud",w:"Wel weergaven, maar geen YouTube-geld via SoundCloud en niet gevonden bij het label. Loopt dit nummer via een andere distributeur? Zo niet: check in Repost of dit nummer is aangemeld en Content ID aan staat."};
  if(!o.views)return {c:"mute",t:"Geen video gevonden",w:"SoundCloud rekent YouTube-weergaven af, maar er staat geen video met deze titel op de gevolgde kanalen. Waarschijnlijk onder een andere artiestnaam (ander Topic-kanaal), of gebruikt in video's van anderen."};
  const r=o.paid/o.views;
  if(r>1.1)return {c:"good",t:"Meer dan je kanaal",w:"Er wordt meer afgerekend dan je kanaal aan weergaven laat zien: het nummer wordt ook in video's van anderen gebruikt (Content ID)."};
  if(r>=0.7)return {c:"good",t:"Klopt",w:"Vrijwel alle weergaven komen terug in de afrekening. Het kleine verschil is vertraging: recente weergaven worden 2–3 maanden later afgerekend."};
  return {c:"warn",t:"Loopt achter",w:"Minder dan 70% komt terug. Meestal zijn dit recente weergaven die nog niet zijn afgerekend (kijk naar 'T/m'). Blijft het laag bij een volgend rapport, dan is het het uitzoeken waard."};
}
function renderYtCompare(y){
  const rows=ytCompare(y).filter(o=>o.views||o.paid).sort((a,b)=>b.views-a.views||b.paid-a.paid);
  const views=rows.reduce((a,o)=>a+o.views,0),paid=rows.reduce((a,o)=>a+o.paid,0),other=rows.reduce((a,o)=>a+o.other,0),usdT=rows.reduce((a,o)=>a+o.usd,0);
  const last=rows.reduce((a,o)=>o.last>a?o.last:a,"");
  const both=rows.filter(o=>o.views&&o.paid),bV=both.reduce((a,o)=>a+o.views,0),bP=both.reduce((a,o)=>a+o.paid,0);
  if(!paid){$("cmpStats").innerHTML='<p class="sub">Nog geen YouTube-regels in je SoundCloud-rapport gevonden. Laad een nieuwere SoundCloud-CSV in.</p>';$("cmpTable").innerHTML="";return}
  $("cmpSub").textContent=`YouTube-weergaven op ${dLabel(y.last,1)} naast alles wat SoundCloud t/m ${mLabel(last,1)} voor YouTube heeft afgerekend. De filters hierboven gelden hier niet.`;
  $("cmpStats").innerHTML=`
    <div class="ytstat"><span class="k">Weergaven nu</span><span class="v">${nf0.format(views)}</span><span class="s">openbaar, op je kanaal</span></div>
    <div class="ytstat"><span class="k">Afgerekend</span><span class="v">${nf0.format(paid)}</span><span class="s">${bV?pct(bP/bV)+" terug bij de "+both.length+" nummers die in beide staan":""}${other?` · ${nf0.format(other)} via anderen`:""}</span></div>
    <div class="ytstat"><span class="k">Verdiend via YouTube</span><span class="v">${eur(ex(usdT))}</span><span class="s">t/m ${mLabel(last,1)}</span></div>
    <div class="ytstat"><span class="k">Per 1.000 weergaven</span><span class="v">${views?eur(ex(usdT)/views*1000):"—"}</span><span class="s">wat een weergave je ongeveer oplevert</span></div>`;
  $("cmpTable").innerHTML=`<thead><tr><th>Nummer</th><th>Status</th><th class="n">YouTube</th><th class="n">Afgerekend</th><th class="n" title="Afgerekend via video's van anderen (Content ID)">Via anderen</th><th class="n">% terug</th><th class="n">Verdiend</th><th class="n" title="Verdiend per 1.000 afgerekende weergaven">€/1.000</th><th>T/m</th></tr></thead><tbody>`+
    rows.map(o=>{const st=cmpStatus(o);return `<tr><td><b>${esc(o.title)}</b>${o.nv>1?` <span class="sub" style="font-size:12px">(${o.nv} video's)</span>`:""}</td>
      <td><span class="chip ${st.c}" title="${esc(st.w)}">${st.t}</span></td>
      <td class="n">${o.views?nf0.format(o.views):"—"}</td><td class="n">${o.paid?nf0.format(o.paid):"—"}</td>
      <td class="n">${o.other?nf0.format(o.other):"—"}</td>
      <td class="n">${o.views&&o.paid?pct(o.paid/o.views):"—"}</td>
      <td class="n">${o.usd?eur(ex(o.usd)):"—"}</td><td class="n">${o.paid>=25?eur(ex(o.usd)/o.paid*1000):"—"}</td>
      <td class="mono" style="font-size:13px;white-space:nowrap">${o.last?mLabel(o.last):"—"}</td></tr>`}).join("")+
    `</tbody><tfoot><tr><td>Totaal (${rows.length})</td><td></td><td class="n">${nf0.format(views)}</td><td class="n">${nf0.format(paid)}</td><td class="n">${nf0.format(other)}</td><td class="n">${views?pct(paid/views):""}</td><td class="n">${eur(ex(usdT))}</td><td class="n">${paid?eur(ex(usdT)/paid*1000):""}</td><td></td></tr></tfoot>`;
}

/* ---------- SoundCloud live ---------- */
let SCL={tracks:[],snaps:[],err:null};
async function loadSCL(){
  try{
    const since=new Date(Date.now()-400*864e5).toISOString().slice(0,10);
    const tr=await sb.from("sc_tracks").select("track_id,title,permalink_url,created_at");
    if(tr.error)throw tr.error;
    let snaps=[],from=0;const size=1000;
    for(;;){const {data,error}=await sb.from("sc_snapshots").select("track_id,snap_date,plays,likes,reposts,comments,downloads")
      .gte("snap_date",since).order("snap_date").order("track_id").range(from,from+size-1);
      if(error)throw error;snaps=snaps.concat(data);if(data.length<size)break;from+=size}
    SCL={tracks:tr.data,snaps,err:null};
  }catch(e){SCL={tracks:[],snaps:[],err:e.message}}
}
function sclCompute(venster=7){
  const dates=[...new Set(SCL.snaps.map(s=>s.snap_date))].sort();
  const last=dates[dates.length-1];
  const cut=last?new Date(new Date(last).getTime()-venster*864e5).toISOString().slice(0,10):null;
  const baseCands=dates.filter(d=>d<=cut);
  const base=baseCands.length?baseCands[baseCands.length-1]:dates[0];
  const by=new Map();SCL.snaps.forEach(s=>{let m=by.get(s.track_id);if(!m){m={};by.set(s.track_id,m)}m[s.snap_date]=s});
  const today=last?new Date(last):new Date();
  const list=SCL.tracks.map(t=>{const m=by.get(t.track_id)||{};const cur=m[last];
    const ds=Object.keys(m).sort();const b=m[base]||m[ds.find(d=>d>=base)]||cur;
    const up=t.created_at?String(t.created_at).slice(0,10):"";
    const age=up?Math.max(1,Math.round((today-new Date(up))/864e5)):null;
    const plays=cur&&cur.plays!=null?+cur.plays:null;
    return {id:t.track_id,title:t.title,url:t.permalink_url,up,age,plays,
      likes:cur?+cur.likes||0:0,reposts:cur?+cur.reposts||0:0,comments:cur?+cur.comments||0:0,downloads:cur?+cur.downloads||0:0,
      grow:cur&&b&&plays!=null&&b.plays!=null?plays-(+b.plays):0,perDay:plays!=null&&age?plays/age:null}}).filter(t=>t.plays!=null||t.up);
  const daily=dates.map(d=>{const tot=SCL.snaps.filter(s=>s.snap_date===d).reduce((a,s)=>a+(+s.plays||0),0);return {d,tot}});
  daily.forEach((o,i)=>o.add=i?Math.max(0,o.tot-daily[i-1].tot):null);
  return {dates,last,base,list,daily,multiDay:dates.length>1,venster};
}
// SoundCloud-afrekening (partner SOUNDCLOUD) per nummer koppelen aan de openbare plays
function sclMoney(y){
  const map=new Map();
  SC.filter(r=>r.partner==="SOUNDCLOUD").forEach(r=>{const k=tKey(r.track);if(!k.trim())return;
    let o=map.get(k);if(!o){o={paid:0,usd:0,last:""};map.set(k,o)}o.paid+=r.units;o.usd+=r.usd;if(r.m>o.last)o.last=r.m});
  const keys=[...map.keys()].sort((a,b)=>b.length-a.length);
  // eerst exacte titels, daarna "titel bevat" — elke afrekening hoort bij maximaal één nummer
  const used=new Set(),hit=new Map();
  y.list.forEach(t=>{const tk=tKey(t.title);if(map.has(tk)&&!used.has(tk)){used.add(tk);hit.set(t.id,tk)}});
  y.list.forEach(t=>{if(hit.has(t.id))return;const tk=tKey(t.title);const k=keys.find(k=>!used.has(k)&&tk.includes(k));if(k){used.add(k);hit.set(t.id,k)}});
  return y.list.map(t=>{const o=hit.has(t.id)?map.get(hit.get(t.id)):null;
    return {...t,paid:o?o.paid:0,usd:o?o.usd:0,last:o?o.last:""}});
}
function renderSCLive(){
  const clear=()=>["sclChart","sclTop","sclGrow","sclTable","sclMoneyStats","sclMoneyTable"].forEach(i=>$(i).innerHTML="");
  if(SCL.err){$("sclStats").innerHTML=`<p class="sub">SoundCloud-cijfers ophalen lukte niet: ${esc(SCL.err)}</p>`;clear();return}
  const y=sclCompute(MUZIEK_DAGEN);
  if(!y.last){$("sclStats").innerHTML='<p class="sub">Nog geen metingen. Tik bovenaan op Ververse.</p>';clear();return}
  const L=y.list,plays=L.reduce((a,t)=>a+(t.plays||0),0),likes=L.reduce((a,t)=>a+t.likes,0),reposts=L.reduce((a,t)=>a+t.reposts,0),
    comments=L.reduce((a,t)=>a+t.comments,0),grow=L.reduce((a,t)=>a+t.grow,0);
  const days=Math.round((new Date(y.last)-new Date(y.base))/864e5);
  const byPlays=[...L].sort((a,b)=>(b.plays||0)-(a.plays||0));
  const best=L.filter(t=>t.grow>0).sort((a,b)=>b.grow-a.grow)[0];   // meeste plays erbè in de laatste 31 dagen
  const kort=muziekKort(y,days);
  const fresh=L.filter(t=>t.age!=null&&t.age<=60&&t.perDay!=null).sort((a,b)=>b.perDay-a.perDay)[0];
  const g=dagGroei(SCL.snaps,"track_id","plays"),li=liveInfo("sc",g),vd=g&&g.vandaag;
  $("sclSub").textContent=`Openbare cijfers van je SoundCloud-profiel, ververst zodra je het dashboard opent (hooguit 1x per 10 min) · laatste meting ${laatsteMeting("sc",g)}. De filters hierboven gelden hier niet.`;
  $("sclStats").innerHTML=`
    <div class="ytstat"><span class="k">Vandaag erbè</span><span class="v">${li.v}</span><span class="s">${li.s.replace(/^vandaag erbè \((.*?)\)/,"$1")}</span></div>
    <div class="ytstat"><span class="k">Plays totaal</span><span class="v">${nf0.format(plays)}</span><span class="s">${L.length} openbare nummers</span></div>
    <div class="ytstat"><span class="k">Erbè laatste 31 dagen</span><span class="v">${y.multiDay?"+"+nf0.format(grow):"—"}</span><span class="s">${y.multiDay?(days?nf0.format(grow/days)+" per dag gemiddeld"+kort:""):"vanaf morgen te zien"}</span></div>
    <div class="ytstat"><span class="k">Best beluisterd · 31 dagen</span><span class="v" style="font-size:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${best?esc(best.title):""}">${best?esc(best.title):"—"}</span><span class="s">${best?"+"+nf0.format(best.grow)+" plays"+(grow?" · "+pct(best.grow/grow)+" van wat erbè kwam":""):y.multiDay?"geen nieuwe plays":"vanaf morgen te zien"}</span></div>
    <div class="ytstat"><span class="k">Snelste nieuwe release</span><span class="v" style="font-size:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${fresh?esc(fresh.title):""}">${fresh?esc(fresh.title):"—"}</span><span class="s">${fresh?nf0.format(fresh.perDay)+" plays per dag sinds upload ("+fresh.age+" dagen)":"geen release in de laatste 60 dagen"}</span></div>
    <div class="ytstat"><span class="k">Likes</span><span class="v">${nf0.format(likes)}</span><span class="s">${nf0.format(reposts)} reposts · ${nf0.format(comments)} reacties</span></div>`;
  const pts=y.daily.filter(o=>o.add!=null);
  if(pts.length<1){$("sclChart").innerHTML='<p class="sub" style="margin:0">Na de tweede meting (vannacht) zie je hier per dag hoeveel plays erbij kwamen.</p>'}
  else{
    const W=Math.max(300,Math.round($("sclChart").clientWidth||1000)),H=W<600?200:240,ml=46,mr=8,mt=12,mb=30,iw=W-ml-mr,ih=H-mt-mb;
    const n=pts.length,sch=schaal(Math.max(...pts.map(o=>o.add)),4),max=sch.top,yy=v=>mt+ih-v/max*ih,bw=iw/n,bar=Math.max(2,Math.min(36,bw*0.66));
    let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nieuwe SoundCloud-plays per dag">`;
    sch.lijnen.forEach((v,i)=>{const t=yy(v);s+=`<line class="${i?"grid":"base"}" x1="${ml}" x2="${W-mr}" y1="${t}" y2="${t}"/><text x="${ml-8}" y="${t+4}" text-anchor="end">${nf0.format(v)}</text>`})
    const every=Math.ceil(n/(W<600?6:12));
    pts.forEach((o,i)=>{const x=ml+bw*i+(bw-bar)/2,h=o.add/max*ih;
      if(h>0)s+=`<path fill="var(--sc)" d="${roundTop(x,yy(o.add),bar,h,Math.min(4,h))}"/>`;
      if((i%every===0&&n-1-i>=every/2)||i===n-1)s+=`<text x="${ml+bw*i+bw/2}" y="${H-10}" text-anchor="middle">${dLabel(o.d)}</text>`;
      s+=`<rect class="hit" data-i="${i}" x="${ml+bw*i}" y="${mt}" width="${bw}" height="${ih}"${staafGetal(ml+bw*i+bw/2,yy(o.add),(o.add>0?"+":"")+nf0.format(o.add),dKort(o.d))}/>`});
    $("sclChart").innerHTML=s+"</svg>";
    $("sclChart").querySelectorAll(".hit").forEach(r=>{r.addEventListener("mousemove",e=>{const o=pts[+r.dataset.i];
      showTip(e,`<div class="t">${dLabel(o.d,1)}${o.d===vandaagAms()?" · tot nu":""}</div><div class="r"><span><i class="dot sc"></i>Erbij</span><b class="num">+${nf0.format(o.add)}</b></div><div class="r"><span>Totaal</span><b class="num">${nf0.format(o.tot)}</b></div>`)});
      r.addEventListener("mouseleave",hideTip)});
  }
  const top=byPlays.slice(0,10),mx=top[0]?top[0].plays||0:0;
  $("sclTop").innerHTML=top.map((t,i)=>bar(t.title,[{v:t.plays||0,c:"sc"}],mx,nf0.format(t.plays||0),null,i+1)).join("");
  const gr=L.filter(t=>t.grow>0).sort((a,b)=>b.grow-a.grow).slice(0,10),mg=gr[0]?gr[0].grow:0;
  $("sclGrowSub").textContent=y.multiDay?"Plays erbij in de laatste 31 dagen"+kort:"Plays erbij, per nummer";
  $("sclGrow").innerHTML=!y.multiDay?'<p class="sub">Vanaf de tweede meting (vannacht) zie je hier welke nummers groeien.</p>':gr.length?gr.map((t,i)=>bar(t.title,[{v:t.grow,c:"sc"}],mg,"+"+nf0.format(t.grow),null,i+1)).join(""):'<p class="sub">Nog geen nieuwe plays in deze periode.</p>';
  const mRows=sclMoney(y).sort((a,b)=>(b.plays||0)-(a.plays||0));
  const paid=mRows.reduce((a,t)=>a+t.paid,0),usdT=mRows.reduce((a,t)=>a+t.usd,0),lastM=mRows.reduce((a,t)=>t.last>a?t.last:a,"");
  const withPay=mRows.filter(t=>t.paid>0),pPlays=withPay.reduce((a,t)=>a+(t.plays||0),0);
  if(!SC.some(r=>r.partner==="SOUNDCLOUD")){$("sclMoneyStats").innerHTML='<p class="sub">Nog geen SoundCloud-regels in je rapport gevonden. Laad een SoundCloud-CSV in.</p>';$("sclMoneyTable").innerHTML=""}
  else{
    $("sclMoneySub").textContent=`Plays op ${dLabel(y.last,1)} naast wat SoundCloud${lastM?" t/m "+mLabel(lastM,1):""} voor plays óp SoundCloud heeft betaald (andere platforms tellen hier niet mee).`;
    $("sclMoneyStats").innerHTML=`
      <div class="ytstat"><span class="k">Plays nu</span><span class="v">${nf0.format(plays)}</span><span class="s">openbaar, op je profiel</span></div>
      <div class="ytstat"><span class="k">Betaalde plays</span><span class="v">${nf0.format(paid)}</span><span class="s">${pPlays?pct(paid/pPlays)+" van de plays bij de "+withPay.length+" nummers met geld":""}</span></div>
      <div class="ytstat"><span class="k">Verdiend op SoundCloud</span><span class="v">${eur(ex(usdT))}</span><span class="s">${lastM?"t/m "+mLabel(lastM,1):""}</span></div>
      <div class="ytstat"><span class="k">Per 1.000 plays</span><span class="v">${pPlays?eur(ex(usdT)/pPlays*1000):"—"}</span><span class="s">wat een play je gemiddeld oplevert</span></div>`;
    $("sclMoneyTable").innerHTML=`<thead><tr><th>Nummer</th><th class="n">Plays</th><th class="n">Betaald</th><th class="n">% betaald</th><th class="n">Verdiend</th><th class="n" title="Verdiend per 1.000 openbare plays">€/1.000 plays</th><th>T/m</th></tr></thead><tbody>`+
      mRows.map(t=>`<tr><td><b>${esc(t.title)}</b></td><td class="n">${t.plays!=null?nf0.format(t.plays):"—"}</td>
        <td class="n">${t.paid?nf0.format(t.paid):'<span class="chip mute" title="Geen SoundCloud-afrekening gevonden voor deze titel. Nieuw nummer (nog niet afgerekend), andere titel in het rapport, of niet via Repost gemonetiseerd.">geen</span>'}</td>
        <td class="n">${t.paid&&t.plays?pct(t.paid/t.plays):"—"}</td><td class="n">${t.usd?eur(ex(t.usd)):"—"}</td>
        <td class="n">${t.usd&&t.plays>=100?eur(ex(t.usd)/t.plays*1000):"—"}</td>
        <td class="mono" style="font-size:13px;white-space:nowrap">${t.last?mLabel(t.last):"—"}</td></tr>`).join("")+
      `</tbody><tfoot><tr><td>Totaal (${mRows.length})</td><td class="n">${nf0.format(plays)}</td><td class="n">${nf0.format(paid)}</td><td class="n">${pPlays?pct(paid/pPlays):""}</td><td class="n">${eur(ex(usdT))}</td><td class="n">${pPlays?eur(ex(usdT)/pPlays*1000):""}</td><td></td></tr></tfoot>`;
  }
  $("sclTable").innerHTML=`<thead><tr><th>Titel</th><th>Geüpload</th><th class="n">Plays</th>${vd?'<th class="n">Vandaag</th>':""}<th class="n">${y.multiDay?"31 dagen":"—"}</th><th class="n" title="Plays gedeeld door het aantal dagen sinds upload">Per dag</th><th class="n">Likes</th><th class="n">Reposts</th><th class="n">Reacties</th><th class="n">Downloads</th></tr></thead><tbody>`+
    byPlays.map(t=>`<tr><td>${t.url?`<a href="${esc(t.url)}" target="_blank" rel="noopener"><b>${esc(t.title)}</b></a>`:`<b>${esc(t.title)}</b>`}</td>
      <td class="mono" style="font-size:13px;white-space:nowrap">${t.up?dLabel(t.up,1):"—"}</td>
      <td class="n"><b>${t.plays!=null?nf0.format(t.plays):"—"}</b></td>${vd?`<td class="n">${(g.per.get(t.id)||0)>0?`<span class="up">+${nf0.format(g.per.get(t.id))}</span>`:"0"}</td>`:""}<td class="n">${y.multiDay?(t.grow>0?`<span class="up">+${nf0.format(t.grow)}</span>`:"0"):"—"}</td>
      <td class="n">${t.perDay!=null?(t.perDay>=10?nf0.format(t.perDay):nf2.format(t.perDay)):"—"}</td>
      <td class="n">${nf0.format(t.likes)}</td><td class="n">${nf0.format(t.reposts)}</td><td class="n">${nf0.format(t.comments)}</td><td class="n">${nf0.format(t.downloads)}</td></tr>`).join("")+
    `</tbody><tfoot><tr><td>Totaal (${L.length})</td><td></td><td class="n">${nf0.format(plays)}</td>${vd?`<td class="n">+${nf0.format(g.erbe)}</td>`:""}<td class="n">${y.multiDay?"+"+nf0.format(grow):""}</td><td></td><td class="n">${nf0.format(likes)}</td><td class="n">${nf0.format(reposts)}</td><td class="n">${nf0.format(comments)}</td><td class="n">${nf0.format(L.reduce((a,t)=>a+t.downloads,0))}</td></tr></tfoot>`;
}

/* ---------- Spotify (CSV-export uit Spotify for Artists) ---------- */
let SP={snaps:[],err:null};
async function loadSP(){
  try{let out=[],from=0;const size=1000;
    for(;;){const {data,error}=await sb.from("sp_snapshots").select("snap_date,song,release_date,streams,listeners,saves,source_file")
      .order("snap_date").order("song").range(from,from+size-1);
      if(error)throw error;out=out.concat(data);if(data.length<size)break;from+=size}
    SP={snaps:out,err:null};
  }catch(e){SP={snaps:[],err:e.message}}
}
function spCompute(){
  const dates=[...new Set(SP.snaps.map(s=>s.snap_date))].sort();
  const last=dates[dates.length-1],prev=dates.length>1?dates[dates.length-2]:null;
  const prevBy=new Map(SP.snaps.filter(s=>s.snap_date===prev).map(s=>[s.song,+s.streams||0]));
  const today=last?new Date(last):new Date();
  const cur=SP.snaps.filter(s=>s.snap_date===last);
  const yearAgo=last?new Date(new Date(last).getTime()-365*864e5).toISOString().slice(0,10):null;
  const old=dates.filter(d=>d<=yearAgo).pop()||null;
  const oldBy=new Map(SP.snaps.filter(s=>s.snap_date===old).map(s=>[s.song,+s.streams||0]));
  const days=prev?Math.max(1,Math.round((new Date(last)-new Date(prev))/864e5)):null;
  const list=cur.map(s=>{const rel=s.release_date?String(s.release_date).slice(0,10):"";
    const age=rel?Math.max(1,Math.round((today-new Date(rel))/864e5)):null;const streams=+s.streams||0;
    return {title:s.song,rel,age,streams,listeners:+s.listeners||0,saves:+s.saves||0,
      grow:prev?Math.max(0,streams-(prevBy.get(s.song)||0)):0,perDay:age?streams/age:null}});
  // 1.000-grens van Spotify: telt per nummer over de afgelopen 12 maanden
  list.forEach(t=>{
    const exact=(t.age!=null&&t.age<=365)||(old&&oldBy.has(t.title));
    t.y12=t.age!=null&&t.age<=365?t.streams:(old&&oldBy.has(t.title)?Math.max(0,t.streams-oldBy.get(t.title)):t.streams);
    t.y12exact=!!exact;t.below=t.y12<1000;
    // tempo: bij voorkeur sinds de vorige import, anders gemiddeld sinds release
    t.perMonth=prev&&days>=14?t.grow/days*30.4:(t.perDay!=null?t.perDay*30.4:null);
  });
  return {dates,last,prev,old,days,list,file:(cur[0]||{}).source_file||""};
}
// Titels koppelen: eerst exact, daarna "titel bevat" — elke afrekening hoort bij maximaal één nummer
function spMatch(list,map){
  const keys=[...map.keys()].sort((a,b)=>b.length-a.length),used=new Set(),hit=new Map();
  list.forEach(t=>{const k=tKey(t.title);if(map.has(k)&&!used.has(k)){used.add(k);hit.set(t,k)}});
  list.forEach(t=>{if(hit.has(t))return;const tk=tKey(t.title);const k=keys.find(k=>!used.has(k)&&tk.includes(k));if(k){used.add(k);hit.set(t,k)}});
  return t=>hit.has(t)?map.get(hit.get(t)):null;
}
const isSpotify=r=>/SPOTIFY/i.test(r.partner);
function spMoney(y){
  const scMap=new Map();
  SC.forEach(r=>{const k=tKey(r.track);if(!k.trim())return;let o=scMap.get(k);if(!o){o={paid:0,usd:0,last:"",any:0};scMap.set(k,o)}
    o.any+=r.usd;if(isSpotify(r)){o.paid+=r.units;o.usd+=r.usd;if(r.m>o.last)o.last=r.m}});
  // label: "Original Mix"/"Radio Edit" e.d. niet meenemen in de titel, andere versies (bijv. Chilled) wel
  const plain=v=>/^((original|extended|radio|club)\s*)?(mix|edit|version)?$/i.test(String(v||"").trim());
  const lbMap=new Map();
  LABEL.tracks.forEach(t=>{const k=tKey(t.t+(plain(t.v)?"":" "+t.v));if(!k.trim())return;
    let o=lbMap.get(k);if(!o){o={streams:0,net:0,gross:0};lbMap.set(k,o)}o.streams+=t.sc;o.net+=t.net;o.gross+=t.gross});
  const scOf=spMatch(y.list,scMap),lbOf=spMatch(y.list,lbMap);
  return y.list.map(t=>{const sc=scOf(t),lb=lbOf(t);const o={...t,via:"",paid:0,usd:0,lbS:0,lbEur:0,last:""};
    if(sc&&sc.paid>0){o.via="sc";o.paid=sc.paid;o.usd=sc.usd;o.last=sc.last}
    else if(lb){o.via="lb";o.lbS=lb.streams;o.lbEur=state.basis==="net"?lb.net:lb.gross}
    else if(sc&&sc.any>0)o.via="sc0";
    return o});
}
function spStatus(o){
  if(o.via==="sc"){const r=o.paid/(o.streams||1);
    return r>=0.7?{c:"good",t:"Klopt",w:"Het grootste deel van de Spotify-streams komt terug in je SoundCloud-afrekening. Het verschil is vertraging: recente streams worden 2–3 maanden later afgerekend."}
      :{c:"warn",t:"Loopt achter",w:"Minder dan 70% van de Spotify-streams is afgerekend. Bij een recente release is dat normaal (vertraging). Blijft het laag bij een volgend rapport, dan is het het uitzoeken waard."}}
  if(o.via==="lb")return o.lbS>=o.streams*0.7?{c:"lb",t:"Via label",w:`DJ·World telt ${nf0.format(o.lbS)} streams voor dit nummer (alle platforms samen), Spotify alleen al ${nf0.format(o.streams)}. Dat past bij elkaar.`}
      :{c:"warn",t:"Label telt minder",w:`DJ·World telt ${nf0.format(o.lbS)} streams (alle platforms samen), maar Spotify alleen al ${nf0.format(o.streams)}. Een deel kan vertraging zijn (nieuwste maanden nog niet verwerkt). Blijft het verschil groot, vraag het dan na bij DJ·World.`};
  if(o.below&&o.via!=="lb")return {c:"mute",t:"Onder 1.000-grens",w:grensTip(o)};
  if(o.via==="sc0")return {c:"warn",t:"Spotify ontbreekt",w:"SoundCloud betaalt wel voor dit nummer (op andere platforms), maar er staat geen Spotify-regel voor in je rapport. Check in Repost of dit nummer via Repost naar Spotify is gegaan."};
  if(o.age!=null&&o.age<90)return {c:"mute",t:"Nog te vroeg",w:"Minder dan 3 maanden oud: het geld is waarschijnlijk nog niet afgerekend."};
  return {c:"warn",t:"Geen afrekening",w:"Streams op Spotify, maar nergens geld gevonden bij SoundCloud of DJ·World. Staat het nummer onder een andere titel in een rapport, of loopt het via een andere distributeur?"};
}
function grensTip(o){
  const need=Math.max(0,1000-o.y12);
  let t=o.y12exact?`${nf0.format(o.y12)} streams in de afgelopen 12 maanden`:`${nf0.format(o.y12)} streams sinds release (in de afgelopen 12 maanden dus nog minder)`;
  if(!o.below)return o.y12exact?t+": boven de grens, dit nummer levert Spotify-geld op.":t+". Of het de grens haalt hangt af van de laatste 12 maanden; dat weet de app pas na een import van ongeveer een jaar geleden.";
  t+=`. Spotify betaalt pas vanaf 1.000 streams per nummer in 12 maanden; nog ${nf0.format(need)} nodig.`;
  if(o.perMonth!=null){const pm=o.perMonth;
    t+=pm*12<1000?` Bij het huidige tempo (ongeveer ${nf0.format(pm)} per maand) haalt dit nummer de grens niet vanzelf.`:` Bij het huidige tempo (ongeveer ${nf0.format(pm)} per maand) duurt het nog zo'n ${nf0.format(Math.ceil(need/pm))} maand(en).`}
  return t;
}
function grensCell(o){const w=Math.min(100,o.y12/10);
  return `<span title="${esc(grensTip(o))}"><span class="grens"><i style="width:${w}%"></i></span>${o.below?"nog "+nf0.format(1000-o.y12):(o.y12exact?'<span class="up">gehaald</span>':"mogelijk")}</span>`}
function renderSpotify(){
  const clear=()=>["spTop","spGrow","spMoneyStats","spMoneyNote","spMoneyTable","spTable"].forEach(i=>$(i).innerHTML="");
  if(SP.err){$("spStats").innerHTML=`<p class="sub">Spotify-cijfers ophalen lukte niet: ${esc(SP.err)}. Heb je 04_spotify.sql al gedraaid in Supabase?</p>`;clear();return}
  const y=spCompute();
  if(!y.last){$("spStats").innerHTML='<p class="sub">Nog geen Spotify-export ingeladen. Ga in Spotify for Artists naar Music → Songs, zet de periode op "All time", download de CSV en klik op "Spotify-CSV".</p>';clear();return}
  const L=y.list,streams=L.reduce((a,t)=>a+t.streams,0),grow=L.reduce((a,t)=>a+t.grow,0);
  const byS=[...L].sort((a,b)=>b.streams-a.streams),best=byS[0];
  const fresh=L.filter(t=>t.age!=null&&t.age>=7&&t.age<=60&&t.perDay!=null).sort((a,b)=>b.perDay-a.perDay)[0];
  $("spSub").textContent=`Stand van ${dLabel(y.last,1)}${y.file?" · "+y.file:""}. Spotify heeft geen koppeling: je werkt dit bij door af en toe een nieuwe export in te laden. De filters hierboven gelden hier niet.`;
  $("spStats").innerHTML=`
    <div class="ytstat"><span class="k">Streams totaal</span><span class="v">${nf0.format(streams)}</span><span class="s">${L.length} nummers, sinds release</span></div>
    <div class="ytstat"><span class="k">Erbè sinds vorige CSV</span><span class="v">${y.prev?"+"+nf0.format(grow):"—"}</span><span class="s">${y.prev?`tussen ${dLabel(y.prev)} en ${dLabel(y.last)} · ≈ ${nf0.format(grow/(y.days||1))} per dag · alleen bij een nieuwe CSV`:"zie je na je volgende CSV (Spotify heeft geen live koppeling)"}</span></div>
    <div class="ytstat"><span class="k">Best gestreamd</span><span class="v" style="font-size:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${best?esc(best.title):""}">${best?esc(best.title):"—"}</span><span class="s">${best?nf0.format(best.streams)+" streams · "+pct(best.streams/(streams||1))+" van alles":""}</span></div>
    <div class="ytstat"><span class="k">Snelste nieuwe release</span><span class="v" style="font-size:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${fresh?esc(fresh.title):""}">${fresh?esc(fresh.title):"—"}</span><span class="s">${fresh?nf2.format(fresh.perDay)+" streams per dag sinds release ("+fresh.age+" dagen)":"geen release tussen 1 week en 60 dagen oud"}</span></div>`;
  const top=byS.slice(0,10),mx=top[0]?top[0].streams:0;
  $("spTop").innerHTML=top.map((t,i)=>bar(t.title,[{v:t.streams,c:"sp"}],mx,nf0.format(t.streams),null,i+1)).join("");
  const gr=L.filter(t=>t.grow>0).sort((a,b)=>b.grow-a.grow).slice(0,10),mg=gr[0]?gr[0].grow:0;
  $("spGrowSub").textContent=y.prev?`Streams erbij sinds ${dLabel(y.prev,1)}`:"Streams erbij sinds de vorige import";
  $("spGrow").innerHTML=!y.prev?'<p class="sub">Laad over een paar weken opnieuw een export in; dan zie je hier welke nummers groeien.</p>':gr.length?gr.map((t,i)=>bar(t.title,[{v:t.grow,c:"sp"}],mg,"+"+nf0.format(t.grow),null,i+1)).join(""):'<p class="sub">Geen nieuwe streams sinds de vorige import.</p>';
  // geld
  const M=spMoney(y).sort((a,b)=>b.streams-a.streams);
  const sc=M.filter(o=>o.via==="sc"),lb=M.filter(o=>o.via==="lb");
  const scStreams=sc.reduce((a,o)=>a+o.streams,0),paid=sc.reduce((a,o)=>a+o.paid,0),usdT=sc.reduce((a,o)=>a+o.usd,0);
  const lbSp=lb.reduce((a,o)=>a+o.streams,0),lbAll=lb.reduce((a,o)=>a+o.lbS,0),lbEur=lb.reduce((a,o)=>a+o.lbEur,0);
  const lastM=M.reduce((a,o)=>o.last>a?o.last:a,"");
  $("spMoneySub").textContent=`Spotify-streams op ${dLabel(y.last,1)} naast wat SoundCloud${lastM?" (t/m "+mLabel(lastM,1)+")":""} voor Spotify afrekent, en naast je DJ·World-overzicht${LABEL.generated?" van "+LABEL.generated:""}.`;
  $("spMoneyStats").innerHTML=`
    <div class="ytstat"><span class="k">Spotify-streams</span><span class="v">${nf0.format(streams)}</span><span class="s">volgens Spotify for Artists</span></div>
    <div class="ytstat"><span class="k">Afgerekend via SoundCloud</span><span class="v">${nf0.format(paid)}</span><span class="s">${scStreams?pct(paid/scStreams)+" van de streams bij de "+sc.length+" nummers met Spotify-geld":"geen Spotify-regels gevonden"}</span></div>
    <div class="ytstat"><span class="k">Verdiend via SoundCloud</span><span class="v">${eur(ex(usdT))}</span><span class="s">${paid?eur(ex(usdT)/paid*1000)+" per 1.000 afgerekende streams":""}</span></div>
    <div class="ytstat"><span class="k">Boven de 1.000-grens</span><span class="v">${nf0.format(M.filter(o=>!o.below).length)} van ${M.length}</span><span class="s">${(()=>{const c=M.filter(o=>o.below).sort((a,b)=>b.y12-a.y12)[0];return c?"dichtstbij: "+esc(c.title)+" (nog "+nf0.format(1000-c.y12)+")":"alle nummers verdienen op Spotify"})()}</span></div>
    <div class="ytstat"><span class="k">Via DJ·World</span><span class="v">${nf0.format(lbSp)}</span><span class="s">Spotify-streams bij ${lb.length} label-nummers · label telt ${nf0.format(lbAll)} streams op alle platforms</span></div>`;
  const partners=[...new Set(SC.map(r=>r.partner).filter(Boolean))].sort();
  $("spMoneyNote").innerHTML=SC.length&&!SC.some(isSpotify)?`<p class="note" style="margin:14px 0 0;background:var(--warn-soft)">In je SoundCloud-rapport staat geen enkele Spotify-regel. Partners die er wel in staan: ${partners.map(p=>esc(pName(p))).join(", ")}. ${M.every(o=>o.below)?" Dat klopt: geen enkel nummer haalt de 1.000 streams in 12 maanden die Spotify minimaal vereist, dus er valt nog niets af te rekenen.":" Nummers onder de 1.000-grens leveren sowieso niets op; let vooral op nummers met \"Spotify ontbreekt\"."}</p>`:"";
  $("spMoneyTable").innerHTML=`<thead><tr><th>Nummer</th><th>Via</th><th>Status</th><th class="n">Spotify</th><th title="Spotify betaalt alleen voor nummers met minstens 1.000 streams in de afgelopen 12 maanden">1.000-grens</th><th class="n" title="SoundCloud: afgerekende Spotify-streams · DJ·World: streams op alle platforms samen">Afgerekend</th><th class="n">% terug</th><th class="n" title="SoundCloud: alleen Spotify · DJ·World: alle platforms samen">Verdiend</th><th>T/m</th></tr></thead><tbody>`+
    M.map(o=>{const st=spStatus(o);const via=o.via==="lb"?'<span class="chip lb">DJ·World</span>':o.via?'<span class="chip sc">SoundCloud</span>':"—";
      const af=o.via==="sc"?nf0.format(o.paid):o.via==="lb"?`<span title="alle platforms samen">${nf0.format(o.lbS)}*</span>`:"—";
      const pc=o.via==="sc"&&o.streams?pct(o.paid/o.streams):"—";
      const vd=o.via==="sc"?eur(ex(o.usd)):o.via==="lb"?`<span title="DJ·World, alle platforms samen">${eur(o.lbEur)}*</span>`:"—";
      return `<tr><td><b>${esc(o.title)}</b></td><td>${via}</td><td><span class="chip ${st.c}" title="${esc(st.w)}">${st.t}</span></td>
      <td class="n">${nf0.format(o.streams)}</td><td style="white-space:nowrap;font-size:13px">${grensCell(o)}</td><td class="n">${af}</td><td class="n">${pc}</td><td class="n">${vd}</td>
      <td class="mono" style="font-size:13px;white-space:nowrap">${o.last?mLabel(o.last):"—"}</td></tr>`}).join("")+
    `</tbody><tfoot><tr><td>Totaal (${M.length})</td><td></td><td></td><td class="n">${nf0.format(streams)}</td><td></td><td></td><td></td><td class="n">${eur(ex(usdT)+lbEur)}</td><td></td></tr></tfoot>`+
    `<caption style="caption-side:bottom;text-align:left;padding-top:8px" class="sub">* DJ·World geeft streams en geld per nummer voor alle platforms samen, niet alleen Spotify.</caption>`;
  // alle nummers
  const hasL=L.some(t=>t.listeners>0),hasS=L.some(t=>t.saves>0);
  $("spTable").innerHTML=`<thead><tr><th>Nummer</th><th>Release</th><th class="n">Streams</th><th class="n">${y.prev?"Erbij":"—"}</th><th class="n" title="Streams gedeeld door het aantal dagen sinds release">Per dag</th>${hasL?'<th class="n">Luisteraars</th>':""}${hasS?'<th class="n">Saves</th>':""}</tr></thead><tbody>`+
    byS.map(t=>`<tr><td><b>${esc(t.title)}</b></td><td class="mono" style="font-size:13px;white-space:nowrap">${t.rel?dLabel(t.rel,1):"—"}</td>
      <td class="n"><b>${nf0.format(t.streams)}</b></td><td class="n">${y.prev?(t.grow>0?`<span class="up">+${nf0.format(t.grow)}</span>`:"0"):"—"}</td>
      <td class="n">${t.perDay!=null?(t.perDay>=10?nf0.format(t.perDay):nf2.format(t.perDay)):"—"}</td>
      ${hasL?`<td class="n">${nf0.format(t.listeners)}</td>`:""}${hasS?`<td class="n">${nf0.format(t.saves)}</td>`:""}</tr>`).join("")+
    `</tbody><tfoot><tr><td>Totaal (${L.length})</td><td></td><td class="n">${nf0.format(streams)}</td><td class="n">${y.prev?"+"+nf0.format(grow):""}</td><td></td>${hasL?"<td></td>":""}${hasS?"<td></td>":""}</tr></tfoot>`;
}
$("fSp").addEventListener("change",async e=>{
  const file=e.target.files[0];e.target.value="";if(!file)return;
  const rows=parseCSV(await file.text());const hd=(rows[0]||[]).map(h=>h.trim().toLowerCase());
  const ix=n=>hd.indexOf(n);
  if(ix("song")<0||ix("streams")<0){showMsg("Dit lijkt geen Spotify-export. Kies in Spotify for Artists bij Music → Songs het download-icoontje.");return}
  if(!/all/i.test(file.name)&&!confirm('Staat de periode van deze export op "All time"?\n\nAlleen dan kloppen de totalen en de groei tussen imports. Klik op Annuleren om eerst een nieuwe export te maken.'))return;
  const g=(r,n)=>ix(n)<0?"":(r[ix(n)]||"").trim();
  const num=v=>{const x=Number(String(v).replace(/[^\d.-]/g,""));return isFinite(x)?x:0};
  const payload=rows.slice(1).filter(r=>g(r,"song")).map(r=>({song:g(r,"song"),
    release_date:/^\d{4}-\d{2}-\d{2}/.test(g(r,"release_date"))?g(r,"release_date").slice(0,10):null,
    streams:num(g(r,"streams")),listeners:ix("listeners")<0?null:num(g(r,"listeners")),saves:ix("saves")<0?null:num(g(r,"saves"))}));
  if(!payload.length){showMsg("Geen nummers gevonden in dit bestand.");return}
  const d=new Date(),snap=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  showMsg(`Bezig met opslaan van ${payload.length} nummers…`,true,true);
  const {data,error}=await sb.rpc("import_spotify",{rows:payload,snap,file_name:file.name});
  if(error){showMsg("Opslaan lukte niet: "+error.message+(/import_spotify|sp_snapshots/.test(error.message)?" — draai eerst 04_spotify.sql in Supabase.":""));return}
  await loadSP();setTab("spotify");
  showMsg(`${file.name} opgeslagen: ${data.inserted} nummers, stand van vandaag${data.deleted?" (eerdere import van vandaag vervangen)":""}.`,true);
});

