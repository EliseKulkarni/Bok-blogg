import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const books = (await getCollection("books")).sort(
    (a, b) => b.data.dateAdded.valueOf() - a.data.dateAdded.valueOf()
  );

  const base = import.meta.env.BASE_URL;

  return rss({
    title: "Elise sin bokblogg",
    description: "Korte, ærlige bokanmeldelser — automatisk hentet fra Notion.",
    site: new URL(base, context.site).href,
    items: books.map((book) => ({
      title: book.data.title,
      description:
        book.data.essensen ??
        book.data.teaser ??
        `Anmeldelse av ${book.data.title}`,
      pubDate: book.data.dateAdded,
      link: `${base}bok/${book.id}/`,
      author: book.data.author ?? undefined,
    })),
  });
}
