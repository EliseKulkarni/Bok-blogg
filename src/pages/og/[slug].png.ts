import type { APIRoute, GetStaticPaths } from "astro";
import { getBooks, type Book } from "../../lib/books";
import { bookImage } from "../../lib/og";

export const getStaticPaths: GetStaticPaths = async () =>
  (await getBooks()).map((book) => ({ params: { slug: book.id }, props: { book } }));

export const GET: APIRoute = async ({ props }) => {
  const { title, headline, author, rating, coverUrl } = (props.book as Book).data;
  const png = await bookImage({ title, headline, author, rating, coverUrl });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
};
