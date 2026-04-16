/**
 * Native FFI bridge to libslothpdf.
 * Internal module — not exported to users.
 */
import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";
import { join } from "path";
import { existsSync } from "fs";

// ── Binary resolution ────────────────────────────────────────────────

const LIB_EXT = process.platform === "darwin" ? "dylib" : "so";

function findLibrary(): string {
  // 1. Explicit env override
  if (process.env.SLOTHPDF_LIB) return process.env.SLOTHPDF_LIB;

  // 2. Platform-specific optional dependency (@slothpdf/darwin-arm64, etc.)
  const platform = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const pkgName = `@slothpdf/${platform}-${arch}`;
  try {
    const pkgPath = require.resolve(`${pkgName}/libslothpdf.${LIB_EXT}`);
    if (existsSync(pkgPath)) return pkgPath;
  } catch {}

  // 3. Monorepo development path
  const devPath = join(import.meta.dir, `../../../engine/zig-out/lib/libslothpdf.${LIB_EXT}`);
  if (existsSync(devPath)) return devPath;

  throw new Error(
    `SlothPDF native binary not found. Install the platform package:\n  bun add ${pkgName}\n\nOr set SLOTHPDF_LIB to the path of libslothpdf.${LIB_EXT}`
  );
}

// ── FFI symbols ──────────────────────────────────────────────────────

const SYMBOLS = {
  // Single render
  slothpdf_render_pdf: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.u32],
    returns: FFIType.ptr,
  },
  // Result accessors
  slothpdf_result_ptr: { args: [FFIType.ptr], returns: FFIType.ptr },
  slothpdf_result_len: { args: [FFIType.ptr], returns: FFIType.u64 },
  slothpdf_result_free: { args: [FFIType.ptr], returns: FFIType.void },
  // Fonts & images
  slothpdf_load_font: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.u8], returns: FFIType.void },
  slothpdf_has_font: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u8 },
  slothpdf_register_image: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64], returns: FFIType.void },
  slothpdf_has_image: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u8 },
  slothpdf_clear_images: { args: [], returns: FFIType.void },
} as const;

type Lib = ReturnType<typeof dlopen<typeof SYMBOLS>>;

// ── Singleton ────────────────────────────────────────────────────────

let _lib: Lib | null = null;

export function lib(): Lib {
  if (!_lib) _lib = dlopen(findLibrary(), SYMBOLS);
  return _lib;
}

export { ptr, toArrayBuffer };
