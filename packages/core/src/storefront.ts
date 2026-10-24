/** Public storefront content. No provider credentials belong in this shape. */
export const DEFAULT_STOREFRONT = {
  eyebrow: "The everyday, made a little special",
  title: "Something given.",
  subtitle: "Something kept.",
  description: "Little pieces. Lasting meaning. Demi-fine jewellery for the moments that are yours.",
  image: "/storefront/everyday-hero.webp",
  imageAlt: "Sunlit portrait with delicate gold jewellery and an ivory linen shirt",
  buttonLabel: "Discover the collection",
  buttonHref: "/shop",
  secondaryLabel: "Find a little something to give",
  secondaryHref: "/shop",
  note: "925 STERLING SILVER · 18K GOLD PVD",
  announcement: "A little closer to you. Complimentary shipping on orders ₹999+",
};
export type StorefrontContent = typeof DEFAULT_STOREFRONT;

export function isStorefrontContent(value: unknown): value is StorefrontContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== Object.keys(DEFAULT_STOREFRONT).length) return false;
  for (const key of Object.keys(DEFAULT_STOREFRONT)) {
    if (typeof row[key] !== "string" || !(row[key] as string).trim() || (row[key] as string).length > 1000) return false;
  }
  const internal = (s: string) => /^\/(?!\/)/.test(s) && !/[\\\s\u0000-\u001f]/.test(s);
  if (!internal(row.buttonHref as string) || !internal(row.secondaryHref as string)) return false;
  const image = row.image as string;
  if (internal(image)) return true;
  try {
    const url = new URL(image);
    const localUpload = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || localUpload) && !url.username && !url.password;
  } catch { return false; }
}
