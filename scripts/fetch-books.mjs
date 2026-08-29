import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { lookupBook, flushOpenLibraryCache } from "./lib/openlibrary.mjs";
import { getTeaser, flushTeaserCache } from "./lib/teaser.mjs";
import { slugify } from "./lib/slug.mjs";

const CACHE_PATH = fileURLToPath(new URL("../data/books-cache.json", import.meta.url));
const CONTENT_DIR = fileURLToPath(new URL("../src/content/books/", import.meta.url));
const IMAGES_DIR = fileURLToPath(new URL("../public/book-images/", import.meta.url));
const OVERRIDES_PATH = fileURLToPath(new URL("../data/overrides.json", import.meta.url));
const PUBLISHED_STATUSES = ["Ja", "80%"];

// Manuelle overstyringer per Notion-side-ID (se data/overrides.json). Brukes når
// Open Library bommer på omslag/forfatter/tags. Felt som er satt vinner over det
// automatiske oppslaget; felt som mangler røres ikke.
function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf-8"));
  } catch {
    return {};
  }
}

// Må matche `base` i astro.config.mjs — bilder i public/ serveres under denne stien.
const SITE_BASE = "/Bok-blogg/";

// Markdown-bilder som fortsatt peker på en ekstern http(s)-adresse (typisk Notions
// midlertidige S3-lenker, som utløper etter 1 time). Ny RegExp per kall — en delt
// global regex tar med seg lastIndex mellom kall og gir da falske ikke-treff.
const remoteImageRe = () => /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;

function hasRemoteImage(markdown) {
  return remoteImageRe().test(markdown);
}

// Laster ned eksterne bilder til public/book-images/ og bytter ut lenken med en
// lokal, permanent sti. Notion gir opplastede bilder en signert S3-URL som slutter
// å virke etter en time; uten dette vises bare alt-teksten ("image.png") på siden.
async function localizeImages(markdown, pageId) {
  const matches = [...markdown.matchAll(remoteImageRe())];
  if (matches.length === 0) return markdown;

  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  let result = markdown;

  for (const [full, alt, url] of matches) {
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      continue;
    }
    // Hash av stien (uten query) gir et stabilt filnavn på tvers av kjøringer,
    // selv om den signerte query-strengen endrer seg hver gang.
    const hash = crypto.createHash("sha1").update(pathname).digest("hex").slice(0, 10);
    const ext = (path.extname(pathname) || ".png").toLowerCase();
    const filename = `${pageId}-${hash}${ext}`;
    const filepath = path.join(IMAGES_DIR, filename);

    if (!fs.existsSync(filepath)) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(filepath, Buffer.from(await res.arrayBuffer()));
        console.log(`[fetch-books] Lastet ned bilde ${filename}`);
      } catch (err) {
        console.warn(`[fetch-books] Klarte ikke laste ned bilde (${url.slice(0, 80)}…): ${err.message}`);
        continue;
      }
    }

    // Notion gir opplastede bilder alt-teksten "image.png" o.l. — lite nyttig, og
    // stygt hvis bildet en dag ikke laster. Dropp den generiske teksten.
    const cleanAlt = /^(image|img|bilde)\.\w+$/i.test(alt.trim()) ? "" : alt;
    result = result.split(full).join(`![${cleanAlt}](${SITE_BASE}book-images/${filename})`);
  }

  return result;
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

async function queryPublishedBooks(notion, dataSourceId) {
  const results = [];
  let cursor = undefined;
  do {
    const res = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      filter: {
        or: PUBLISHED_STATUSES.map((s) => ({ property: "Om fullført", status: { equals: s } })),
      },
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

function frontmatterValue(value) {
  return JSON.stringify(value);
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || !dataSourceId) {
    console.error("Mangler NOTION_TOKEN eller NOTION_DATA_SOURCE_ID (sjekk .env).");
    process.exit(1);
  }

  const notion = new Client({ auth: token });
  const n2m = new NotionToMarkdown({ notionClient: notion });
  const overrides = loadOverrides();

  let pages;
  try {
    pages = await queryPublishedBooks(notion, dataSourceId);
  } catch (err) {
    console.error(`Klarte ikke hente fra Notion: ${err.message}`);
    process.exit(1);
  }

  const cache = loadCache();
  const seenIds = new Set();
  const books = [];

  for (const page of pages) {
    const props = page.properties;
    const title = props.Name?.title?.[0]?.plain_text;
    if (!title) {
      console.warn(`[fetch-books] Hopper over side ${page.id} — mangler tittel.`);
      continue;
    }

    seenIds.add(page.id);
    const lastEditedTime = page.last_edited_time;
    const cached = cache[page.id];

    // Regn innholdet som endret hvis den cachede versjonen fortsatt har en ekstern
    // bildelenke — da må vi hente på nytt fra Notion for å få en fersk, gyldig URL
    // vi rekker å laste ned før den utløper.
    const contentUnchanged =
      cached && cached.lastEditedTime === lastEditedTime && !hasRemoteImage(cached.markdown);

    let markdown;
    if (contentUnchanged) {
      markdown = cached.markdown;
    } else {
      try {
        const mdBlocks = await n2m.pageToMarkdown(page.id);
        ({ parent: markdown } = n2m.toMarkdownString(mdBlocks));
      } catch (err) {
        console.warn(`[fetch-books] Markdown-konvertering feilet for "${title}": ${err.message}`);
        if (cached) {
          console.warn(`[fetch-books] Bruker forrige cachede versjon av "${title}".`);
          markdown = cached.markdown;
        } else {
          console.warn(`[fetch-books] Ingen tidligere versjon å falle tilbake på — hopper over "${title}".`);
          continue;
        }
      }
    }

    // Last ned nyhentede Notion-bilder til repoet før de utløper. Cachet innhold er
    // allerede lokalisert fra en tidligere kjøring.
    if (!contentUnchanged) {
      markdown = await localizeImages(markdown, page.id);
    }

    const manualAuthor = (props.Author?.rich_text ?? []).map((t) => t.plain_text).join("") || null;

    // Kjør Open Library-oppslag på nytt hvis innholdet endret seg, det manuelle forfatterfeltet
    // endret seg, eller forrige oppslag var en nettverksfeil (ikke et bekreftet "fant ingenting").
    let author, tags, coverUrl;
    if (contentUnchanged && cached.resolved && cached.manualAuthor === manualAuthor) {
      ({ author, tags, coverUrl = null } = cached);
    } else {
      const lookup = await lookupBook(title, manualAuthor);
      author = lookup.author;
      tags = lookup.tags;
      coverUrl = lookup.coverUrl;
      cache[page.id] = { lastEditedTime, markdown, author, tags, coverUrl, resolved: lookup.resolved, manualAuthor };
    }

    // Manuelle overstyringer vinner over Open Library-oppslaget.
    const override = overrides[page.id];
    if (override) {
      if (override.author !== undefined) author = override.author;
      if (override.tags !== undefined) tags = override.tags;
      if (override.coverUrl !== undefined) coverUrl = override.coverUrl;
    }

    const teaser = await getTeaser(markdown);

    books.push({
      id: page.id,
      title,
      slug: slugify(title),
      rating: props["Rating 1-10"]?.number ?? null,
      status: props["Om fullført"]?.status?.name ?? null,
      essensen: (props.Essensen?.rich_text ?? []).map((t) => t.plain_text).join("") || null,
      dateAdded: page.created_time,
      author,
      tags,
      coverUrl,
      teaser,
      markdown,
    });
  }

  // Fjern cache-oppføringer for bøker som ikke lenger er publisert
  for (const id of Object.keys(cache)) {
    if (!seenIds.has(id)) delete cache[id];
  }
  saveCache(cache);
  flushOpenLibraryCache();
  flushTeaserCache();

  // Gjør slugs unike innad i denne kjøringen
  const slugCounts = new Map();
  for (const book of books) {
    const count = slugCounts.get(book.slug) ?? 0;
    slugCounts.set(book.slug, count + 1);
    if (count > 0) book.slug = `${book.slug}-${count + 1}`;
  }

  // Regenerer src/content/books/ fra bunnen av — garanterer at fjernede bøker forsvinner
  fs.rmSync(CONTENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(CONTENT_DIR, { recursive: true });

  for (const book of books) {
    const frontmatter = [
      "---",
      `title: ${frontmatterValue(book.title)}`,
      `author: ${frontmatterValue(book.author)}`,
      `rating: ${book.rating ?? "null"}`,
      `status: ${frontmatterValue(book.status)}`,
      `tags: ${JSON.stringify(book.tags)}`,
      `coverUrl: ${frontmatterValue(book.coverUrl)}`,
      `teaser: ${frontmatterValue(book.teaser)}`,
      `essensen: ${frontmatterValue(book.essensen)}`,
      `dateAdded: ${frontmatterValue(book.dateAdded)}`,
      `notionId: ${frontmatterValue(book.id)}`,
      "---",
      "",
    ].join("\n");

    fs.writeFileSync(path.join(CONTENT_DIR, `${book.slug}.md`), frontmatter + book.markdown);
  }

  console.log(`\nHentet ${books.length} bok(er):\n`);
  for (const book of books) {
    console.log(`- ${book.title} (${book.status}) — forfatter: ${book.author ?? "ukjent"}, tags: [${book.tags.join(", ")}]`);
  }
}

main();
