import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const CACHE_PATH = fileURLToPath(new URL("../../data/teaser-cache.json", import.meta.url));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function fallbackTeaser(markdown) {
  const plain = markdown.replace(/[#*_`>[\]()-]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 200 ? plain.slice(0, 200) + "…" : plain;
}

async function callClaude(markdown, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Skriv en kort, fengende teaser (maks to setninger, på norsk) for denne bokanmeldelsen. Ikke avslør konklusjonen. Svar kun med teaseren, ingen anførselstegn eller forklaring:\n\n${markdown.slice(0, 3000)}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API svarte ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || fallbackTeaser(markdown);
}

const cache = loadCache();
let cacheDirty = false;

export async function getTeaser(markdown) {
  const hash = hashText(markdown);
  if (cache[hash]) return cache[hash];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Ingen nøkkel ennå — bruk enkel fallback uten å cache den permanent, slik at ekte
    // teasere genereres automatisk for alle bøker så snart nøkkelen legges til.
    return fallbackTeaser(markdown);
  }

  try {
    const teaser = await callClaude(markdown, apiKey);
    cache[hash] = teaser;
    cacheDirty = true;
    return teaser;
  } catch (err) {
    console.warn(`[teaser] Klarte ikke generere teaser: ${err.message} — bruker fallback.`);
    return fallbackTeaser(markdown);
  }
}

export function flushTeaserCache() {
  if (cacheDirty) saveCache(cache);
}
