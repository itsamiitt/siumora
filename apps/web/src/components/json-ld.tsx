import type { JsonLd } from "@siumora/seo";

/**
 * Render JSON-LD into the document.
 *
 * The payload is built by @siumora/seo from typed catalogue data, never from
 * user input, so there is no injection surface here. `JSON.stringify` output is
 * still escaped for `<` to keep a stray sequence from closing the script tag.
 */
export function JsonLdScript({ data }: { data: JsonLd | JsonLd[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
