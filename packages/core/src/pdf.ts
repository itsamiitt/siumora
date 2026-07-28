/**
 * A minimal PDF writer.
 *
 * Hand-written rather than a dependency, for the same reason the migrations
 * are: what this needs is text, rules and boxes on one A4 page, and a general
 * PDF library is a large surface to carry — and to keep patched — for that.
 *
 * Only the base-14 fonts are used, so nothing has to be embedded. The cost is
 * that the character set is WinAnsi: no rupee sign, no em dash. `text()`
 * transliterates rather than emitting a byte the reader will draw as something
 * else, because a wrong glyph on an invoice is worse than a plain one.
 */

export type Font = "Helvetica" | "Helvetica-Bold";

/** A4 in PDF points, which are 1/72 inch. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

interface Op {
  readonly content: string;
}

export class PdfPage {
  private readonly ops: Op[] = [];

  /**
   * Draw text with its baseline at (x, y), measured from the bottom-left.
   *
   * PDF's origin is bottom-left, which is the opposite of every layout system
   * anyone uses day to day; callers work in `top` and convert once, rather than
   * flipping coordinates at every call site.
   */
  text(
    value: string,
    x: number,
    y: number,
    options: { font?: Font; size?: number } = {},
  ): this {
    const font = options.font ?? "Helvetica";
    const size = options.size ?? 9;
    this.ops.push({
      content: `BT /${font === "Helvetica-Bold" ? "F2" : "F1"} ${size} Tf ${round(x)} ${round(y)} Td (${escape(transliterate(value))}) Tj ET`,
    });
    return this;
  }

  /** Right-aligned text, for the money columns. */
  textRight(
    value: string,
    right: number,
    y: number,
    options: { font?: Font; size?: number } = {},
  ): this {
    const size = options.size ?? 9;
    const width = measure(transliterate(value), size, options.font ?? "Helvetica");
    return this.text(value, right - width, y, options);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5): this {
    this.ops.push({
      content: `${round(width)} w ${round(x1)} ${round(y1)} m ${round(x2)} ${round(y2)} l S`,
    });
    return this;
  }

  /** A filled rectangle, for table headers. Grey level 0–1. */
  fill(x: number, y: number, w: number, h: number, grey: number): this {
    this.ops.push({
      content: `${round(grey)} g ${round(x)} ${round(y)} ${round(w)} ${round(h)} re f 0 g`,
    });
    return this;
  }

  stream(): string {
    return this.ops.map((op) => op.content).join("\n");
  }
}

/**
 * Assemble the file.
 *
 * A PDF is a set of numbered objects plus a cross-reference table giving the
 * byte offset of each. The offsets are why this is written in one pass over a
 * growing string rather than composed from parts: they have to be counted in
 * the bytes actually emitted, and a later edit invalidates every one after it.
 */
export function renderPdf(pages: readonly PdfPage[], title: string): Buffer {
  const streams = pages.map((page) => page.stream());

  // 1 catalog, 2 pages, 3 font, 4 bold font, then a page and a content stream
  // per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  const contentIds = pages.map((_, index) => 6 + index * 2);

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  );
  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  );

  pages.forEach((_, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(PAGE_WIDTH)} ${round(PAGE_HEIGHT)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
    );
    const stream = streams[index] as string;
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  });

  const infoId = objects.length + 1;
  objects.push(
    `<< /Title (${escape(transliterate(title))}) /Producer (Siumora) >>`,
  );

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}

/**
 * Widths of Helvetica, in 1/1000 em, for the characters an invoice uses.
 *
 * Enough to right-align a money column and to know when a product title will
 * overflow its cell. A full metrics table would be four hundred entries to
 * serve a document whose text is digits, Latin letters and punctuation.
 */
const WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667,
  "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
  ".": 278, "/": 278, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584,
  "?": 556, "@": 1015, "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556,
  "`": 333, "{": 334, "|": 260, "}": 334, "~": 584,
};

const DIGIT_WIDTH = 556;
const UPPERCASE: Record<string, number> = {
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
};
const LOWERCASE: Record<string, number> = {
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

/** Text width in points. Bold Helvetica runs wider; approximated as such. */
export function measure(value: string, size: number, font: Font = "Helvetica"): number {
  let thousandths = 0;
  for (const character of value) {
    thousandths +=
      WIDTHS[character] ??
      UPPERCASE[character] ??
      LOWERCASE[character] ??
      (character >= "0" && character <= "9" ? DIGIT_WIDTH : 556);
  }
  // Helvetica-Bold is roughly 4% wider across this character set. Close enough
  // to right-align on, and the alternative is a second metrics table.
  return (thousandths / 1000) * size * (font === "Helvetica-Bold" ? 1.04 : 1);
}

/** Cut a string to fit a width, with an ellipsis, so a long title cannot bleed. */
export function truncate(value: string, maxWidth: number, size: number): string {
  if (measure(value, size) <= maxWidth) return value;

  let cut = value;
  while (cut.length > 1 && measure(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}...`;
}

/**
 * Replace characters WinAnsi cannot represent.
 *
 * Silently emitting them would draw a wrong glyph, and a wrong glyph on a tax
 * invoice is worse than a plain substitute. The rupee sign is the one that
 * matters — it is U+20B9, added to Unicode long after these fonts were fixed.
 */
export function transliterate(value: string): string {
  return value
    .replace(/₹/g, "INR ")
    .replace(/[—–]/g, "-")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    // Anything left outside Latin-1 would be mangled by the latin1 encoding of
    // the file itself, so it is dropped rather than corrupted.
    .replace(/[^\x20-\xff]/g, "");
}

/** Backslash, parentheses: the three characters that end a PDF string early. */
function escape(value: string): string {
  return value.replace(/[\\()]/g, (character) => `\\${character}`);
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
