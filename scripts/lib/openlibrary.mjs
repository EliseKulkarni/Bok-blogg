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

async function searchOpenLibrary(title, author) {
  // Kjenner vi forfatteren allerede (fra "Tittel by Forfatter"-mønsteret), bruk den til å
  // disambiguere søket — ellers matcher vi lett feil bok når flere bøker deler tittel.
  const authorParam = author ? `&author=${encodeURIComponent(author)}` : "";
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}${authorParam}&limit=1&fields=author_name,subject,cover_i`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Library svarte ${res.status} for "${title}"`);
  const data = await res.json();
  const doc = data.docs?.[0];
  return {
    author: doc?.author_name?.[0] ?? null,
    tags: cleanSubjects(doc?.subject ?? []),
    coverUrl: doc?.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
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

// knownAuthor: forfatter fra Notion sitt eget Author-felt (manuelt utfylt) — mest pålitelig
// kilde vi har, brukes både i selve søket (for riktig omslag/tags) og som endelig svar.
export async function lookupBook(rawTitle, knownAuthor = null) {
  const { title: cleanTitle, author: inlineAuthor } = splitTitleAuthor(rawTitle);
  const trustedAuthor = knownAuthor || inlineAuthor;
  const cacheKey = trustedAuthor ? `${cleanTitle.toLowerCase()}|${trustedAuthor.toLowerCase()}` : cleanTitle.toLowerCase();

  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    return {
      title: cleanTitle,
      author: trustedAuthor ?? cached.author,
      tags: cached.tags,
      coverUrl: cached.coverUrl ?? null,
      resolved: true,
    };
  }

  let result;
  let resolved;
  try {
    result = await searchOpenLibrary(cleanTitle, trustedAuthor);
    cache[cacheKey] = result;
    cacheDirty = true;
    resolved = true;
  } catch (err) {
    console.warn(`[openlibrary] Oppslag feilet for "${cleanTitle}": ${err.message} — prøver på nytt neste kjøring.`);
    result = { author: null, tags: [], coverUrl: null };
    resolved = false;
  }

  return {
    title: cleanTitle,
    author: trustedAuthor ?? result.author,
    tags: result.tags,
    coverUrl: result.coverUrl,
    resolved,
  };
}

export function flushOpenLibraryCache() {
  if (cacheDirty) saveCache(cache);
}
