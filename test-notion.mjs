// Engangs-testscript for Fase 1 — verifiserer at NOTION_TOKEN faktisk får ut data.
// Kjøres med: node --env-file=.env test-notion.mjs
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const res = await notion.dataSources.query({
  data_source_id: process.env.NOTION_DATA_SOURCE_ID,
  page_size: 5,
});

console.log(`Fikk ${res.results.length} rad(er):\n`);
for (const page of res.results) {
  const props = page.properties;
  console.log({
    id: page.id,
    tittel: props.Name?.title?.[0]?.plain_text,
    rating: props["Rating 1-10"]?.number,
    status: props["Om fullført"]?.status?.name,
  });
}
