/**
 * Regenerates apps/web/public/fonts/ — self-hosted woff2 + fonts.css.
 *
 * We self-host rather than linking Google Fonts so the Docker image has no
 * third-party render-blocking request. Only the latin / latin-ext subsets are
 * kept; the unicode-range rules mean a browser fetches ~130KB in practice.
 *
 *   node scripts/fetch-fonts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/public/fonts");
const CSS_OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/src/fonts.css");
const KEEP = new Set(["latin", "latin-ext"]);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const HREF =
  "https://fonts.googleapis.com/css2" +
  "?family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..600" +
  "&family=IBM+Plex+Mono:wght@400;500&display=swap";

const HEADER = `/* Self-hosted webfonts for Knot.ai. Latin + latin-ext subsets only.
   Source Serif 4 = speech (transcript, prose, quotes, display).
   IBM Plex Mono  = measurement (state, counters, verdicts, controls).
   Regenerate with scripts/fetch-fonts.mjs. */
`;

const css = await fetch(HREF, { headers: { "User-Agent": UA } }).then((r) => r.text());
const blocks = [...css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/gi)];

fs.mkdirSync(OUT, { recursive: true });
const parts = [HEADER];

for (const [, subset, block] of blocks) {
  if (!KEEP.has(subset)) continue;
  const family = /font-family:\s*'([^']+)'/.exec(block)?.[1] ?? "unknown";
  const style = /font-style:\s*([a-z]+)/.exec(block)?.[1] ?? "normal";
  const weight = (/font-weight:\s*([0-9 ]+)/.exec(block)?.[1] ?? "400").replace(/\s+/g, "-");
  const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
  if (!url) continue;

  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const file = `${slug}-${weight}-${style}-${subset}.woff2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file} -> ${res.status}`);
  fs.writeFileSync(path.join(OUT, file), Buffer.from(await res.arrayBuffer()));

  parts.push(
    block
      .replace(/url\(https:[^)]+\)/, `url('/fonts/${file}')`)
      .replace(/;\s*/g, ";\n  ")
      .replace(/\{\s*/, "{\n  ")
      .replace(/\s*\}$/, "\n}"),
    ""
  );
  console.log(file);
}

fs.writeFileSync(CSS_OUT, parts.join("\n"));
