// plekbedank.js — bedankkaart voor een Plekkies-deelnemer (16-10-2026, chat 50.3)
// Knop ♥ Bedankje bij een plekkie met status Gepost + gekoppelde post (regel in de lijst én in het formulier)
// → pop-up met een story-plaatje 1080×1920 (PNG) om per chat te sturen; de deelnemer kan hem als story delen.
// English erbij (16-10, Marnix): plaats wisselt mee tussen "Den Haag" en "The Hague" zolang je hem nie zelf aanpaste.
// Keuzes Marnix (16-10): alleen story · nadruk "samen een mooi stukje Den Haag laten zien" · plaatsnaam zelf aan te passen
//   · foto uit de post · cijfers (bereik, likes, gedeeld) aan/uit · taal Haags of Netjes ("je") · onderin vrij voor een sticker.
// Privacy: op de kaart alleen wat al openbaar in de post staat (naam, Insta-naam, plek). Nooit e-mail, telefoon of verhaal.
//   Niks van de persoon in browseropslag; alleen de laatst gekozen taal (geen persoonsgegeven) wordt onthouden.
// Hergebruikt uit bedankkaart.js (chat 03): BK_KLEUR, BK_FONT, bkRond, bkCover, bkTekst, bkVlag, bkGolven, bkLaad, bkBewaar.
// Plaatje van de post: eerst de link van vannacht (IG.posts.plaatje); verlopen → verse link via rpc ig_bedank_beelden (20_bedankkaart.sql).

let PB=null;   // {sid, taal, plaats, cijfers, img, laden, terug}
const PB_W=1080,PB_H=1920;
const PB_T={
  haags:{nf:new Intl.NumberFormat("nl-NL",{maximumFractionDigits:0}),
    badge:"HAAGSE PLEKKIES DOÂH HAAGSE MENSE",kop:"Bedankt, âhwe!",
    boodschap:pl=>`Same hebbe we 'n mooi stukkie ${pl} late zien!`,
    dank:"Dank je wel dat je je plekkie wou dele.",
    tegels:["mense bereikt","likes","keâh gedeeld"],groet:(pl,ik)=>`Groetjes uit ${pl} · @${ik}`,geenFoto:"Foto op Insta"},
  netjes:{nf:new Intl.NumberFormat("nl-NL",{maximumFractionDigits:0}),
    badge:"HAAGSE PLEKJES DOOR HAAGSE MENSEN",kop:"Bedankt voor de mooie samenwerking!",
    boodschap:pl=>`Samen hebben we een prachtig stukje ${pl} laten zien!`,
    dank:"Dank je wel dat je jouw plekje met ons wilde delen.",
    tegels:["mensen bereikt","likes","keer gedeeld"],groet:(pl,ik)=>`Groeten uit ${pl} · @${ik}`,geenFoto:"Foto op Instagram"},
  en:{nf:new Intl.NumberFormat("en-GB",{maximumFractionDigits:0}),plaats:"The Hague",
    badge:"THE HAGUE SPOTS BY LOCALS",kop:"Thanks for the great collab!",
    boodschap:pl=>`Together we showed a beautiful piece of ${pl}!`,
    dank:"Thank you for sharing your favourite spot with us.",
    tegels:["people reached","likes","shares"],groet:(pl,ik)=>`Greetings from ${pl} · @${ik}`,geenFoto:"Photo on Instagram"}
};
const pbIk=()=>(IG.acc&&IG.acc.gebruikersnaam)||"the_hague_beachlife";
// tekst in regels knippen; alleen "…" als het echt nie past (bkRegels zet soms … achter tekst die wél past)
function pbRegels(c,tekst,maxW,maxN){
  const w=String(tekst||"").split(/[ \t\n]+/).filter(Boolean),uit=[];let r="",i=0;
  for(;i<w.length;i++){const t=r?r+" "+w[i]:w[i];
    if(c.measureText(t).width<=maxW||!r){r=t;continue}
    uit.push(r);r=w[i];if(uit.length===maxN)break}
  if(uit.length<maxN&&r){uit.push(r);r="";i=w.length}
  const rest=i<w.length;
  if(uit.length){let l=uit[uit.length-1];const kort=c.measureText(l).width>maxW;
    if(rest||kort){while(l&&c.measureText(l+"…").width>maxW)l=l.slice(0,-1);uit[uit.length-1]=l.replace(/[\s,.;:–-]+$/,"")+"…"}}
  return uit;
}

/* ---------- mag deze kaart een bedankje? ---------- */
// alleen bij status Gepost, met een persoon (nie gewist) en een post die in je Insta-cijfers staat
function pbKan(k){return !!(k&&k.m&&k.s&&k.s.status==="gepost"&&k.s.media_id&&hpPost(k.s.media_id))}
function pbGegevens(sid){
  const k=hpKaarten().find(x=>x.s&&x.s.id===sid);if(!pbKan(k))return null;
  const p=hpPost(k.s.media_id),n=v=>v==null||v===""?null:+v;
  return {naam:k.m.naam,insta:k.m.insta||null,plek:k.s.plek,p,ik:pbIk(),
    cijfers:[n(p.bereik),n(p.likes),n(p.gedeeld)]};
}

/* ---------- tekenen: story 1080×1920 ---------- */
// Boven ± 200 px en onder ± 200 px laat Insta z'n eigen knoppen zien; onderin houden we vrij voor een @- of link-sticker.
function pbTeken(cv,d,T,o,img){
  const c=cv.getContext("2d"),W=PB_W,H=PB_H,m=70,K=BK_KLEUR,F=BK_FONT;
  c.textBaseline="alphabetic";
  const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,K.zee);g.addColorStop(1,K.diep);c.fillStyle=g;c.fillRect(0,0,W,H);
  bkGolven(c,W,H,1.6);bkVlag(c,0,28,W);bkVlag(c,H-14,14,W);
  // badge (naam van de serie)
  let y=170;c.font=`26px ${F.kop}`;const bw=Math.min(W-2*m,c.measureText(T.badge).width+56),bh=54;
  bkRond(c,(W-bw)/2,y,bw,bh,bh/2);c.fillStyle=K.geel;c.fill();
  bkTekst(c,T.badge,W/2,y+bh*0.68,`26px ${F.kop}`,K.donker,"center");
  // kop: zo groot als past, hooguit 2 regels
  y+=bh+40;let kf=112,kr;
  for(;kf>=56;kf-=4){c.font=`${kf}px ${F.kop}`;kr=pbRegels(c,T.kop,W-2*m,3);if(kr.length<=2&&!kr.some(l=>l.endsWith("…")))break}
  kf=Math.max(kf,56);if(kr.length>2)kr=kr.slice(0,2);const klh=kf*1.08;
  c.save();c.shadowColor="rgba(0,0,0,.35)";c.shadowOffsetY=6;
  kr.forEach((l,i)=>bkTekst(c,l,W/2,y+kf*0.85+i*klh,`${kf}px ${F.kop}`,K.geel,"center"));c.restore();
  y+=kf*0.85+(kr.length-1)*klh+64;
  // naam + @insta
  c.font=`800 46px ${F.tekst}`;const nm=pbRegels(c,d.naam,W-2*m,1)[0]||"";
  bkTekst(c,nm,W/2,y,c.font,K.ink,"center");
  if(d.insta){y+=48;bkTekst(c,"@"+d.insta,W/2,y,`700 34px ${F.tekst}`,K.groenL,"center")}
  const fotoTop=y+44;
  // onderkant van boven naar beneden opbouwen: groet (vast) ← cijfers ← boodschap
  const vrij=1740;                       // vanaf hier niks: ruimte voor de sticker van de deelnemer
  const groetY=vrij-30;
  const tg=o.cijfers?d.cijfers.map((v,i)=>[v,T.tegels[i]]).filter(([v])=>v!=null):[];
  const tH=128,tY=tg.length?groetY-60-tH:groetY;
  c.font=`800 44px ${F.tekst}`;const br=pbRegels(c,T.boodschap(o.plaats.replace(/ /g,"\u00a0")),W-2*m,2),blh=54;
  c.font=`600 32px ${F.tekst}`;const dr=pbRegels(c,T.dank,W-2*m,2),dlh=40;
  const tekstH=br.length*blh+16+dr.length*dlh;
  const tekstTop=(tg.length?tY:groetY-20)-40-tekstH;
  // foto: alles wat overblijft tussen naam en tekst, staand 4:5, gecentreerd
  const ruimte=tekstTop-60-fotoTop;
  let fh=Math.max(300,ruimte),fw=fh*0.8;if(fw>W-2*m-60){fw=W-2*m-60;fh=fw/0.8}
  const fx=(W-fw)/2,fy=fotoTop+(ruimte-fh)/2;
  c.save();c.shadowColor="rgba(0,0,0,.4)";c.shadowBlur=30;c.shadowOffsetY=10;bkRond(c,fx-10,fy-10,fw+20,fh+20,34);c.fillStyle=K.geel;c.fill();c.restore();
  c.save();bkRond(c,fx,fy,fw,fh,26);c.clip();
  if(img)bkCover(c,img,fx,fy,fw,fh);
  else{c.fillStyle=K.vlak;c.fillRect(fx,fy,fw,fh);c.fillStyle=K.geel;c.fillRect(fx,fy+fh*0.44,fw,fh*0.06);c.fillStyle=K.groen;c.fillRect(fx,fy+fh*0.5,fw,fh*0.06);
    bkTekst(c,T.geenFoto,fx+fw/2,fy+fh*0.7,`800 32px ${F.tekst}`,K.ink2,"center")}
  c.restore();
  // plek als groen labeltje over de onderrand van de foto
  c.font=`800 38px ${F.tekst}`;const pl=pbRegels(c,d.plek,fw-40,1)[0]||"";const pw=c.measureText(pl).width+92,ph=66,px=(W-pw)/2,py=fy+fh-ph/2+10;
  bkRond(c,px,py,pw,ph,ph/2);c.fillStyle=K.groen;c.fill();
  pbSpeld(c,px+36,py+ph/2,K.geel);
  bkTekst(c,pl,px+62,py+ph*0.68,c.font,"#fff","left");
  // boodschap + dank
  let ty=tekstTop+44;
  br.forEach((l,i)=>bkTekst(c,l,W/2,ty+i*blh,`800 44px ${F.tekst}`,"#fff","center"));
  ty+=(br.length-1)*blh+16+dlh;
  dr.forEach((l,i)=>bkTekst(c,l,W/2,ty+i*dlh,`600 32px ${F.tekst}`,K.ink2,"center"));
  // cijfers (optioneel)
  if(tg.length){const gap=20,tw=(W-2*m-gap*(tg.length-1))/tg.length;
    tg.forEach(([v,lbl],i)=>{const x=m+i*(tw+gap);bkRond(c,x,tY,tw,tH,24);c.fillStyle=K.vlak;c.fill();
      const t=T.nf.format(v);let f=60;c.font=`${f}px ${F.kop}`;while(c.measureText(t).width>tw-28&&f>28)c.font=`${f-=2}px ${F.kop}`;
      bkTekst(c,t,x+tw/2,tY+68,c.font,K.geel,"center");
      bkTekst(c,lbl,x+tw/2,tY+tH-24,`700 26px ${F.tekst}`,K.ink2,"center")})}
  bkTekst(c,T.groet(o.plaats,d.ik),W/2,groetY,`700 30px ${F.tekst}`,K.ink2,"center");
}
function pbSpeld(c,x,y,kleur){   // simpel kaart-speldje (geen emoji: die tekent nie overal hetzelfde)
  c.save();c.fillStyle=kleur;c.beginPath();c.arc(x,y-6,13,Math.PI,0);c.lineTo(x,y+18);c.closePath();c.fill();
  c.beginPath();c.arc(x,y-6,5,0,7);c.fillStyle=BK_KLEUR.groen;c.fill();c.restore();
}

/* ---------- plaatje van de post ---------- */
async function pbBeeld(p){
  let r=await bkLaad(p.plaatje);
  if(r.img)return r;
  try{   // link van vannacht verlopen of geweigerd: verse link bij Meta (1 aanroep)
    const {data,error}=await sb.rpc("ig_bedank_beelden",{p_partner:pbIk(),p_media_id:p.media_id});
    if(error)return {img:null,fout:/function|schema cache|does not exist/i.test(error.message)?"draai eerst 20_bedankkaart.sql":error.message};
    if(data&&data.post&&data.post.beeld){const r2=await bkLaad(data.post.beeld);if(r2.img)return r2;r=r2}
    else if(data&&data.post_fout)r={img:null,fout:data.post_fout};
  }catch(e){r={img:null,fout:e.message||String(e)}}
  return r;
}

/* ---------- pop-up ---------- */
const pbStdPlaats=t=>PB_T[t].plaats||"Den Haag";
function pbTaal(){const t=store.get("hc_plekbedank_taal");return PB_T[t]?t:"haags"}
async function pbOpen(sid,terug){
  const d=pbGegevens(sid);if(!d)return;
  const taal0=pbTaal();PB={sid,taal:taal0,plaats:pbStdPlaats(taal0),cijfers:d.cijfers[0]!=null,img:null,laden:true,terug:terug||document.activeElement};
  $("pbPop").hidden=false;document.body.classList.add("popopen");
  $("pbTitel").textContent=`Bedankkaart voâh ${d.naam}`;
  $("pbSub").textContent=`${d.plek} · story 1080×1920 om per chat te sture`;
  $("pbPlaats").value=PB.plaats;
  $("pbCijfers").checked=PB.cijfers;$("pbCijfers").disabled=d.cijfers[0]==null;
  $("pbCijfersTxt").textContent=d.cijfers[0]==null?"Cijfâhs (nog geen cijfâhs van deze post)":"Cijfâhs erop (bereikt, likes, gedeeld)";
  $("pbDeel").hidden=!pbKanDelen();
  pbKnoppen();$("pbStatus").textContent="Foto van de post ophale…";
  await document.fonts.load(`40px "Titan One"`).catch(()=>{});await document.fonts.load(`800 30px Nunito`).catch(()=>{});
  if(!PB||PB.sid!==sid)return;
  pbTekenNu();$("pbDicht").focus({preventScroll:true});
  const r=await pbBeeld(d.p);
  if(!PB||PB.sid!==sid)return;   // intussen gesloten
  PB.img=r.img;PB.laden=false;pbTekenNu();pbKnoppen();
  $("pbStatus").textContent=r.img?"✓ Klaar. Pas de plaats of de cijfâhs aan als je wil.":`⚠ Foto van de post lukte nie${r.fout?` (${r.fout})`:""}. Er staat nu een nette vervanger op.`;
}
function pbTekenNu(){if(!PB)return;const d=pbGegevens(PB.sid);if(!d)return;
  pbTeken($("pbCanvas"),d,PB_T[PB.taal],{plaats:PB.plaats.trim()||pbStdPlaats(PB.taal),cijfers:PB.cijfers&&d.cijfers[0]!=null},PB.img)}
function pbKnoppen(){if(!PB)return;
  document.querySelectorAll("#pbTaal button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===PB.taal));
  $("pbDeel").disabled=$("pbDownload").disabled=PB.laden}
function pbDicht(){if(!PB)return;const t=PB.terug;PB=null;$("pbPop").hidden=true;
  if(![...document.querySelectorAll(".vnpop")].some(x=>!x.hidden))document.body.classList.remove("popopen");
  if(t&&t.isConnected&&t.focus)t.focus({preventScroll:true})}
function pbKanDelen(){try{return !!(navigator.canShare&&navigator.canShare({files:[new File([""],"x.png",{type:"image/png"})]}))}catch(e){return false}}
function pbBestandsnaam(){const d=new Date(),p=n=>String(n).padStart(2,"0"),g=pbGegevens(PB.sid);
  const wie=String((g&&(g.insta||g.naam))||"plekkie").replace(/[^\p{L}\p{N}._ -]/gu,"").trim().slice(0,40)||"plekkie";
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())} The_HagueBeachlife Bedankt ${wie}.png`}
function pbBlob(){return new Promise((res,rej)=>{try{$("pbCanvas").toBlob(b=>b?res(b):rej(new Error("leeg")),"image/png")}catch(e){rej(e)}})}
function pbFoutTekst(e){const m=e&&e.message||String(e);
  return /tainted|insecure|security/i.test(m)?"de foto van Instagram mag nie op de kaart (zet de Edge Function partner-beeld aan, zie BEDANKKAART.md)":m}
async function pbDelen(){
  try{const naam=pbBestandsnaam(),f=new File([await pbBlob()],naam,{type:"image/png"});
    await navigator.share({files:[f]});$("pbStatus").textContent="✓ Gedeeld.";}
  catch(e){if(e&&e.name==="AbortError")return;$("pbStatus").textContent="Dele lukte nie: "+pbFoutTekst(e)+". Probeer Downloade."}
}
async function pbDownloaden(){
  try{const naam=pbBestandsnaam();bkBewaar(await pbBlob(),naam);$("pbStatus").textContent=`✓ Opgeslage in je Downloads als "${naam}".`}
  catch(e){$("pbStatus").textContent="Downloade lukte nie: "+pbFoutTekst(e)}
}

/* ---------- klikken en typen ---------- */
document.addEventListener("click",e=>{
  const t=e.target;if(!t.closest)return;
  const k=t.closest("[data-hpbedank]");if(k){e.stopPropagation();if(!k.disabled)pbOpen(k.dataset.hpbedank,k);return}
  if(!PB)return;
  if(t.closest("#pbDicht")||t.id==="pbPop")return pbDicht();
  const tb=t.closest("#pbTaal button");if(tb){if(PB.plaats.trim()===pbStdPlaats(PB.taal)){PB.plaats=pbStdPlaats(tb.dataset.v);$("pbPlaats").value=PB.plaats}PB.taal=tb.dataset.v;store.set("hc_plekbedank_taal",PB.taal);pbKnoppen();pbTekenNu();return}
  if(t.closest("#pbDeel")&&!$("pbDeel").disabled)return pbDelen();
  if(t.closest("#pbDownload")&&!$("pbDownload").disabled)return pbDownloaden();
},true);   // capture: vóór de klik op de regel (die opent anders het formulier)
document.addEventListener("input",e=>{
  if(!PB)return;
  if(e.target.id==="pbPlaats"){PB.plaats=e.target.value;pbTekenNu()}
  if(e.target.id==="pbCijfers"){PB.cijfers=e.target.checked;pbTekenNu()}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&PB){e.preventDefault();e.stopImmediatePropagation();pbDicht()}},true);
