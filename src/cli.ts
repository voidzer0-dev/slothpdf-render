#!/usr/bin/env bun
/**
 * SlothPDF CLI
 *
 * Usage:
 *   slothpdf render template.sloth [data.json] [-o output.pdf]
 *   slothpdf batch  template.sloth data.json [-o outdir/]
 *
 * data.json for batch: array of objects, one PDF per element.
 */

import { render, batch, loadFont } from "./index";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, basename, extname } from "path";

const args = process.argv.slice(2);
const cmd = args[0];

function usage(): never {
  console.log(`
  slothpdf — fast PDF generation from templates

  Usage:
    slothpdf render template.sloth [data.json] [-o output.pdf]
    slothpdf batch  template.sloth data.json [-o outdir/] [--name field]

  Options:
    -o          Output path (file for render, directory for batch)
    --name      JSON field to use for filenames in batch mode
    --font      Load a TTF font: --font "Name=path.ttf" or --font "Name:bold=path.ttf"
    --compress  Enable FlateDecode compression
`);
  process.exit(1);
}

if (!cmd || cmd === "--help" || cmd === "-h") usage();

// Parse flags
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}
function hasFlag(name: string): boolean {
  return args.includes(name);
}

// Load fonts from --font flags
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--font" && args[i + 1]) {
    const spec = args[i + 1];
    const [nameSpec, path] = spec.split("=");
    if (!path) { console.error(`Invalid --font: ${spec}. Use "Name=path.ttf"`); process.exit(1); }
    const [name, variant] = nameSpec.split(":");
    const ttf = readFileSync(path);
    loadFont(name, ttf, (variant as "regular" | "bold" | "italic") ?? "regular");
    i++;
  }
}

const compress = hasFlag("--compress");

if (cmd === "render") {
  const templatePath = args[1];
  if (!templatePath) usage();
  const template = readFileSync(templatePath, "utf-8");

  const dataPath = args.find((a, i) => i > 1 && !a.startsWith("-") && a !== flag("-o"));
  const data = dataPath ? JSON.parse(readFileSync(dataPath, "utf-8")) : undefined;

  const out = flag("-o") ?? "output.pdf";
  const t0 = performance.now();
  const pdf = render(template, data, { compress });
  const elapsed = performance.now() - t0;

  writeFileSync(out, pdf);
  console.log(`${out} (${(pdf.length / 1024).toFixed(1)}KB) in ${elapsed.toFixed(1)}ms`);

} else if (cmd === "batch") {
  const templatePath = args[1];
  const dataPath = args[2];
  if (!templatePath || !dataPath) usage();

  const template = readFileSync(templatePath, "utf-8");
  const rows: Record<string, unknown>[] = JSON.parse(readFileSync(dataPath, "utf-8"));
  if (!Array.isArray(rows)) { console.error("Data must be a JSON array"); process.exit(1); }

  const outDir = flag("-o") ?? "out";
  const nameField = flag("--name");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const t0 = performance.now();
  let totalBytes = 0;
  for (const { index, buffer } of batch(template, rows, { compress })) {
    const name = nameField && rows[index][nameField]
      ? String(rows[index][nameField])
      : String(index + 1).padStart(String(rows.length).length, "0");
    writeFileSync(join(outDir, `${name}.pdf`), buffer);
    totalBytes += buffer.length;
  }
  const elapsed = performance.now() - t0;

  console.log(`${rows.length} PDFs → ${outDir}/ (${(totalBytes / 1024 / 1024).toFixed(1)}MB) in ${elapsed.toFixed(0)}ms | ${(elapsed / rows.length).toFixed(2)}ms/pdf`);

} else {
  console.error(`Unknown command: ${cmd}`);
  usage();
}
