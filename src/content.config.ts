import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const books = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/books" }),
  schema: z.object({
    title: z.string(),
    author: z.string().nullable(),
    rating: z.number().nullable(),
    status: z.string(),
    tags: z.array(z.string()),
    coverUrl: z.string().nullable(),
    essensen: z.string().nullable(),
    dateAdded: z.coerce.date(),
    notionId: z.string(),
  }),
});

export const collections = { books };
