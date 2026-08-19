import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { lookupBook, flushOpenLibraryCache } from "./lib/openlibrary.mjs";
import { slugify } from "./lib/slug.mjs";

const CACHE_PATH = fileURLToPath(new URL("../data/books-cache.json", import.meta.url));
const CONTENT_DIR = fileURLToPath(new URL("../src/content/books/", import.meta.url));
const PUBLISHED_STATUSES = ["Ja", "80%"];

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

    const contentUnchanged = cached && cached.lastEditedTime === lastEditedTime;

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

    // Kjør Open Library-oppslag på nytt hvis innholdet endret seg, eller forrige
    // oppslag var en nettverksfeil (ikke et bekreftet "fant ingenting").
    let author, tags, coverUrl;
    if (contentUnchanged && cached.resolved) {
      ({ author, tags, coverUrl = null } = cached);
    } else {
      const lookup = await lookupBook(title);
      author = lookup.author;
      tags = lookup.tags;
      coverUrl = lookup.coverUrl;
      cache[page.id] = { lastEditedTime, markdown, author, tags, coverUrl, resolved: lookup.resolved };
    }

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
      markdown,
    });
  }

  // Fjern cache-oppføringer for bøker som ikke lenger er publisert
  for (const id of Object.keys(cache)) {
    if (!seenIds.has(id)) delete cache[id];
  }
  saveCache(cache);
  flushOpenLibraryCache();

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
