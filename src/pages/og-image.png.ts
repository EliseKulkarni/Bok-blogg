import type { APIRoute } from "astro";
import { getBooks } from "../lib/books";
import { siteImage } from "../lib/og";

export const GET: APIRoute = async () => {
  const books = await getBooks();
  const png = await siteImage(books.map((b) => b.data.coverUrl));
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
};
