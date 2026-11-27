// Packs the letters drawn by scripts/og-font.swift into worker/og-font.js: the sizes and places as JSON,
// the pixels squeezed (raw deflate) and written as base64, unpacked once by worker/ogimage.js.
//   swift scripts/og-font.swift <dir> && node scripts/og-font.mjs <dir>
import { readFileSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/og-font.mjs <dir>");
const meta = JSON.parse(readFileSync(join(dir, "og-font.json"), "utf8"));
const bin = readFileSync(join(dir, "og-font.bin"));
const packed = deflateRawSync(bin, { level: 9 }).toString("base64");
const lines = packed.match(/.{1,120}/g).map(l => JSON.stringify(l)).join(" +\n  ");
writeFileSync(new URL("../worker/og-font.js", import.meta.url),
  "// Made by scripts/og-font.swift and scripts/og-font.mjs from public/fonts (Geist, SIL Open Font License).\n" +
  "// Don't edit by hand. Each glyph: [code, advance x 64, left, top above baseline, width, height, offset].\n" +
  "export const FACES = " + JSON.stringify(meta) + ";\n" +
  "export const SIZE = " + bin.length + ";\n" +
  "export const PIXELS =\n  " + lines + ";\n");
console.log("raw", bin.length, "packed", packed.length);
