import type { Image } from "@siumora/core";

/** Only replace the bundled seed illustrations. Merchant-uploaded photos win. */
export function catalogPresentationImage(image: Image): Image {
  const match = /^\/catalog\/(petal-studs|kernel-pendant|jaali-hoops|tuesday-band)\.svg$/.exec(image.url);
  return match ? { ...image, url: `/storefront/${match[1]}.webp`, alt: `${image.alt} — illustrative design study`, width: 1024, height: 1280 } : image;
}
