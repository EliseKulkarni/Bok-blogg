# bokblogg

Statisk bokblogg som henter bokanmeldelser fra Notion og bygger seg selv på schedule.

Live: https://elisekulkarni.github.io/Bok-blogg/

## Stack

- [Astro](https://astro.build) + TypeScript — statisk site-generator
- Notion som CMS (`@notionhq/client` + `notion-to-md`) — ingen database, ingen backend
- Open Library API — henter forfatter/sjanger automatisk basert på boktittel
- GitHub Actions (bygg på schedule) + GitHub Pages (hosting)

## Hvordan det henger sammen

1. Du skriver en anmeldelse i Notion, markerer boken som `Ja` (ferdig) eller `80%` (nesten ferdig, har skrevet oppsummering)
2. GitHub Actions kjører automatisk hver dag (`.github/workflows/build-and-deploy.yml`), henter alle bøker med den statusen fra Notion, slår opp forfatter/sjanger, konverterer anmeldelsen til markdown, bygger Astro-siden, og publiserer til GitHub Pages
3. `data/books-cache.json` og `data/openlibrary-cache.json` committes automatisk tilbake til repoet av Action-en — dette gjør at neste kjøring bare trenger å reprosessere bøker som faktisk er endret (basert på Notion sin `last_edited_time`), i stedet for å gjøre alt arbeidet på nytt hver gang

## Kjøre lokalt

Krever [Node.js](https://nodejs.org) (LTS eller nyere).

```bash
npm install
```

Lag en `.env`-fil (kopier `.env.example`) med din egen Notion-integrasjonstoken:

```
NOTION_TOKEN=ntn_...
NOTION_DATA_SOURCE_ID=29c9ef86-0d22-80e5-ab67-000b2fa83c62
```

Hent bøker fra Notion og generer innhold:

```bash
npm run fetch:books
```

Start lokal dev-server:

```bash
npm run dev
```

Bygg produksjonsversjon:

```bash
npm run build
npm run preview
```

## Secrets i GitHub Actions

Under repoets **Settings → Secrets and variables → Actions**:

- **Secrets-fanen** → **New repository secret** → `NOTION_TOKEN` = din Notion-integrasjonstoken (hemmelig, samme som i `.env` lokalt)
- **Variables-fanen** → **New repository variable** → `NOTION_DATA_SOURCE_ID` = `29c9ef86-0d22-80e5-ab67-000b2fa83c62` (ikke hemmelig i seg selv — brukes som variabel, ikke secret)

Under **Settings → Pages**: sett **Source** til **GitHub Actions** (ikke "Deploy from a branch").

## Legge til flere bøker

Ingenting — bare skriv anmeldelsen i Notion og sett status til `Ja` eller `80%`. Siden oppdaterer seg selv innen 24 timer, eller umiddelbart hvis du trigger workflowen manuelt fra **Actions**-fanen på GitHub (**Run workflow**-knappen).

## Rette opp tittel, omslag, forfatter eller tags

Open Library gjetter av og til feil (feil utgave av omslaget, rotete tags osv.). Rett det i
`data/overrides.json`, med Notion-sidens ID som nøkkel:

```json
"3e19ef86-0d22-8056-87d1-db101376a8fa": {
  "title": "The Most Important Thing",
  "author": "Howard Marks",
  "headline": "En god idé, sagt ti ganger",
  "coverUrl": "https://covers.openlibrary.org/b/id/10001222-M.jpg",
  "tags": ["Investering", "Risiko"]
}
```

Alle felt er valgfrie — bare de du fyller inn overstyrer. `title` endrer bare hva som vises;
nettadressen (slug-en) bygges fortsatt fra Notion-tittelen, så gamle lenker fortsetter å virke.

Prøv å gjenbruke tags som allerede finnes (se `/tag/` på siden), så samles bøker om samme tema.
