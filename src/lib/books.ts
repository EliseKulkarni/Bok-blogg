import { getCollection, type CollectionEntry } from "astro:content";

export type Book = CollectionEntry<"books">;

/** Alle bøker, nyeste først. */
export async function getBooks(): Promise<Book[]> {
  return (await getCollection("books")).sort(
    (a, b) => b.data.dateAdded.valueOf() - a.data.dateAdded.valueOf()
  );
}

/** Tags sortert etter hvor mange bøker som har dem (flest først), deretter alfabetisk. */
export function tagCounts(books: Book[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of books) for (const t of b.data.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "no"));
}

/** Bøker som deler flest tags med `book` (uten boken selv). */
export function relatedBooks(book: Book, books: Book[], limit = 3): Book[] {
  const mine = new Set(book.data.tags);
  return books
    .filter((b) => b.id !== book.id)
    .map((b) => ({ b, shared: b.data.tags.filter((t) => mine.has(t)).length }))
    .filter(({ shared }) => shared > 0)
    .sort((x, y) => y.shared - x.shared || (y.b.data.rating ?? 0) - (x.b.data.rating ?? 0))
    .slice(0, limit)
    .map(({ b }) => b);
}

/** Omtrentlig lesetid i minutter (ca. 220 ord i minuttet). */
export function readingMinutes(markdown: string | undefined): number {
  const words = (markdown ?? "").replace(/[#*_`>\[\]()!-]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export const dateFormatter = new Intl.DateTimeFormat("no-NO", { day: "numeric", month: "short", year: "numeric" });

export const displayTitle = (book: Book) => book.data.headline ?? book.data.title;
