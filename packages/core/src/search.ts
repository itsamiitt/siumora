import type { Product } from "./catalog.ts";

/**
 * Keyword search over the catalogue.
 *
 * Meilisearch owns this at scale — hybrid keyword ⊕ vector, sub-50ms. This is
 * the same interface backed by an in-process scan, so the storefront has a
 * working search before the index exists and the swap touches one file.
 *
 * Two India-specific behaviours that a naive `includes()` would miss, and that
 * cost real conversions:
 *
 * - **Hinglish and transliteration.** Shoppers type "jhumka", "kaan ki bali"
 *   and "earring" for the same thing, and there is no canonical spelling for a
 *   transliterated word.
 * - **Typo tolerance.** Most traffic is thumb-typed on a phone.
 */

/**
 * Synonym groups. Every term in a group matches every other.
 *
 * Kept as data rather than logic so mining zero-result queries can extend it
 * without touching the matcher.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["earring", "earrings", "jhumka", "jhumkas", "bali", "studs", "stud", "tops"],
  ["necklace", "pendant", "haar", "chain", "locket"],
  ["ring", "anguthi", "band"],
  ["bracelet", "kada", "kangan", "bangle", "bangles"],
  ["anklet", "payal", "paayal"],
  ["nosepin", "nose pin", "nath", "nosering"],
  ["gold", "golden", "sona", "gold plated", "gold-plated"],
  ["silver", "chandi", "sterling"],
  ["gift", "gifting", "present", "tohfa"],
  ["hoop", "hoops"],
];

const SYNONYM_INDEX: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const index = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      const set = index.get(term) ?? new Set<string>();
      for (const other of group) set.add(other);
      index.set(term, set);
    }
  }
  return index;
})();

/** Terms that match the given one, including itself. */
export function expandTerm(term: string): ReadonlySet<string> {
  return SYNONYM_INDEX.get(term) ?? new Set([term]);
}

export function tokenise(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/**
 * Damerau-Levenshtein distance (optimal string alignment), bounded by `max`.
 *
 * Counts a transposition of adjacent characters as one edit, not two. That
 * matters more than it sounds: swapping two letters is the most common error
 * when thumb-typing, and plain Levenshtein scores "pendnat" as two edits from
 * "pendant" — outside the tolerance a 7-letter word gets, so the shopper sees
 * no results for an obvious near-miss.
 *
 * Bounded because search runs per keystroke; anything past `max` is rejected
 * anyway, so finishing the matrix is wasted work.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  // Three rows: two back is what makes the transposition check possible.
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        current[j - 1]! + 1, // insertion
        previous[j]! + 1, // deletion
        previous[j - 1]! + cost, // substitution
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, twoBack[j - 2]! + 1); // transposition
      }

      current.push(value);
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > max) return max + 1;
    twoBack = previous;
    previous = current;
  }

  return previous[b.length]!;
}

/** Typo tolerance scales with word length — short words must match exactly. */
function toleranceFor(term: string): number {
  if (term.length <= 4) return 0;
  if (term.length <= 7) return 1;
  return 2;
}

export interface SearchHit {
  readonly product: Product;
  readonly score: number;
}

interface FieldWeight {
  readonly text: string;
  readonly weight: number;
}

function fieldsOf(product: Product): FieldWeight[] {
  return [
    { text: product.title, weight: 10 },
    { text: product.subtitle, weight: 4 },
    { text: product.material, weight: 3 },
    { text: product.collections.join(" "), weight: 3 },
    { text: product.description, weight: 1 },
    { text: product.variants.map((v) => v.title).join(" "), weight: 2 },
  ];
}

/**
 * Score one product against the query tokens.
 *
 * Every token must match something — an "AND" over tokens. "gold ring" should
 * not return every gold item; a shopper who adds a word is narrowing, and an
 * OR would widen instead.
 */
function scoreProduct(product: Product, tokens: readonly string[]): number {
  const fields = fieldsOf(product);
  let total = 0;

  for (const token of tokens) {
    const variants = expandTerm(token);
    let best = 0;

    for (const field of fields) {
      const words = tokenise(field.text);

      for (const variant of variants) {
        // Exact substring beats a fuzzy hit; prefix beats mid-word.
        for (const word of words) {
          if (word === variant) {
            best = Math.max(best, field.weight * 3);
          } else if (word.startsWith(variant)) {
            best = Math.max(best, field.weight * 2);
          } else if (word.includes(variant)) {
            best = Math.max(best, field.weight);
          } else {
            const tolerance = toleranceFor(variant);
            if (tolerance > 0 && editDistance(word, variant, tolerance) <= tolerance) {
              best = Math.max(best, field.weight * 0.5);
            }
          }
        }
      }
    }

    if (best === 0) return 0;
    total += best;
  }

  return total;
}

export function searchProducts(
  products: readonly Product[],
  query: string,
): SearchHit[] {
  const tokens = tokenise(query);
  if (tokens.length === 0) return [];

  return products
    .map((product) => ({ product, score: scoreProduct(product, tokens) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.product.title.localeCompare(b.product.title));
}
