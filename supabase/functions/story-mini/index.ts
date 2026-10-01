// story-mini (Supabase Edge Function) — maakt van nieuwe Insta-stories een klein plaatje (135 x 240, JPEG)
// en bewaart dat in de tabel ig_story_mini. Waarom: de plaatje-link van Meta verloopt na een paar dagen.
// Wordt elk uur aangeroepen door pg_cron (functie ig_story_mini_maken, zie 16_story_mini.sql).
// Beveiliging: alleen met de juiste x-sleutel (Edge Function secret STORY_MINI_SLEUTEL = Vault story_mini_sleutel).
import jpeg from "npm:jpeg-js@0.4.4";   // puur JavaScript (imagescript werkte nie bij Supabase: "unsupported arch/platform")
import { createClient } from "npm:@supabase/supabase-js@2";

const BREED = 135, HOOG = 240;      // 9:16, net als een story
const KWALITEIT = 60;               // JPEG-kwaliteit: ± 5-8 KB per plaatje
const PER_KEER = 2;                 // Supabase geeft een functie ± 2 s rekentijd; 1 plaatje kost ± 0,3 s

function base64(b: Uint8Array): string {   // bytes → tekst (in stukjes, anders loopt btoa vast op grote plaatjes)
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

// Verkleinen: midden pakken in 9:16 ("cover") en per doel-pixel het gemiddelde van het blokje bron-pixels nemen
function verklein(src: Uint8Array, w: number, h: number): Uint8Array {
  const doel = BREED / HOOG;
  let cw = w, ch = h, cx = 0, cy = 0;
  if (w / h > doel) { cw = Math.round(h * doel); cx = Math.floor((w - cw) / 2); }
  else { ch = Math.round(w / doel); cy = Math.floor((h - ch) / 2); }
  const uit = new Uint8Array(BREED * HOOG * 4);
  for (let y = 0; y < HOOG; y++) {
    const y0 = cy + Math.floor(y * ch / HOOG), y1 = Math.max(y0 + 1, cy + Math.floor((y + 1) * ch / HOOG));
    for (let x = 0; x < BREED; x++) {
      const x0 = cx + Math.floor(x * cw / BREED), x1 = Math.max(x0 + 1, cx + Math.floor((x + 1) * cw / BREED));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * w + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; }
      }
      const o = (y * BREED + x) * 4;
      uit[o] = r / n; uit[o + 1] = g / n; uit[o + 2] = b / n; uit[o + 3] = 255;
    }
  }
  return uit;
}

Deno.serve(async (req) => {
  const sleutel = Deno.env.get("STORY_MINI_SLEUTEL");
  if (!sleutel || req.headers.get("x-sleutel") !== sleutel) {
    return new Response("Geen toegang", { status: 401 });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: lijst, error } = await sb.rpc("ig_mini_todo", { aantal: PER_KEER });
  if (error) return Response.json({ fout: "ig_mini_todo: " + error.message }, { status: 500 });

  const uitkomst: Record<string, unknown>[] = [];
  for (const s of lijst ?? []) {
    let rij: Record<string, unknown>;
    try {
      const r = await fetch(s.plaatje, { headers: { accept: "image/jpeg,image/png;q=0.9,*/*;q=0.5" } });
      if (!r.ok) throw new Error(`plaatje ophalen lukte nie (${r.status})`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("geen JPEG (" + (r.headers.get("content-type") ?? "?") + ")");
      const bron = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
      const klein = verklein(bron.data, bron.width, bron.height);
      const jpg = new Uint8Array(jpeg.encode({ data: klein, width: BREED, height: HOOG }, KWALITEIT).data);
      rij = { media_id: s.media_id, mini: "data:image/jpeg;base64," + base64(jpg), bytes: jpg.length, fout: null };
      uitkomst.push({ id: s.media_id, bytes: jpg.length });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 200);
      rij = { media_id: s.media_id, mini: null, bytes: null, fout: msg };
      uitkomst.push({ id: s.media_id, fout: msg });
    }
    const { error: e2 } = await sb.from("ig_story_mini")
      .upsert({ ...rij, pogingen: (s.pogingen ?? 0) + 1, gemaakt_om: new Date().toISOString() });
    if (e2) uitkomst.push({ id: s.media_id, opslaan: e2.message });
  }
  return Response.json({ gedaan: uitkomst });
});
