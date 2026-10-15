import rss from "@astrojs/rss";
import { getBooks } from "../lib/books";

export async function GET(context) {
  const books = await getBooks();
  const base = import.meta.env.BASE_URL;

  return rss({
    title: "Elise sin bokblogg",
    description: "Korte, ærlige bokanmeldelser — automatisk hentet fra Notion.",
    site: new URL(base, context.site).href,
    customData: "<language>no</language>",
    items: books.map((book) => {
      const { title, headline, author, rating, essensen, teaser, tags, dateAdded } = book.data;
      const byline = [author && `${title} av ${author}`, rating !== null && `★ ${rating}/10`].filter(Boolean).join(" · ");
      const summary = essensen ?? teaser ?? `Anmeldelse av ${title}`;
      return {
        title: headline ?? title,
        description: byline ? `${byline}. ${summary}` : summary,
        pubDate: dateAdded,
        link: `${base}bok/${book.id}/`,
        categories: tags,
      };
    }),
  });
}
