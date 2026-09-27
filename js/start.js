// start.js — Supabase-verbinding, data ophalen, inloggen/uitloggen. Laadt als laatste.

/* ---------- Supabase ---------- */
const CFG=window.MI_CONFIG||{};
const configured=CFG.supabaseUrl&&/^https:\/\//.test(CFG.supabaseUrl)&&CFG.supabaseKey&&!/PLAK/.test(CFG.supabaseKey);
let sb=null, LAST_IMPORT=null;

async function fetchAll(table,cols){
  let out=[],from=0;const size=1000;
  for(;;){const {data,error}=await sb.from(table).select(cols).order("id").range(from,from+size-1);
    if(error)throw error;out=out.concat(data);if(data.length<size)break;from+=size}
  return out;
}
async function loadData(){
  const [sc,lp,lt,ls]=await Promise.all([
    fetchAll("sc_earnings","id,reporting_period,artist,track,partner,type,country,units,revenue_usd,source_file,imported_at"),
    fetchAll("label_periods","id,period_month,name,gross,aggregator,djworld,net,status"),
    fetchAll("label_tracks","id,track,version,artist,stream_count,download_count,streams,downloads,gross,net"),
    fetchAll("label_statements","id,statement_date,paid_out,to_book,outside_tool")]);
  SC=toRows(sc);
  const last=sc.reduce((a,r)=>!a||r.imported_at>a.imported_at?r:a,null);
  LAST_IMPORT=last?(last.source_file||"")+" op "+new Date(last.imported_at).toLocaleDateString("nl-NL"):null;
  const s=ls.sort((a,b)=>a.statement_date<b.statement_date?1:-1)[0];
  LABEL={periods:lp.map(p=>({m:String(p.period_month).slice(0,7),name:p.name,gross:+p.gross,agg:+p.aggregator,djw:+p.djworld,net:+p.net,status:p.status||""})).sort((a,b)=>a.m<b.m?-1:1),
    tracks:lt.map(x=>({t:x.track,v:x.version||"",a:x.artist||"",sc:+x.stream_count||0,dc:+x.download_count||0,streams:+x.streams,downloads:+x.downloads,gross:+x.gross,net:+x.net})),
    generated:s?new Date(s.statement_date).toLocaleDateString("nl-NL"):null,paidOut:s?+s.paid_out:0,toBook:s?+s.to_book:0,outside:s?+s.outside_tool:0};
  await Promise.all([loadYT(),loadSCL(),loadSP(),loadSneek(),loadGC()]);
  fillSelects();setTab(state.tab);setSectie(sectie);
  if(!SC.length&&!LABEL.periods.length)showMsg("Je database is nog leeg. Klik op 'SoundCloud-CSV' of 'Label-PDF' en kies je rapport.",false,true);
}
function showScreen(which){$("login").hidden=which!=="login";$("app").hidden=which!=="app";$("loading").hidden=which!=="loading"}
async function start(){
  if(!configured){showScreen("login");$("loginForm").hidden=true;$("loginErr").hidden=false;$("loginErr").textContent="Vul eerst je Supabase-gegevens in het bestand config.js in.";return}
  if(!sb)sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey);
  $("fRate").value=state.rate;syncSeg("fSource",state.source);syncSeg("fBasis",state.basis);
  const {data:{session}}=await sb.auth.getSession();
  if(!session){showScreen("login");return}
  showScreen("loading");
  try{await loadData();showScreen("app")}
  catch(err){showScreen("login");$("loginErr").hidden=false;$("loginErr").textContent="Data ophalen lukte niet: "+err.message}
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();const btn=$("loginBtn");btn.disabled=true;btn.textContent="Effe geduld…";$("loginErr").hidden=true;
  const {error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  btn.disabled=false;btn.textContent="Kom d'r in";
  if(error){$("loginErr").hidden=false;$("loginErr").textContent=error.message==="Invalid login credentials"?"E-mail of wachtwoord klopt nie, jonguh.":error.message;return}
  $("password").value="";start();
});
$("logout").addEventListener("click",async()=>{await sb.auth.signOut();SC=[];showScreen("login")});
start();
