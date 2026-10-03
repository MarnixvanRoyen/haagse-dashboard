// partner-beeld (Supabase Edge Function) — PLAN B voor de bedankkaart (js/bedankkaart.js, 03-10-2026).
// Alleen nodig als de browser de plaatjes van Instagram niet op de kaart mag tekenen (CORS).
// De app probeert eerst zelf; lukt dat niet, dan haalt deze functie het plaatje op en geeft het terug
// als data-URL ("data:image/jpeg;base64,…"). Zo'n plaatje mag de browser wél op een kaart tekenen.
// Beveiliging: Verify JWT AAN (alleen ingelogd), alleen Marnix (uid), alleen plaatjes van Instagram/Facebook.
// Niets wordt bewaard.

const MARNIX = "94a9eceb-d804-4e47-bd22-48a79fd339ac";
const MAX_BYTES = 8 * 1024 * 1024;                        // grotere plaatjes weigeren
const TOEGESTAAN = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",                     // de JWT-check hieronder is de echte deur
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const antwoord = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

function base64(b: Uint8Array): string {                   // in stukjes, anders loopt btoa vast op grote plaatjes
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function wie(req: Request): string | null {                // de handtekening is al gecontroleerd door Supabase (Verify JWT)
  try {
    const t = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))).sub ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (wie(req) !== MARNIX) return antwoord({ fout: "Alleen voor Marnix" }, 403);
  let url: URL;
  try { url = new URL((await req.json()).url); } catch { return antwoord({ fout: "Geen geldige link" }, 400); }
  if (url.protocol !== "https:" || !TOEGESTAAN.test(url.hostname)) return antwoord({ fout: "Alleen plaatjes van Instagram" }, 400);
  try {
    const r = await fetch(url, { headers: { accept: "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.5" } });
    if (!r.ok) return antwoord({ fout: `plaatje ophalen lukte nie (${r.status})` }, 502);
    const soort = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!soort.startsWith("image/")) return antwoord({ fout: "geen plaatje (" + soort + ")" }, 502);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES) return antwoord({ fout: "plaatje te groot" }, 413);
    return antwoord({ data: `data:${soort};base64,${base64(bytes)}`, bytes: bytes.length });
  } catch (e) {
    return antwoord({ fout: String((e as Error)?.message ?? e).slice(0, 200) }, 502);
  }
});
