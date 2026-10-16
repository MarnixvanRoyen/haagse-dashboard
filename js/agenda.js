// agenda.js — afspraak in je agenda zetten zonder koppeling (16-10-2026, chat 50.2). Herbruikbaar voor Events (chat 53).
// Twee manieren:
//  1. agGoogleLink(): link die Google Agenda opent met alles al ingevuld. Jij tikt zelf op Opslaan.
//     Met gasten (add=) vraagt Google bij Opslaan of de uitnodiging verstuurd moet worden; die gaat dan vanaf het
//     account in `account` (authuser). Er wordt niks automatisch verstuurd en er is geen sleutel of koppeling nodig.
//  2. agIcs(): een .ics-bestandje (werkt in elke agenda: Apple Agenda, Google via de Agenda-app, Outlook).
// Privacy: deze functies sturen zelf niks weg en bewaren niks (geen localStorage, geen console).
// Een afspraak = {titel, start (ISO), eind (ISO), plek, tekst, gasten:[e-mail], account:"e-mail", uid}

const AG_GOOGLE="https://calendar.google.com/calendar/render";
const agUtc=iso=>new Date(iso).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");   // 2026-10-20T08:00:00.000Z → 20261020T080000Z
const agMail=s=>/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(String(s||"").trim());

function agGoogleLink(a){
  const p=new URLSearchParams({action:"TEMPLATE",text:a.titel||"Afspraak",dates:agUtc(a.start)+"/"+agUtc(a.eind),ctz:"Europe/Amsterdam"});
  if(a.plek)p.set("location",a.plek);
  if(a.tekst)p.set("details",a.tekst);
  const g=(a.gasten||[]).map(x=>String(x).trim()).filter(agMail);
  if(g.length)p.set("add",[...new Set(g)].join(","));
  if(agMail(a.account))p.set("authuser",a.account.trim());   // welk Google-account (als je er meâh hebt)
  return AG_GOOGLE+"?"+p.toString();
}

// tekst veilig maken voor .ics (\ ; , en enters) en lange regels vouwen (max 75 tekens)
const agEsc=s=>String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
function agVouw(r){const uit=[];let rest=r;while(rest.length>73){uit.push(rest.slice(0,73));rest=" "+rest.slice(73)}uit.push(rest);return uit.join("\r\n")}
function agIcsTekst(a){
  const r=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Haagse Content//Dashboard//NL","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",
    "UID:"+(a.uid||Date.now()+"@haagsecontent"),"DTSTAMP:"+agUtc(new Date().toISOString()),"DTSTART:"+agUtc(a.start),"DTEND:"+agUtc(a.eind),
    "SUMMARY:"+agEsc(a.titel||"Afspraak")];
  if(a.plek)r.push("LOCATION:"+agEsc(a.plek));
  if(a.tekst)r.push("DESCRIPTION:"+agEsc(a.tekst));
  r.push("BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+agEsc(a.titel||"Afspraak"),"TRIGGER:-PT1H","END:VALARM","END:VEVENT","END:VCALENDAR");
  return r.map(agVouw).join("\r\n")+"\r\n";
}
// downloadt het bestandje; iPhone: daarna in Downloads op tikken → "Voeg alles toe"; Mac: dubbelklik → Agenda
function agIcs(a,naam){
  const url=URL.createObjectURL(new Blob([agIcsTekst(a)],{type:"text/calendar;charset=utf-8"}));
  const l=document.createElement("a");l.href=url;l.download=(naam||"afspraak").replace(/[^\w.-]+/g,"-").slice(0,60)+".ics";
  document.body.appendChild(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
