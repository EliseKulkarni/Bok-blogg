# bokblogg

Statisk bokblogg som henter bokanmeldelser fra Notion og bygger seg selv automatisk hver dag.

Live: https://elisekulkarni.github.io/Bok-blogg/

## Stack

- Astro + TypeScript for selve siden
- Notion som CMS (via `@notionhq/client` og `notion-to-md`) — ingen database, ingen egen backend
- Open Library API for å slå opp forfatter og sjanger ut fra boktittel
- GitHub Actions bygger siden på schedule, GitHub Pages hoster den

## Slik henger det sammen

1. Du skriver en anmeldelse i Notion og setter status til `Ja` (ferdig) eller `80%` (nesten ferdig, oppsummering skrevet).
2. Hver dag kjører en GitHub Action (`.github/workflows/build-and-deploy.yml`) som henter alle bøker med den statusen, slår opp forfatter/sjanger på Open Library, gjør om anmeldelsen til markdown, bygger siden med Astro, og publiserer til GitHub Pages. Du kan også trigge den manuelt fra Actions-fanen.
3. `data/books-cache.json` og `data/openlibrary-cache.json` blir committet tilbake til repoet av Action-en selv. Det gjør at neste kjøring bare trenger å behandle bøker som faktisk har endret seg i Notion, i stedet for å gjøre alt arbeidet på nytt hver gang.
4. Hvis du legger inn en `ANTHROPIC_API_KEY`, blir teaser-teksten på forsiden generert av Claude i stedet for en enkel 200-tegns fallback av starten på anmeldelsen.

## Kjøre lokalt

Krever Node.js (LTS eller nyere).

```bash
npm install
```

Kopier `.env.example` til `.env` og legg inn din egen Notion-integrasjonstoken:

```
NOTION_TOKEN=ntn_...
NOTION_DATA_SOURCE_ID=29c9ef86-0d22-80e5-ab67-000b2fa83c62
```

Hent bøker fra Notion og generer innhold:

```bash
npm run fetch:books
```

Start dev-server:

```bash
npm run dev
```

Bygg produksjonsversjon og se på den lokalt:

```bash
npm run build
npm run preview
```

## Secrets i GitHub Actions

Under repoets Settings → Secrets and variables → Actions:

- Secrets-fanen → New repository secret → `NOTION_TOKEN` (samme token som lokalt i `.env`)
- Variables-fanen → New repository variable → `NOTION_DATA_SOURCE_ID` = `29c9ef86-0d22-80e5-ab67-000b2fa83c62` (ikke hemmelig, brukes bare som variabel)

Valgfritt: legg til `ANTHROPIC_API_KEY` som secret hvis du vil ha ekte teasere generert av Claude i stedet for fallback-teksten.

Under Settings → Pages: sett Source til "GitHub Actions" (ikke "Deploy from a branch").

## Legge til flere bøker

Ingenting å gjøre i koden — skriv anmeldelsen i Notion og sett status til `Ja` eller `80%`. Siden oppdaterer seg selv innen 24 timer, eller med en gang hvis du trigger workflowen manuelt.
