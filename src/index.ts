/**
 * @slothpdf/render — Fast PDF generation from templates.
 *
 * @example
 * ```ts
 * import { render, loadFont } from "@slothpdf/render";
 *
 * // Single PDF
 * const pdf = render(template, { name: "Acme" });
 *
 * // Batch — one PDF per row
 * for (const { index, buffer } of render(template, rows)) {
 *   fs.writeFileSync(`out/${index}.pdf`, buffer);
 * }
 *
 * // Merge — all rows into one multi-page PDF
 * const merged = render(template, rows, { merge: true });
 *
 * // ZIP — all rows as a ZIP archive
 * const zip = render(template, rows, { zip: true });
 * ```
 */

import { lib, ptr, toArrayBuffer } from "./native";

/** Copy bytes from a Zig-owned pointer into a new Buffer.
 *  The copy must complete before the Zig memory is freed. */
function copyFromPtr(p: any, len: number): Buffer {
  const view = toArrayBuffer(p, 0, len)!;
  const copy = Buffer.alloc(len);
  copy.set(new Uint8Array(view));
  return copy;
}

// ── Types ────────────────────────────────────────────────────────────

export interface RenderOptions {
  compress?: boolean;
  password?: string;
  merge?: boolean;
  zip?: boolean;
}

export interface BatchItem {
  index: number;
  buffer: Buffer;
}

// ── Render ───────────────────────────────────────────────────────────

/**
 * Render PDFs from a template and data.
 *
 * - Object → single PDF (Buffer)
 * - Array → generator yielding one PDF per row
 * - Array + `{ merge: true }` → single multi-page PDF (Buffer)
 * - Array + `{ zip: true }` → ZIP archive of all PDFs (Buffer)
 */
export function render(
  template: string,
  data: Record<string, unknown>[],
  options: RenderOptions & { merge: true },
): Buffer;
export function render(
  template: string,
  data: Record<string, unknown>[],
  options: RenderOptions & { zip: true },
): Buffer;
export function render(
  template: string,
  data: Record<string, unknown>[],
  options?: RenderOptions,
): Generator<BatchItem>;
export function render(
  template: string,
  data?: Record<string, unknown>,
  options?: RenderOptions,
): Buffer;
export function render(
  template: string,
  data?: Record<string, unknown> | Record<string, unknown>[],
  options?: RenderOptions,
): Buffer | Generator<BatchItem> {
  if (Array.isArray(data)) {
    if (options?.merge) return _renderMerge(template, data, options);
    if (options?.zip) return _renderZip(template, data, options);
    return _renderBatch(template, data, options);
  }
  return _renderOne(template, data, options);
}

// ── Single render ────────────────────────────────────────────────────

function _renderOne(
  template: string,
  data?: Record<string, unknown>,
  options?: RenderOptions,
): Buffer {
  const l = lib();
  const templateBuf = Buffer.from(template);
  const jsonBuf = data ? Buffer.from(JSON.stringify(data)) : null;
  const pwBuf = options?.password ? Buffer.from(options.password) : null;
  const flags = options?.compress ? 1 : 0;

  const result = l.symbols.slothpdf_render_pdf(
    ptr(templateBuf), templateBuf.length,
    jsonBuf ? ptr(jsonBuf) : null, jsonBuf?.length ?? 0,
    null, 0,
    pwBuf ? ptr(pwBuf) : null, pwBuf?.length ?? 0,
    flags,
  );

  if (!result) throw new Error("SlothPDF render failed");

  const p = l.symbols.slothpdf_result_ptr(result);
  const len = Number(l.symbols.slothpdf_result_len(result));
  const pdf = copyFromPtr(p!, len);
  l.symbols.slothpdf_result_free(result);

  return pdf;
}

// ── Batch render (generator) ─────────────────────────────────────────

function* _renderBatch(
  template: string,
  rows: Record<string, unknown>[],
  options?: RenderOptions,
): Generator<BatchItem> {
  for (let i = 0; i < rows.length; i++) {
    yield { index: i, buffer: _renderOne(template, rows[i], options) };
  }
}

// ── Merge render ─────────────────────────────────────────────────────

function _renderMerge(
  template: string,
  rows: Record<string, unknown>[],
  options?: RenderOptions,
): Buffer {
  const l = lib();
  const templateBuf = Buffer.from(template);
  const packed = packRows(rows);
  const pwBuf = options?.password ? Buffer.from(options.password) : null;
  const flags = (options?.compress ? 1 : 0) | 2; // bit 1 = merge mode

  const result = l.symbols.slothpdf_render_pdf(
    ptr(templateBuf), templateBuf.length,
    ptr(packed), packed.length,
    null, 0,
    pwBuf ? ptr(pwBuf) : null, pwBuf?.length ?? 0,
    flags,
  );

  if (!result) throw new Error("SlothPDF merge failed");

  const p = l.symbols.slothpdf_result_ptr(result);
  const len = Number(l.symbols.slothpdf_result_len(result));
  const pdf = copyFromPtr(p!, len);
  l.symbols.slothpdf_result_free(result);

  return pdf;
}

// ── ZIP render ───────────────────────────────────────────────────────

function _renderZip(
  template: string,
  rows: Record<string, unknown>[],
  options?: RenderOptions,
): Buffer {
  // Render each PDF individually (supports all options), then ZIP
  const pdfs: Buffer[] = [];
  for (let i = 0; i < rows.length; i++) {
    pdfs.push(_renderOne(template, rows[i], options));
  }

  const pad = String(rows.length).length;
  const entries = pdfs.map((buf, i) => ({
    name: `${String(i + 1).padStart(pad, "0")}.pdf`,
    data: buf,
  }));

  return buildZip(entries);
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);

    // Local file header
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    parts.push(local, data);

    // Central directory entry
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);
    centralDir.push(cd);

    offset += local.length + data.length;
  }

  let cdSize = 0;
  for (const cd of centralDir) cdSize += cd.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, ...centralDir, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Internal helpers ─────────────────────────────────────────────────

function packRows(rows: Record<string, unknown>[]): Buffer {
  const jsonStrings = rows.map(r => JSON.stringify(r));
  const totalLen = 4 + jsonStrings.reduce((s, j) => s + 4 + Buffer.byteLength(j), 0);
  const buf = Buffer.alloc(totalLen);
  buf.writeUInt32LE(rows.length, 0);
  let offset = 4;
  for (const j of jsonStrings) {
    const len = Buffer.byteLength(j);
    buf.writeUInt32LE(len, offset); offset += 4;
    buf.write(j, offset); offset += len;
  }
  return buf;
}

// ── Fonts ────────────────────────────────────────────────────────────

/**
 * Register a TrueType font for use in templates.
 */
export function loadFont(
  name: string,
  ttf: Buffer,
  variant: "regular" | "bold" | "italic" = "regular",
): void {
  const l = lib();
  const nameBuf = Buffer.from(name);
  const v = variant === "bold" ? 1 : variant === "italic" ? 2 : 0;
  l.symbols.slothpdf_load_font(ptr(nameBuf), nameBuf.length, ptr(ttf), ttf.length, v);
}

/**
 * Check if a font family is loaded.
 */
export function hasFont(name: string): boolean {
  const l = lib();
  const buf = Buffer.from(name);
  return l.symbols.slothpdf_has_font(ptr(buf), buf.length) === 1;
}

// ── Images ───────────────────────────────────────────────────────────

/**
 * Register an image by key for use in templates via `src="{key}"`.
 */
export function loadImage(key: string, data: Buffer): void {
  const l = lib();
  const keyBuf = Buffer.from(key);
  l.symbols.slothpdf_register_image(ptr(keyBuf), keyBuf.length, ptr(data), data.length);
}

/**
 * Check if an image is registered.
 */
export function hasImage(key: string): boolean {
  const l = lib();
  const buf = Buffer.from(key);
  return l.symbols.slothpdf_has_image(ptr(buf), buf.length) === 1;
}

/**
 * Clear all registered images.
 */
export function clearImages(): void {
  lib().symbols.slothpdf_clear_images();
}

// ── Init ─────────────────────────────────────────────────────────────

export interface FontConfig {
  regular?: string;
  bold?: string;
  italic?: string;
}

export interface InitOptions {
  fonts?: Record<string, FontConfig | string>;
  images?: Record<string, string>;
}

/**
 * Preload fonts and images at startup. Skips assets already loaded.
 *
 * @example
 * ```ts
 * init({
 *   fonts: {
 *     Inter: { regular: "fonts/Inter-Regular.ttf", bold: "fonts/Inter-Bold.ttf" },
 *     Mono: "fonts/JetBrainsMono-Regular.ttf", // shorthand for { regular: ... }
 *   },
 *   images: {
 *     logo: "assets/logo.png",
 *   },
 * });
 * ```
 */
export function init(options: InitOptions): void {
  const { readFileSync } = require("fs");

  if (options.fonts) {
    for (const [name, config] of Object.entries(options.fonts)) {
      const variants = typeof config === "string" ? { regular: config } : config;
      for (const [variant, path] of Object.entries(variants)) {
        if (!path) continue;
        if (!hasFont(name)) {
          loadFont(name, readFileSync(path), variant as "regular" | "bold" | "italic");
        }
      }
    }
  }

  if (options.images) {
    for (const [key, path] of Object.entries(options.images)) {
      if (!hasImage(key)) {
        loadImage(key, readFileSync(path));
      }
    }
  }
}
