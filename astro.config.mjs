import { defineConfig } from "astro/config";

import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://elisekulkarni.github.io",
  base: "/Bok-blogg/",
  integrations: [sitemap()],
});