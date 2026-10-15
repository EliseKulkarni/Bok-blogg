import fs from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

// Delingsbilder (Open Graph, 1200×630) som tegnes ved bygg — ingen ekstern tjeneste.
// Vises når en anmeldelse deles på f.eks. Messenger, Slack eller LinkedIn.

const require = createRequire(import.meta.url);
const font = (file: string) =>
  fs.readFileSync(require.resolve(`@fontsource/newsreader/files/${file}`));

const fonts = [
  { name: "Newsreader", data: font("newsreader-latin-400-normal.woff"), weight: 400 as const, style: "normal" as const },
  { name: "Newsreader", data: font("newsreader-latin-400-italic.woff"), weight: 400 as const, style: "italic" as const },
  { name: "Newsreader", data: font("newsreader-latin-600-normal.woff"), weight: 600 as const, style: "normal" as const },
];

const PAPER = "#f7f7f4";
const INK = "#161614";
const INK_2 = "#5d5d57";
const ACCENT = "#1e5a3f";

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

/** Henter omslaget og bygger det inn som data-URL. Bruker større Open Library-variant når det finnes. */
async function loadCover(url: string | null): Promise<string | null> {
  if (!url) return null;
  const big = url.replace(/-M\.jpg$/, "-L.jpg");
  for (const candidate of big === url ? [url] : [big, url]) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      if (!type.startsWith("image/")) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) continue; // Open Library gir et 1×1-bilde når omslaget mangler
      return `data:${type};base64,${buf.toString("base64")}`;
    } catch {
      // prøv neste / fall tilbake til omslag uten bilde
    }
  }
  return null;
}

async function toPng(tree: Node): Promise<Buffer> {
  const svg = await satori(tree as any, { width: 1200, height: 630, fonts });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

const footer = (text: string) =>
  h("div", { display: "flex", alignItems: "center", gap: 16, fontSize: 26, color: INK_2 }, [
    h("div", { width: 18, height: 18, background: ACCENT }),
    h("div", {}, text),
  ]);

export async function bookImage(book: {
  title: string;
  headline: string | null;
  author: string | null;
  rating: number | null;
  coverUrl: string | null;
}): Promise<Buffer> {
  const cover = await loadCover(book.coverUrl);
  const heading = book.headline ?? book.title;
  const headingSize = heading.length > 48 ? 54 : heading.length > 30 ? 64 : 76;

  const coverNode = cover
    ? h("img", { width: 340, height: 510, objectFit: "cover" }, undefined, { src: cover, width: 340, height: 510 })
    : h("div", { width: 340, height: 510, background: ACCENT, color: PAPER, display: "flex", alignItems: "flex-end", padding: 28, fontSize: 40, fontWeight: 600, lineHeight: 1.1 }, book.title);

  return toPng(
    h("div", { width: 1200, height: 630, display: "flex", background: PAPER, color: INK, fontFamily: "Newsreader", padding: 60, gap: 64 }, [
      coverNode,
      // Faste mål: satori bryter ikke tekst riktig uten eksplisitt bredde/høyde.
      h("div", { display: "flex", flexDirection: "column", justifyContent: "space-between", width: 676, height: 510, paddingTop: 6 }, [
        h("div", { display: "flex", flexDirection: "column", gap: 24 }, [
          h("div", { fontSize: headingSize, fontWeight: 600, lineHeight: 1.05, letterSpacing: -1.5 }, heading),
          h("div", { display: "flex", flexWrap: "wrap", fontSize: 32, color: INK }, [
            h("span", { fontStyle: "italic" }, book.title),
            book.author ? h("span", { whiteSpace: "pre" }, ` av ${book.author}`) : null,
          ].filter(Boolean)),
        ]),
        h("div", { display: "flex", justifyContent: "space-between", alignItems: "flex-end" }, [
          footer("Bokblogg"),
          book.rating !== null
            ? h("div", { display: "flex", alignItems: "baseline", fontSize: 30, color: INK_2 }, [
                h("span", { fontSize: 88, fontWeight: 600, color: INK, lineHeight: 1 }, String(book.rating)),
                h("span", {}, "/10"),
              ])
            : null,
        ].filter(Boolean)),
      ]),
    ])
  );
}

export async function siteImage(covers: (string | null)[]): Promise<Buffer> {
  const loaded = (await Promise.all(covers.slice(0, 3).map(loadCover))).filter((c): c is string => Boolean(c));
  return toPng(
    h("div", { width: 1200, height: 630, display: "flex", background: PAPER, color: INK, fontFamily: "Newsreader", padding: 64, gap: 48 }, [
      h("div", { display: "flex", flexDirection: "column", justifyContent: "space-between", width: 540, height: 502 }, [
        h("div", { display: "flex", flexDirection: "column", gap: 24 }, [
          h("div", { fontSize: 84, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }, "Bokblogg"),
          h("div", { fontSize: 34, lineHeight: 1.3 }, "Korte, ærlige anmeldelser av bøker om læring, vaner og selvinnsikt."),
        ]),
        footer("elisekulkarni.github.io/Bok-blogg"),
      ]),
      h("div", { display: "flex", gap: 24, alignItems: "center", width: 484, height: 502 }, loaded.map((src, i) =>
        h("img", { width: 145, height: 218, objectFit: "cover", marginTop: i % 2 ? 70 : -70 }, undefined, { src, width: 145, height: 218 })
      )),
    ])
  );
}
