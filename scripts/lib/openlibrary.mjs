import fs from "node:fs";

const CACHE_PATH = new URL("../../data/openlibrary-cache.json", import.meta.url);

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(new URL("../../data", import.meta.url), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

// Notion-titler inneholder noen ganger forfatter direkte, f.eks. "The Charisma Myth by Olivia Fox".
// Splitt ut det før vi i det hele tatt spør Open Library, det er mer presist enn søk.
function splitTitleAuthor(rawTitle) {
  const match = rawTitle.match(/^(.*?)\s+by\s+(.+)$/i);
  if (match) return { title: match[1].trim(), author: match[2].trim() };
  return { title: rawTitle.trim(), author: null };
}

async function searchOpenLibrary(title) {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1&fields=author_name,subject`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Library svarte ${res.status} for "${title}"`);
  const data = await res.json();
  const doc = data.docs?.[0];
  return {
    author: doc?.author_name?.[0] ?? null,
    tags: cleanSubjects(doc?.subject ?? []),
  };
}

// Open Library sine "subjects" er brukergenererte og inneholder mye internt rot
// (nyt:..., open_syllabus_project, osv.) — filtrer bort det som ikke ser ut som ekte kategorier.
function cleanSubjects(subjects) {
  return subjects
    .filter((s) => !s.includes(":") && !/^[a-z0-9_]+$/.test(s))
    .slice(0, 3);
}

const cache = loadCache();
let cacheDirty = false;

export async function lookupBook(rawTitle) {
  const { title: cleanTitle, author: inlineAuthor } = splitTitleAuthor(rawTitle);
  const cacheKey = cleanTitle.toLowerCase();

  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    return { title: cleanTitle, author: inlineAuthor ?? cached.author, tags: cached.tags };
  }

  let result = { author: null, tags: [] };
  try {
    result = await searchOpenLibrary(cleanTitle);
  } catch (err) {
    console.warn(`[openlibrary] Oppslag feilet for "${cleanTitle}": ${err.message} — fortsetter uten forfatter/tags.`);
  }

  cache[cacheKey] = result;
  cacheDirty = true;

  return { title: cleanTitle, author: inlineAuthor ?? result.author, tags: result.tags };
}

export function flushOpenLibraryCache() {
  if (cacheDirty) saveCache(cache);
}
