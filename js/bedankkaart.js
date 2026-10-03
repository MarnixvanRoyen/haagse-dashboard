// bedankkaart.js — "Partner Appreciation": een bedankkaart voor een goede of kansrijke partner (03-10-2026).
// Hartje achter de naam in de kaart Samenwerkinge (samenwerking.js, igsBedank) → pop-up met:
//   taal (Haags / English, onthouden per partner), voorbeeldpost (standaard de beste), en wat je wilt downloaden:
//   plaatje voor de chat (1080×1350, PNG) en/of een A4 (PDF, met klikbare links).
// Bestandsnaam: yyyymmdd The_HagueBeachlife Partner Appreciation <partner>.png / .pdf
// Plaatjes (profielfoto partner, je eigen profielfoto, plaatje van de post): vers via rpc ig_bedank_beelden
// (supabase/20_bedankkaart.sql). De browser laadt ze zelf; mag dat niet (CORS), dan via Edge Function partner-beeld
// (plan B, supabase/functions/partner-beeld). Lukt ook dat niet: een nette vervanger (letter / Haagse vlag).
// De PDF maakt de app zelf (1 pagina met 1 JPEG + links), dus geen extra bibliotheek.
// Cijfers: alle posts waarop de partner je uitnodiging aannam (niet weggehaald), uit IG.posts (ig_post_stats).

const BK_KLEUR={zee:"#16323b",diep:"#0f262d",vlak:"#1f4450",lijn:"#2c535e",geel:"#f5c518",groen:"#2f8f46",groenL:"#5cc275",ink:"#f4f1e6",ink2:"#c6d5d3",muted:"#8fabac",donker:"#1a1400"};
const BK_FONT={kop:'"Titan One","Arial Black",sans-serif',tekst:'Nunito,system-ui,sans-serif'};
let BK=null;                 // {naam,r,taal,postId,img:{partner,ik,post},meld:{},links:[],laden}
const BK_CACHE=new Map();    // plaatjes per link, zodat wisselen van taal/post niet opnieuw ophaalt

const BK_T={
  haags:{nf:new Intl.NumberFormat("nl-NL",{maximumFractionDigits:0}),nf1:new Intl.NumberFormat("nl-NL",{maximumFractionDigits:1}),
    maand:["januari","februari","maart","april","mei","juni","juli","augustus","septembâh","oktobâh","novembâh","decembâh"],
    badge:{goed:"HAAGSE TOPPÂH-PARTNÂH",kansrijk:"TOPPÂH-SAMENWERKING"},
    kop:"Bedankt, âhwe!",intro:"Samen make we Den Haag nog mooiâh.",
    hlV:x=>`Met jâh erbè kreeg ik ${x} zoveel nieuwe volgâhs als bè m'n andere samenwerkinge!`,
    hlB:x=>`Met jâh erbè zage ${x} zoveel mense onze posts als bè m'n andere samenwerkinge!`,
    hlE:x=>`Met jâh erbè kwamme d'r per post ± ${x} nieuwe volgâhs bè!`,
    hlBereik:x=>`Samen haalde we een bereik van ${x}!`,
    tegels:["samenwerkinge","totaal bereik","likes & reacties","nieuwe volgâhs"],tegelAlt:"gedeeld & bewaard",
    postTitel:"Onze toppâh samen",postStats:(b,l,v)=>`${b} bereikt · ${l} likes`+(v!=null?` · +${v} volgâhs`:""),
    soort:{Reel:"Reel",Carrousel:"Carrousel",Foto:"Foto"},geenFoto:"Foto op Insta",
    dank:"Dank je wel voâh de mooie samenwerking. Op naâh de volgende!",groet:ik=>`Groetjes uit Den Haag · @${ik}`,
    tabel:"Al onze samenwerkinge",kolom:["Datum","Soort","Bereikt","Likes","Nieuwe volgâhs"],meer:n=>`en nog ${n} eerdâh`,
    bron:(ik,d)=>`Cijfâhs uit de Instagram-statistieken van @${ik}, t/m ${d}.`},
  en:{nf:new Intl.NumberFormat("en-GB",{maximumFractionDigits:0}),nf1:new Intl.NumberFormat("en-GB",{maximumFractionDigits:1}),
    maand:["January","February","March","April","May","June","July","August","September","October","November","December"],
    badge:{goed:"TOP PARTNER OF THE HAGUE",kansrijk:"TOP COLLAB"},
    kop:"Thank you!",intro:"Together we make The Hague shine.",
    hlV:x=>`With you on board I gained ${x} as many new followers as with my other collabs!`,
    hlB:x=>`With you on board, ${x} as many people saw our posts as with my other collabs!`,
    hlE:x=>`With you on board, each post brought in about ${x} extra new followers!`,
    hlBereik:x=>`Together we reached a total of ${x}!`,
    tegels:["collabs","total reach","likes & comments","new followers"],tegelAlt:"shares & saves",
    postTitel:"Our best post together",postStats:(b,l,v)=>`${b} reached · ${l} likes`+(v!=null?` · +${v} followers`:""),
    soort:{Reel:"Reel",Carrousel:"Carousel",Foto:"Photo"},geenFoto:"Photo on Insta",
    dank:"Thanks for the great collab. Here's to the next one!",groet:ik=>`Greetings from The Hague · @${ik}`,
    tabel:"All our collabs",kolom:["Date","Type","Reached","Likes","New followers"],meer:n=>`and ${n} earlier`,
    bron:(ik,d)=>`Figures from the Instagram insights of @${ik}, up to ${d}.`}
};
const bkDatum=(d,T)=>{const x=new Date(d);return `${x.getDate()} ${T.maand[x.getMonth()]} ${x.getFullYear()}`};
const bkX=(f,T)=>(f>=10?T.nf.format(f):T.nf1.format(f))+"×";

/* ---------- gegevens van één partner ---------- */
function bkGegevens(naam,r,taal){
  const T=BK_T[taal],stats=new Map(IG.posts.map(p=>[p.media_id,p]));
  const datum=new Map(IGS.posts.map(x=>[x.media_id,x.gepost_om]));
  const ids=[...new Set(IGS.partners.filter(p=>p.partner===naam&&p.status==="Accepted"&&!p.weg).map(p=>p.media_id))];
  const posts=ids.map(id=>{const s=stats.get(id)||{};return {id,d:s.gepost_om||datum.get(id),s,b:s.bereik,l:(s.likes||0),re:(s.reacties||0),v:s.nieuwe_volgers,
    gb:(s.gedeeld||0)+(s.bewaard||0),soort:s.media_id?soortNaam(s):"",tekst:s.bijschrift||"",link:s.permalink,plaatje:s.plaatje}})
    .filter(p=>p.d).sort((a,b)=>a.d<b.d?1:-1);
  const met=posts.filter(p=>p.b>0),som=(l,k)=>l.reduce((a,p)=>a+(p[k]||0),0);
  const metV=met.filter(p=>p.v!=null);
  // beste post: meeste nieuwe volgers, dan meeste bereik (bij voorkeur ≥ 2 dagen oud: dan zijn de cijfers min of meer af)
  const oud=met.filter(p=>Date.now()-Date.parse(p.d)>=2*864e5),pool=oud.length?oud:met;
  const kandidaten=[...pool].sort((a,b)=>(b.v??-1)-(a.v??-1)||b.b-a.b).concat(met.filter(p=>!pool.includes(p)));
  // hoogtepunt: wat valt het meest op (alleen echte verschillen, ≥ 1,25×)
  let hl=null;
  if(r&&r.gewoonV>0&&r.vpp/r.gewoonV>=1.25)hl={groot:bkX(r.vpp/r.gewoonV,T),tekst:T.hlV(bkX(r.vpp/r.gewoonV,T))};
  else if(r&&r.bx>=1.25)hl={groot:bkX(r.bx,T),tekst:T.hlB(bkX(r.bx,T))};
  else if(r&&r.eigen&&r.eigen.fB>=1.25)hl={groot:bkX(r.eigen.fB,T),tekst:T.hlB(bkX(r.eigen.fB,T))};
  else if(r&&r.eigen&&r.eigen.plus>=1)hl={groot:"+"+T.nf1.format(r.eigen.plus),tekst:T.hlE(T.nf1.format(r.eigen.plus))};
  else if(met.length)hl={groot:null,tekst:T.hlBereik(T.nf.format(som(met,"b")))};
  const i=(r&&r.info)||{};
  return {naam,posts,kandidaten,hl,badge:r&&r.bedank||"kansrijk",n:posts.length,bereik:som(met,"b"),lr:som(met,"l")+som(met,"re"),
    volgers:metV.length?som(metV,"v"):null,gb:som(met,"gb"),partnerVolgers:i.volgers,ik:(IG.acc&&IG.acc.gebruikersnaam)||"the_hague_beachlife"};
}

/* ---------- tekenhulpjes ---------- */
function bkRond(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
function bkCover(c,img,x,y,w,h){const s=Math.max(w/img.naturalWidth,h/img.naturalHeight),sw=w/s,sh=h/s;
  c.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,x,y,w,h)}
function bkTekst(c,t,x,y,font,kleur,align){c.font=font;c.fillStyle=kleur;c.textAlign=align||"left";c.fillText(t,x,y);return c.measureText(t).width}
// tekst in regels knippen (\n = nieuwe regel); laatste regel krijgt … als het niet past
function bkRegels(c,tekst,maxW,maxN){
  const uit=[];let af=false;
  for(const alinea of String(tekst).split("\n")){
    let regel="";
    for(const w of alinea.split(/\s+/).filter(Boolean)){
      const test=regel?regel+" "+w:w;
      if(c.measureText(test).width<=maxW){regel=test;continue}
      if(regel)uit.push(regel);
      regel=w;while(c.measureText(regel).width>maxW&&regel.length>1){let k=regel.length-1;while(k>1&&c.measureText(regel.slice(0,k)).width>maxW)k--;uit.push(regel.slice(0,k));regel=regel.slice(k)}
      if(uit.length>=maxN){af=true;break}
    }
    if(af)break;if(regel)uit.push(regel);if(uit.length>=maxN){af=true;break}
  }
  if(uit.length>maxN){uit.length=maxN;af=true}
  if(af&&uit.length){let l=uit[uit.length-1];while(l&&c.measureText(l+"…").width>maxW)l=l.slice(0,-1);uit[uit.length-1]=l.replace(/[\s,.;:–-]+$/,"")+"…"}
  return uit;
}
// bijschrift netjes: regels met alleen #hashtags/@namen/puntjes eruit, hashtags aan het eind van een regel eruit
function bkBijschrift(t){
  return String(t||"").split("\n").map(l=>l.trim().replace(/(\s*#[\p{L}\p{N}_]+)+$/u,"").trim())
    .filter(l=>l&&!/^[\s.·•_\-–—|]+$/.test(l)&&!/^([#@][\p{L}\p{N}_.]+[\s,.·•|\-]*)+$/u.test(l)).join("\n");
}
function bkAvatar(c,img,cx,cy,r,ring,letter){
  c.save();c.beginPath();c.arc(cx,cy,r+ring,0,7);c.fillStyle=BK_KLEUR.geel;c.fill();
  c.beginPath();c.arc(cx,cy,r,0,7);c.clip();
  if(img)bkCover(c,img,cx-r,cy-r,2*r,2*r);
  else{c.fillStyle=BK_KLEUR.groen;c.fillRect(cx-r,cy-r,2*r,2*r);bkTekst(c,(letter||"?").toUpperCase(),cx,cy+r*0.36,`${Math.round(r*1.05)}px ${BK_FONT.kop}`,BK_KLEUR.geel,"center")}
  c.restore();
}
function bkVlag(c,y,h,W){c.fillStyle=BK_KLEUR.geel;c.fillRect(0,y,W,h/2);c.fillStyle=BK_KLEUR.groen;c.fillRect(0,y+h/2,W,h/2)}
function bkGolven(c,W,H,k){   // zee onderin, rustig
  c.save();c.globalAlpha=0.5;
  for(let g=0;g<3;g++){const y=H-(150-g*40)*k;c.beginPath();c.moveTo(0,y);
    for(let x=0;x<=W;x+=20*k)c.lineTo(x,y+Math.sin(x/(90*k)+g*1.7)*7*k);
    c.lineTo(W,H);c.lineTo(0,H);c.closePath();c.fillStyle=g===2?"#1a3a44":"#173640";c.fill()}
  c.restore();
}

/* ---------- de kaart (L = maten; plaatje 1080×1350 of A4 1654×2339) ---------- */
const BK_L={
  kaart:{W:1080,H:1350,k:1,m:60,vlag:28,badgeY:52,kopY:198,introY:250,avY:380,avR:100,avDX:140,namY:522,
    hlY:552,hlH:140,tY:716,tH:140,pY:884,pH:330,img:[232,290],cap:[24,32,4],dankY:1262,groetY:1302,tabel:null},
  a4:{W:1654,H:2339,k:1.5,m:110,vlag:44,badgeY:110,kopY:332,introY:412,avY:622,avR:150,avDX:230,namY:850,
    hlY:900,hlH:190,tY:1130,tH:190,pY:1352,pH:440,img:[336,420],cap:[32,44,5],dankY:2196,groetY:2240,
    tabel:{y:1866,rijen:4,x:[110,560,1000,1200,1544]}}
};
function bkTeken(cv,d,T,L,img){
  const c=cv.getContext("2d"),{W,H,k,m}=L,links=[];
  c.textBaseline="alphabetic";
  // achtergrond: zee met Haagse vlag boven en onder
  const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,BK_KLEUR.zee);g.addColorStop(1,BK_KLEUR.diep);c.fillStyle=g;c.fillRect(0,0,W,H);
  bkGolven(c,W,H,k);bkVlag(c,0,L.vlag,W);bkVlag(c,H-L.vlag/2,L.vlag/2,W);
  // badge + kop + intro
  c.font=`${Math.round(24*k)}px ${BK_FONT.kop}`;const bt=T.badge[d.badge]||T.badge.kansrijk,bw=c.measureText(bt).width+48*k,bh=48*k;
  bkRond(c,(W-bw)/2,L.badgeY,bw,bh,bh/2);c.fillStyle=BK_KLEUR.geel;c.fill();
  bkTekst(c,bt,W/2,L.badgeY+bh*0.68,`${Math.round(24*k)}px ${BK_FONT.kop}`,BK_KLEUR.donker,"center");
  c.save();c.shadowColor="rgba(0,0,0,.35)";c.shadowOffsetY=6*k;bkTekst(c,T.kop,W/2,L.kopY,`${Math.round(96*k)}px ${BK_FONT.kop}`,BK_KLEUR.geel,"center");c.restore();
  bkTekst(c,T.intro,W/2,L.introY,`600 ${Math.round(30*k)}px ${BK_FONT.tekst}`,BK_KLEUR.ink2,"center");
  // twee profielfoto's met ×
  bkAvatar(c,img.partner,W/2-L.avDX,L.avY,L.avR,8*k,d.naam[0]);
  bkAvatar(c,img.ik,W/2+L.avDX,L.avY,L.avR,8*k,d.ik[0]);
  bkTekst(c,"×",W/2,L.avY+20*k,`${Math.round(56*k)}px ${BK_FONT.kop}`,BK_KLEUR.ink,"center");
  // namen: @partner × @ik (in de PDF klikbaar)
  const nf=`800 ${Math.round(28*k)}px ${BK_FONT.tekst}`;c.font=nf;
  const a="@"+d.naam,b="@"+d.ik,x3=" × ",wa=c.measureText(a).width,wx=c.measureText(x3).width,wb=c.measureText(b).width;
  let sx=(W-(wa+wx+wb))/2;
  bkTekst(c,a,sx,L.namY,nf,BK_KLEUR.ink);links.push({x:sx,y:L.namY-30*k,w:wa,h:38*k,url:`https://www.instagram.com/${d.naam}/`});
  bkTekst(c,x3,sx+wa,L.namY,nf,BK_KLEUR.muted);
  bkTekst(c,b,sx+wa+wx,L.namY,nf,BK_KLEUR.ink);links.push({x:sx+wa+wx,y:L.namY-30*k,w:wb,h:38*k,url:`https://www.instagram.com/${d.ik}/`});
  // hoogtepunt (groen vak)
  if(d.hl){bkRond(c,m,L.hlY,W-2*m,L.hlH,28*k);c.fillStyle=BK_KLEUR.groen;c.fill();
    let tx=m+40*k;
    if(d.hl.groot){const gw=bkTekst(c,d.hl.groot,tx,L.hlY+L.hlH/2+30*k,`${Math.round(84*k)}px ${BK_FONT.kop}`,BK_KLEUR.geel);tx+=gw+30*k}
    c.font=`800 ${Math.round(30*k)}px ${BK_FONT.tekst}`;const rg=bkRegels(c,d.hl.tekst,W-m-36*k-tx,3),lh=40*k;
    const y0=L.hlY+L.hlH/2-(rg.length-1)*lh/2+10*k;
    rg.forEach((l,i)=>bkTekst(c,l,d.hl.groot?tx:W/2,y0+i*lh,c.font,"#fff",d.hl.groot?"left":"center"))}
  // vier tegels
  const tw=(W-2*m-3*20*k)/4,tg=[[d.n,T.tegels[0]],[d.bereik,T.tegels[1]],[d.lr,T.tegels[2]],d.volgers!=null?[d.volgers,T.tegels[3]]:[d.gb,T.tegelAlt]];
  tg.forEach(([v,lbl],i)=>{const x=m+i*(tw+20*k);bkRond(c,x,L.tY,tw,L.tH,22*k);c.fillStyle=BK_KLEUR.vlak;c.fill();
    const t=(i===3&&d.volgers!=null?"+":"")+T.nf.format(v||0);let f=52*k;c.font=`${Math.round(f)}px ${BK_FONT.kop}`;while(c.measureText(t).width>tw-24*k&&f>24)c.font=`${Math.round(f-=2)}px ${BK_FONT.kop}`;
    bkTekst(c,t,x+tw/2,L.tY+L.tH*0.5+8*k,c.font,BK_KLEUR.geel,"center");
    bkTekst(c,lbl,x+tw/2,L.tY+L.tH*0.5+48*k,`700 ${Math.round(22*k)}px ${BK_FONT.tekst}`,BK_KLEUR.ink2,"center")});
  // voorbeeldpost: plaatje + titel + datum + bijschrift + cijfers
  const p=d.post;
  bkRond(c,m,L.pY,W-2*m,L.pH,28*k);c.fillStyle=BK_KLEUR.vlak;c.fill();
  const [iw,ih]=L.img,ix=m+20*k,iy=L.pY+(L.pH-ih)/2;
  c.save();bkRond(c,ix,iy,iw,ih,18*k);c.clip();
  if(img.post)bkCover(c,img.post,ix,iy,iw,ih);
  else{c.fillStyle=BK_KLEUR.zee;c.fillRect(ix,iy,iw,ih);c.fillStyle=BK_KLEUR.geel;c.fillRect(ix,iy+ih*0.42,iw,ih*0.08);c.fillStyle=BK_KLEUR.groen;c.fillRect(ix,iy+ih*0.5,iw,ih*0.08);
    bkTekst(c,T.geenFoto,ix+iw/2,iy+ih*0.75,`800 ${Math.round(22*k)}px ${BK_FONT.tekst}`,BK_KLEUR.ink2,"center")}
  c.restore();
  if(p){
    if(p.link)links.push({x:ix,y:iy,w:iw,h:ih,url:p.link});
    const tx=ix+iw+28*k,tmax=W-m-24*k-tx;
    bkTekst(c,T.postTitel,tx,L.pY+60*k,`${Math.round(34*k)}px ${BK_FONT.kop}`,BK_KLEUR.geel);
    bkTekst(c,`${bkDatum(p.d,T)} · ${T.soort[p.soort]||p.soort}`,tx,L.pY+96*k,`600 ${Math.round(22*k)}px ${BK_FONT.tekst}`,BK_KLEUR.muted);
    // cijfers onderin; het bijschrift krijgt de ruimte die overblijft (nooit over de cijfers heen)
    const sf=`800 ${Math.round(24*k)}px ${BK_FONT.tekst}`;c.font=sf;
    const st=bkRegels(c,T.postStats(T.nf.format(p.b||0),T.nf.format(p.l||0),p.v!=null?T.nf.format(p.v):null),tmax,2);
    const sy=L.pY+L.pH-30*k-(st.length-1)*34*k;   // basislijn eerste cijferregel
    st.forEach((l,i)=>bkTekst(c,l,tx,sy+i*34*k,sf,BK_KLEUR.geel));
    const [cf,clh,cn]=L.cap,cy=L.pY+140*k;c.font=`400 ${cf}px ${BK_FONT.tekst}`;   // L.cap = [lettergrootte, regelafstand, max regels]
    const past=Math.max(1,Math.min(cn,Math.floor((sy-24*k-cy)/clh)+1));
    bkRegels(c,bkBijschrift(p.tekst)||"—",tmax,past).forEach((l,i)=>bkTekst(c,l,tx,cy+i*clh,c.font,BK_KLEUR.ink));
  }
  // A4: tabel met alle samenwerkingen (nieuwste eerst)
  if(L.tabel){
    let y=L.tabel.y;
    bkTekst(c,T.tabel,m,y,`${Math.round(30*k)}px ${BK_FONT.kop}`,BK_KLEUR.geel);y+=72;
    const kol=L.tabel.x,al=["left","left","right","right","right"];
    const rij=(vals,font,kleur)=>vals.forEach((v,i)=>bkTekst(c,v,kol[i],y,font,kleur,al[i]));
    rij(T.kolom,`800 ${Math.round(20*k)}px ${BK_FONT.tekst}`,BK_KLEUR.muted);
    c.fillStyle=BK_KLEUR.lijn;c.fillRect(m,y+14,W-2*m,2);y+=50;
    const toon=d.posts.slice(0,L.tabel.rijen);
    toon.forEach(q=>{rij([bkDatum(q.d,T),T.soort[q.soort]||q.soort||"",q.b>0?T.nf.format(q.b):"—",q.b>0?T.nf.format(q.l):"—",q.v!=null?"+"+T.nf.format(q.v):"—"],
      `600 ${Math.round(22*k)}px ${BK_FONT.tekst}`,BK_KLEUR.ink);if(q.link)links.push({x:m,y:y-34,w:W-2*m,h:44,url:q.link});y+=44});
    if(d.posts.length>toon.length)bkTekst(c,T.meer(d.posts.length-toon.length),m,y,`600 ${Math.round(20*k)}px ${BK_FONT.tekst}`,BK_KLEUR.muted);
  }
  // afsluiter
  c.font=`800 ${Math.round(30*k)}px ${BK_FONT.tekst}`;const dk=bkRegels(c,T.dank,W-2*m,2);
  dk.forEach((l,i)=>bkTekst(c,l,W/2,L.dankY-(dk.length-1-i)*40*k,c.font,"#fff","center"));
  bkTekst(c,T.groet(d.ik),W/2,L.groetY,`600 ${Math.round(22*k)}px ${BK_FONT.tekst}`,BK_KLEUR.ink2,"center");
  if(L.tabel)bkTekst(c,T.bron(d.ik,bkDatum(new Date(),T)),W/2,L.groetY+40,`400 ${Math.round(17*k)}px ${BK_FONT.tekst}`,BK_KLEUR.muted,"center");
  return links;
}

/* ---------- PDF: 1 pagina A4 met 1 JPEG en klikbare links (zelf gemaakt, geen bibliotheek) ---------- */
function bkPdf(jpg,wPx,hPx,links,titel){
  const W=595.28,H=841.89,enc=new TextEncoder(),delen=[],ofs=[];let pos=0;
  const zet=x=>{const b=typeof x==="string"?enc.encode(x):x;delen.push(b);pos+=b.length};
  const obj=(n,body)=>{ofs[n]=pos;zet(`${n} 0 obj\n`);[].concat(body).forEach(zet);zet("\nendobj\n")};
  const f=v=>(+v).toFixed(2),sx=W/wPx,sy=H/hPx;
  const str=s=>"("+String(s).replace(/[^\x20-\x7e]/g,"").replace(/[\\()]/g,"\\$&")+")";
  const utf16=s=>{let h="FEFF";for(const ch of String(s)){let cp=ch.codePointAt(0);
    if(cp>0xffff){cp-=0x10000;h+=(0xd800+(cp>>10)).toString(16).padStart(4,"0")+(0xdc00+(cp&0x3ff)).toString(16).padStart(4,"0")}
    else h+=cp.toString(16).padStart(4,"0")}return "<"+h.toUpperCase()+">"};
  const inhoud=`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`,n0=6,infoN=n0+links.length;
  zet("%PDF-1.4\n");zet(new Uint8Array([37,226,227,207,211,10]));   // %âãÏÓ: zegt "dit bestand bevat binaire data"
  obj(1,"<< /Type /Catalog /Pages 2 0 R >>");
  obj(2,"<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R`
    +(links.length?` /Annots [${links.map((_,i)=>`${n0+i} 0 R`).join(" ")}]`:"")+" >>");
  obj(4,[`<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`,jpg,"\nendstream"]);
  obj(5,`<< /Length ${enc.encode(inhoud).length} >>\nstream\n${inhoud}\nendstream`);
  links.forEach((l,i)=>obj(n0+i,`<< /Type /Annot /Subtype /Link /Rect [${f(l.x*sx)} ${f(H-(l.y+l.h)*sy)} ${f((l.x+l.w)*sx)} ${f(H-l.y*sy)}] /Border [0 0 0] /A << /Type /Action /S /URI /URI ${str(l.url)} >> >>`));
  obj(infoN,`<< /Title ${utf16(titel)} /Author (@the_hague_beachlife) /Producer (Haagse Content Performance Dashboard) >>`);
  const xref=pos,n=infoN+1;
  zet(`xref\n0 ${n}\n0000000000 65535 f \n`+Array.from({length:n-1},(_,i)=>String(ofs[i+1]).padStart(10,"0")+" 00000 n \n").join(""));
  zet(`trailer\n<< /Size ${n} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(delen,{type:"application/pdf"});
}

/* ---------- plaatjes ophalen ---------- */
function bkImg(src,cors){return new Promise(res=>{const i=new Image();if(cors)i.crossOrigin="anonymous";
  const t=setTimeout(()=>res(null),10000);i.onload=()=>{clearTimeout(t);res(i)};i.onerror=()=>{clearTimeout(t);res(null)};i.src=src})}
// eerst zelf (mag alleen als Instagram het toestaat: CORS), anders via de Edge Function (plan B)
async function bkLaad(url){
  if(!url)return {img:null,via:"geen"};
  if(BK_CACHE.has(url))return BK_CACHE.get(url);
  let uit;
  const img=await bkImg(url,true);
  if(img)uit={img,via:"direct"};
  else try{
    const {data,error}=await sb.functions.invoke("partner-beeld",{body:{url}});
    const b=!error&&data&&data.data?await bkImg(data.data,false):null;
    uit=b?{img:b,via:"planb"}:{img:null,via:"mislukt",planb:!!(error&&/404|not found/i.test((error.context&&error.context.status)+" "+error.message)),fout:error?error.message:(data&&data.fout)||"?"};
  }catch(e){uit={img:null,via:"mislukt",fout:e.message||String(e)}}
  if(uit.img)BK_CACHE.set(url,uit);
  return uit;
}
async function bkBeeldenHalen(postId){
  const naam=BK.naam,p=(IG.posts.find(x=>x.media_id===postId)||{});
  let urls={partner:null,ik:null,post:p.plaatje||null},fout={};
  if(!BK.rpc){   // 1x per partner verse links bij Meta (3 vragen); bij een andere post eerst de link van vannacht
    const {data,error}=await sb.rpc("ig_bedank_beelden",{p_partner:naam,p_media_id:postId||null});
    if(error)fout.rpc=/function|schema cache|does not exist/i.test(error.message)?"draai eerst supabase/20_bedankkaart.sql":error.message;
    BK.rpc=data||{};
    if(data&&data.post&&data.post.beeld)urls.post=data.post.beeld;
  }
  const r=BK.rpc||{};
  urls.partner=r.partner&&r.partner.profile_picture_url||null;
  urls.ik=r.ik&&r.ik.profile_picture_url||null;
  if(!urls.ik){const {data}=await sb.from("ig_account").select("profielfoto").order("bijgewerkt_om",{ascending:false}).limit(1);urls.ik=data&&data[0]&&data[0].profielfoto||null}
  if(r.partner_fout)fout.partner=r.partner_fout;
  let [a,b,c]=await Promise.all([bkLaad(urls.partner),bkLaad(urls.ik),bkLaad(urls.post)]);
  // plaatje van vannacht verlopen? dan een verse link bij Meta vragen
  if(!c.img&&postId&&!(r.post&&r.post.beeld&&r.post.beeld===urls.post)){
    const {data}=await sb.rpc("ig_bedank_beelden",{p_partner:naam,p_media_id:postId});
    if(data&&data.post&&data.post.beeld)c=await bkLaad(data.post.beeld);
  }
  BK.img={partner:a.img,ik:b.img,post:c.img};BK.meld={a,b,c,fout};
}

/* ---------- pop-up ---------- */
function bkTaalVan(naam){try{return (JSON.parse(store.get("hc_bedank_taal")||"{}"))[naam]||"haags"}catch(e){return "haags"}}
function bkTaalZet(naam,t){try{const o=JSON.parse(store.get("hc_bedank_taal")||"{}");o[naam]=t;store.set("hc_bedank_taal",JSON.stringify(o))}catch(e){}}
async function bkOpen(naam){
  const r=(IGS_S&&IGS_S.rijen||[]).find(x=>x.naam===naam);
  if(!r||!r.bedank)return;
  BK={naam,r,taal:bkTaalVan(naam),postId:null,img:{partner:null,ik:null,post:null},meld:{},links:[],laden:true,rpc:null};
  const d=bkGegevens(naam,r,BK.taal);BK.postId=d.kandidaten[0]?d.kandidaten[0].id:null;
  $("bkPop").hidden=false;document.body.classList.add("popopen");
  $("bkTitel").textContent=`Bedankkaart voâh @${naam}`;
  $("bkSub").innerHTML=`${r.bedank==="goed"?"Goed voor je":"Kansrijk"}: ${nf0.format(d.n)} samenwerking${d.n===1?"":"e"}. Kies wat je wilt sture en tik op Downloade.`;
  $("bkPost").innerHTML=d.kandidaten.map(p=>`<option value="${esc(p.id)}">${dKort(dagNL(p.d))} · ${esc(p.soort)} · ${nf0.format(p.b)} bereikt${p.v!=null?` · +${nf0.format(p.v)} volgâhs`:""}</option>`).join("")
    ||`<option value="">Nog geen post met cijfâhs</option>`;
  $("bkPost").disabled=d.kandidaten.length<2;
  $("bkPng").checked=$("bkPdf").checked=true;                      // bij openen staan beide weer aan
  bkKnoppen();$("bkStatus").textContent="Plaatjes ophalen bij Instagram…";$("bkDownload").disabled=true;
  await document.fonts.load(`40px "Titan One"`).catch(()=>{});await document.fonts.load(`800 30px Nunito`).catch(()=>{});
  bkTekenAlles();                                  // eerst zonder plaatjes, dan met
  $("bkDicht").focus({preventScroll:true});
  await bkBeeldenHalen(BK.postId);
  if(!BK||BK.naam!==naam)return;                   // intussen gesloten of andere partner
  BK.laden=false;bkTekenAlles();bkStatus();
}
function bkKnoppen(){
  document.querySelectorAll("#bkTaal button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===BK.taal));
  $("bkDownload").disabled=BK.laden||!($("bkPng").checked||$("bkPdf").checked);
}
function bkTekenAlles(){
  const T=BK_T[BK.taal],d=bkGegevens(BK.naam,BK.r,BK.taal);
  d.post=d.posts.find(p=>p.id===BK.postId)||null;
  bkTeken($("bkCanvas"),d,T,BK_L.kaart,BK.img);
  BK.links=bkTeken($("bkA4"),d,T,BK_L.a4,BK.img);
  bkKnoppen();
}
function bkStatus(){
  const m=BK.meld,l=[];
  if(m.fout&&m.fout.rpc)l.push(`Verse plaatjes: ${esc(m.fout.rpc)}`);
  if(m.fout&&m.fout.partner)l.push(`Profielfoto partnâh: ${esc(m.fout.partner)}`);
  const mis=[[m.a,"profielfoto partnâh"],[m.b,"jouw profielfoto"],[m.c,"plaatje van de post"]].filter(([x])=>x&&!x.img&&x.via!=="geen");
  if(mis.some(([x])=>x.planb))   // Instagram staat het nie toe en plan B staat nog nie aan
    l.push(`Instagram laat de browser ${mis.map(([,w])=>w).join(", ")} nie direct gebruiken. Zet de Edge Function <code>partner-beeld</code> aan`);
  else mis.forEach(([x,w])=>l.push(`${w[0].toUpperCase()+w.slice(1)} lukte nie${x.fout?` (${esc(x.fout)})`:""}`));
  $("bkStatus").innerHTML=l.length?`⚠ ${l.join(" · ")}. Tot dan staat er een nette vervanger op de kaart.`
    +(mis.some(([x])=>x.planb)?`<details><summary>Zo zet je de Edge Function aan (5 minuten)</summary><ol>
      <li>Supabase → <b>Edge Functions</b> → <b>Deploy a new function</b> → <b>Via Editor</b>.</li>
      <li>Naam: <code>partner-beeld</code>. Plak de code uit <code>haagse-dashboard/supabase/functions/partner-beeld/index.ts</code> en klik <b>Deploy</b>.</li>
      <li>Laat <b>Verify JWT</b> AAN (anders dan bij story-mini): dan kan alleen jij hem gebruiken.</li>
      <li>Sluit deze pop-up en tik opnieuw op het hartje.</li></ol></details>`:"")
    :"✓ Alle plaatjes binnen. Tik op een voorbeeld om het aan of uit te zetten.";
}
function bkDicht(){if(!BK)return;BK=null;$("bkPop").hidden=true;document.body.classList.remove("popopen")}
function bkBewaar(blob,naam){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=naam;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},5000)}
function bkBestandsnaam(naam){const d=new Date(),p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())} The_HagueBeachlife Partner Appreciation ${naam}`}
async function bkDownloaden(){
  const basis=bkBestandsnaam(BK.naam),blob=(cv,soort,q)=>new Promise((res,rej)=>{try{cv.toBlob(b=>b?res(b):rej(new Error("leeg")),soort,q)}catch(e){rej(e)}});
  try{
    if($("bkPng").checked)bkBewaar(await blob($("bkCanvas"),"image/png"),basis+".png");
    if($("bkPdf").checked){const j=await blob($("bkA4"),"image/jpeg",0.9);
      const pdf=bkPdf(new Uint8Array(await j.arrayBuffer()),BK_L.a4.W,BK_L.a4.H,BK.links,`Partner Appreciation @${BK.naam} · @the_hague_beachlife`);
      setTimeout(()=>bkBewaar(pdf,basis+".pdf"),$("bkPng").checked?500:0)}
    $("bkStatus").textContent=`✓ Opgeslage in je Downloads als "${basis}"${$("bkPng").checked&&$("bkPdf").checked?" (.png en .pdf)":$("bkPng").checked?".png":".pdf"}.`;
  }catch(e){$("bkStatus").textContent="Downloade lukte nie: "+(e.message||e)+(/tainted|insecure|security/i.test(e.message||"")?" (een plaatje van Instagram mag nie op de kaart: zet de Edge Function partner-beeld aan)":"")}
}
document.addEventListener("click",e=>{
  const k=e.target.closest&&e.target.closest("[data-bk]");
  if(k){if(!k.disabled)bkOpen(k.dataset.bk);return}
  if(!BK)return;
  if(e.target.closest("#bkDicht")||e.target.id==="bkPop"){bkDicht();return}
  const t=e.target.closest("#bkTaal button");
  if(t){BK.taal=t.dataset.v;bkTaalZet(BK.naam,BK.taal);bkTekenAlles();return}
  if(e.target.closest("#bkDownload")&&!$("bkDownload").disabled)bkDownloaden();
});
document.addEventListener("change",async e=>{
  if(!BK)return;
  if(e.target.id==="bkPng"||e.target.id==="bkPdf"){bkKnoppen();return}
  if(e.target.id==="bkPost"){BK.postId=e.target.value;BK.laden=true;bkKnoppen();$("bkStatus").textContent="Plaatje van de post ophalen…";
    bkTekenAlles();const naam=BK.naam;await bkBeeldenHalen(BK.postId);if(!BK||BK.naam!==naam)return;BK.laden=false;bkTekenAlles();bkStatus()}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&BK)bkDicht()});
