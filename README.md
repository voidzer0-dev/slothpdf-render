# @slothpdf/render

Fast PDF generation from templates. **17,000+ PDFs per second.** No headless browser.

Built on a native engine written in Zig. No Puppeteer, no Chrome, no runtime overhead. Constant memory.

![SlothPDF rendering demo](rendering.gif)

## Install

```bash
bun add @slothpdf/render
```

> Requires [Bun](https://bun.sh) v1.1+. The correct native binary is installed automatically.

## Quick start

```ts
import { render } from "@slothpdf/render";

const pdf = render(`
  <Page size="A4" margin="20mm">
    <Box class="text-2xl font-bold mb-4">Hello, {name}!</Box>
    <Box class="text-sm text-gray-600">{description}</Box>
  </Page>
`, { name: "World", description: "Generated with SlothPDF" });

await Bun.write("hello.pdf", pdf);
```

## Batch

Pass an array and `render` yields one PDF per row:

```ts
for (const { index, buffer } of render(template, invoices)) {
  await Bun.write(`invoices/${index}.pdf`, buffer);
}
```

## Merge

All rows into a single multi-page PDF:

```ts
await Bun.write("report.pdf", render(template, rows, { merge: true }));
```

## ZIP

All rows as a ZIP archive:

```ts
await Bun.write("invoices.zip", render(template, rows, { zip: true }));
```

## Encryption

AES-256 password protection:

```ts
await Bun.write("secure.pdf", render(template, data, { password: "secret" }));
```

Works with all modes — single, merge, zip, compress.

## Init

Preload fonts and images at startup. Skips assets already loaded.

```ts
import { init, render } from "@slothpdf/render";

init({
  fonts: {
    Inter: { regular: "fonts/Inter-Regular.ttf", bold: "fonts/Inter-Bold.ttf" },
    Mono: "fonts/JetBrainsMono-Regular.ttf",
  },
  images: {
    logo: "assets/logo.png",
  },
});
```

## Custom fonts

```ts
import { loadFont } from "@slothpdf/render";

loadFont("Inter", await Bun.file("Inter-Regular.ttf").bytes());
loadFont("Inter", await Bun.file("Inter-Bold.ttf").bytes(), "bold");
```

```
<Page size="A4" margin="20mm" font="Inter">
  <Box class="font-bold">This renders in Inter Bold</Box>
</Page>
```

## Images

```ts
import { loadImage } from "@slothpdf/render";

loadImage("logo", await Bun.file("logo.png").bytes());
```

```
<Image src="logo" class="w-32" />
```

## QR codes

```
<QrCode src="https://example.com/pay/inv-042" class="h-[120]" />
```

## Page headers & footers

```
<Page size="A4" margin="20mm">
  <PageHeader class="flex-row border-b border-gray-200 pb-3">
    <Box class="text-lg font-bold">Acme Corp</Box>
    <Box class="text-right text-sm">Invoice #2026-042</Box>
  </PageHeader>

  <!-- page content -->

  <PageFooter class="flex-row border-t border-gray-200 pt-2 text-xs text-gray-400">
    <Box>hello@acme.com</Box>
    <Box class="text-right">Page {page}</Box>
  </PageFooter>
</Page>
```

## Template syntax

Templates use an HTML-like markup with utility classes. If you've built a web page, the syntax will feel familiar.

**Elements:** `Page`, `Box`, `Text`, `Image`, `QrCode`, `Line`, `Columns`, `Column`, `PageHeader`, `PageFooter`

**Layout:** `flex-row`, `flex-col`, `justify-between`, `items-center`, `gap-4`

**Sizing:** `w-1/2`, `w-full`, `h-16`

**Spacing:** `p-4`, `px-6`, `mt-2`, `mb-8`

**Typography:** `text-sm`, `text-2xl`, `font-bold`, `text-gray-500`, `text-center`

**Data:** `{field}`, `{nested.field}`, `each="arrayField"`, `when="condition"`

```
<Box each="items" class="flex-row py-2 border-b border-gray-100">
  <Box class="w-2/3 text-sm">{name}</Box>
  <Box class="w-1/3 text-sm text-right">{price}</Box>
</Box>

<Box when="discount" class="text-green-600">
  Discount applied: {discount}
</Box>
```

## CLI

```bash
slothpdf render template.sloth data.json -o output.pdf
slothpdf batch template.sloth rows.json -o invoices/
slothpdf render template.sloth --font "Inter=Inter-Regular.ttf" --compress -o out.pdf
```

## API reference

### `render(template, data?, options?)`

The only function you need. Behavior depends on what you pass:

| Call | Returns |
|------|---------|
| `render(template, object)` | `Buffer` — single PDF |
| `render(template, array)` | `Generator<{ index, buffer }>` — one PDF per row |
| `render(template, array, { merge: true })` | `Buffer` — one multi-page PDF |
| `render(template, array, { zip: true })` | `Buffer` — ZIP archive |

**Options:**
- **compress** `boolean` — FlateDecode compression (smaller files)
- **password** `string` — AES-256 encryption
- **merge** `boolean` — combine all rows into one PDF
- **zip** `boolean` — package all PDFs into a ZIP

All options are additive — `{ compress: true, password: "secret", merge: true }` works.

### `init(options)`

Preload fonts and images from file paths. Skips assets already loaded.

### `loadFont(name, ttf, variant?)`

Register a TrueType font. Variant: `"regular"` | `"bold"` | `"italic"`.

### `loadImage(key, data)` · `hasImage(key)` · `clearImages()`

Register, check, or clear images for `<Image src="key" />`.

### `hasFont(name)`

Check if a font family is loaded. Returns `boolean`.

## Performance

Benchmarked on Apple M4, single-threaded, 1000 unique invoices with 3–10 line items:

| Mode | Latency | Throughput |
|------|---------|------------|
| No encryption | 0.057ms | **17,600 /sec** |
| AES-256 encrypted | 0.067ms | **14,900 /sec** |

Memory is constant after warmup — 50,000 renders with no growth.

Compared to other tools:

| Tool | ~Speed |
|------|--------|
| **SlothPDF** | **17,600 /sec** |
| jsPDF | 7,750 /sec |
| Chromium/Puppeteer | ~18 /sec |
| wkhtmltopdf | ~8 /sec |

## Platforms

| Platform | Package |
|----------|---------|
| macOS arm64 | `@slothpdf/darwin-arm64` |
| Linux x64 | `@slothpdf/linux-x64` |

Set `SLOTHPDF_LIB` to use a custom binary path.

## Playground

Build and preview templates at [slothpdf.jsoto.cloud/editor](https://slothpdf.jsoto.cloud/editor).

## License

MIT
