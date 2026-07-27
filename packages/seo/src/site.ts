/**
 * Canonical site facts.
 *
 * Entity clarity is a GEO requirement: the store must describe itself the same
 * way everywhere — schema, metadata, llms.txt — so AI engines resolve it to one
 * entity. Change these here, never inline at a call site.
 *
 * Wording follows the brand voice. The words the guidelines forbid — bridal,
 * luxury, exclusive, premium — must not appear in anything generated here.
 */
export const SITE = {
  name: "Siumora",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://siumora.com",
  tagline: "Something given, something kept.",
  description:
    "Demi-fine jewellery in 925 sterling silver and 18k gold PVD. Made to be worn every day. Every piece leaves here wrapped as a gift.",
  locale: "en-IN",
  currency: "INR",
} as const;

/** AI crawlers are allowed — GEO citations depend on being readable. */
export const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
] as const;
