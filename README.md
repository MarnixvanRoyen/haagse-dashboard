# Haagse Content Performance Dashboard

Eén Haags dashboard voor de performance van @the_hague_beachlife: muziek (Marreman Rojas & Beuk), Insta en apps (Haagse Sneek).
Live: https://marnixvanroyen.github.io/haagse-dashboard/

- **Voorkant** (deze map): een gewone webpagina, gehost op GitHub Pages.
- **Data**: in Supabase (het project van Sneek). Je moet inloggen om iets te zien.

## Wat zit waar

| Bestand | Wat het doet |
|---|---|
| `index.html` | Het skelet: inlogscherm, kop, tabbladen en de lege vakken |
| `stijl.css` | Alle opmaak in de Haagse huisstijl (zee-blauw, geel, groen) |
| `fonts/` | Titan One + Nunito, zelf gehost (geen Google) + licenties |
| `js/basis.js` | Gedeelde hulpjes: bedragen/datums opmaken, tooltip, meldingen |
| `js/muziek.js` | Alles van de muziek: SoundCloud, DJ·World, YouTube, Spotify |
| `js/start.js` | Verbinding met Supabase, data ophalen, inloggen (laadt als laatste) |
| `config.js` | Adres en publieke sleutel van het Supabase-project |
| `supabase/*.sql` | Tabellen, beveiliging en functies (archief; SQL gaat via de chat) |
| `.gitignore` | Zorgt dat CSV- en PDF-bestanden nooit op GitHub komen |

## Eenmalig instellen

### 1. Supabase
1. Maak op supabase.com een nieuw project aan (regio: West EU / Frankfurt of Ierland).
2. Ga naar **SQL Editor** → **New query**, plak de inhoud van `supabase/01_schema.sql` en klik **Run**.
3. Ga naar **Authentication → Users → Add user → Create new user**. Vul je e-mail en een wachtwoord in en vink **Auto Confirm User** aan.
4. Ga naar **Authentication → Sign In / Providers** en zet **Allow new users to sign up** uit. Dan kan niemand anders een account maken.
5. Ga naar **Project Settings → Data API** (Project URL) en **API Keys** (publishable key). Zet die twee in `config.js`.

### 2. GitHub
```bash
cd ~/Documents/"Haagse Content"/haagse-dashboard
git init
git add .
git commit -m "Eerste versie muziekinkomsten"
git branch -M main
git remote add origin https://github.com/marnixvanroyen/muziekinkomsten.git
git push -u origin main
```
Maak eerst op github.com een lege repository `muziekinkomsten` aan (zonder README).
Vraagt Git om een wachtwoord? Plak dan je Personal Access Token.

### 3. GitHub Pages
Repository → **Settings → Pages** → Source: **Deploy from a branch** → Branch `main`, map `/ (root)` → **Save**.
Na een minuutje staat de app op `https://marnixvanroyen.github.io/muziekinkomsten/`.

## Gebruik
- **Inloggen** met het account uit stap 1.3.
- **Nieuw SoundCloud-rapport**: klik op *SoundCloud-CSV*. De app vervangt de regels van dezelfde afrekenperiodes. Hetzelfde rapport twee keer inladen geeft dus geen dubbele bedragen.
- **Nieuw DJ·World-totaaloverzicht** (PDF met streams per nummer): klik op *Label-PDF*. De app leest de PDF en vervangt de label-data door de nieuwste stand.

## Veiligheid in het kort
- De publishable key in `config.js` mag openbaar zijn. Zonder inloggen geeft de database niets terug (Row Level Security).
- Je echte bestanden (CSV/PDF) staan in `.gitignore` en komen dus niet op GitHub.

## Code bijwerken
```bash
git add .
git commit -m "Wat je veranderd hebt"
git push
```
