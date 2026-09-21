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

async function fetchDocs(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Library svarte ${res.status}`);
  const data = await res.json();
  return data.docs ?? [];
}

function docToResult(doc) {
  return {
    author: doc?.author_name?.[0] ?? null,
    tags: cleanSubjects(doc?.subject ?? []),
    coverUrl: doc?.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
  };
}

// Gjør forfatternavn sammenlignbare uavhengig av ordrekkefølge og "-s" i enden — fanger opp
// vanlige skrivefeil som "Mark Howards" i stedet for "Howard Marks" når noen fyller inn
// Author-feltet i Notion for hånd.
function normalizeAuthorName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-zæøå\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/s$/, ""))
    .sort()
    .join(" ");
}

function authorsMatch(a, b) {
  return Boolean(a) && Boolean(b) && normalizeAuthorName(a) === normalizeAuthorName(b);
}

async function searchOpenLibrary(title, author) {
  const fields = "fields=author_name,subject,cover_i";

  if (author) {
    // Første forsøk: la Open Library selv filtrere på forfatter — raskt og presist når
    // navnet står skrevet nøyaktig slik Open Library har det.
    const exactUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=1&${fields}`;
    const [exact] = await fetchDocs(exactUrl);
    if (exact) return docToResult(exact);

    // Forfatterfilteret ga null treff — kan skyldes en skrivefeil (f.eks. navn i feil
    // rekkefølge). Prøv på nytt uten filter, og se om et av de øverste tittel-treffene har
    // et forfatternavn som minner om det vi har, før vi gir opp.
    const looseUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=10&${fields}`;
    const candidates = await fetchDocs(looseUrl);
    const match = candidates.find((doc) => (doc.author_name ?? []).some((n) => authorsMatch(n, author)));
    // Ingen kandidat matchet forfatteren — heller ingen omslag enn feil omslag fra en annen bok.
    return docToResult(match);
  }

  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1&${fields}`;
  const [doc] = await fetchDocs(url);
  return docToResult(doc);
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
    resolved = true;
    // Ikke cache et rent bomtreff (verken omslag, tags eller forfatter funnet) — ellers sitter vi
    // fast med "fant ingenting" for alltid. Skriv bare til cachen når søket faktisk ga noe å vise.
    if (result.coverUrl || result.tags.length > 0 || result.author) {
      cache[cacheKey] = result;
      cacheDirty = true;
    }
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
