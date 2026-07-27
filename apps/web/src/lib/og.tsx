import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Shared pieces for the generated Open Graph images.
 *
 * These are the brand's face in every share, every WhatsApp forward and every
 * search preview, so they use the real typefaces rather than whatever Satori
 * falls back to. The font files are committed for that reason: fetching them at
 * render time would put a network call on the critical path of an image that is
 * supposed to be cheap.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

const INK = "#1C1917";
const IVORY = "#F7F3EA";
const BLUSH = "#EBDDD8";
const MULBERRY = "#6B2942";

let cachedFonts: Array<{ name: string; data: ArrayBuffer; weight: 300 | 500 }> | null =
  null;

export async function ogFonts() {
  if (cachedFonts) return cachedFonts;

  const dir = join(process.cwd(), "src/assets/fonts");
  const [display, body] = await Promise.all([
    readFile(join(dir, "CormorantGaramond-Light.ttf")),
    readFile(join(dir, "Jost-Medium.ttf")),
  ]);

  cachedFonts = [
    {
      name: "Cormorant Garamond",
      data: display.buffer.slice(
        display.byteOffset,
        display.byteOffset + display.byteLength,
      ) as ArrayBuffer,
      weight: 300 as const,
    },
    {
      name: "Jost",
      data: body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
      weight: 500 as const,
    },
  ];

  return cachedFonts;
}

/**
 * The Petal & Kernel mark.
 *
 * Redrawn as plain elements rather than an imported SVG because Satori renders
 * a restricted subset — a border-radius box is the reliable way to get a circle
 * at this size.
 */
export function OgMark({ size = 72 }: { size?: number }) {
  const circle = size * 0.5;
  const offset = size * 0.25;

  const ring = (left: number, top: number) => ({
    position: "absolute" as const,
    left,
    top,
    width: circle,
    height: circle,
    borderRadius: circle,
    border: `${Math.max(1, size * 0.0125)}px solid ${INK}`,
  });

  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex" }}>
      <div style={ring(offset, 0)} />
      <div style={ring(size - circle, offset)} />
      <div style={ring(offset, size - circle)} />
      <div style={ring(0, offset)} />
      <div
        style={{
          position: "absolute",
          left: size * 0.417,
          top: size * 0.417,
          width: size * 0.167,
          height: size * 0.167,
          borderRadius: size,
          background: MULBERRY,
        }}
      />
    </div>
  );
}

/**
 * Card shell.
 *
 * Ivory ground with a blush panel and a single brass hairline — holding the
 * 62/20/11/5/2 proportion at a glance, with mulberry appearing once as the
 * kernel and once on the label.
 */
export function OgFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: IVORY,
        padding: 64,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          background: "#C79A5C",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -120,
          bottom: -120,
          width: 460,
          height: 460,
          borderRadius: 460,
          background: BLUSH,
        }}
      />
      {children}
    </div>
  );
}

export const OG_COLOURS = { INK, IVORY, BLUSH, MULBERRY } as const;
