/** Keep desktop and mobile collection links in one place. */
export const SHOP_NAV = [
  { href: "/shop", label: "All jewellery" },
  { href: "/shop?category=earrings", label: "Earrings" },
  { href: "/shop?category=necklaces", label: "Necklaces" },
  { href: "/shop?category=rings", label: "Rings" },
] as const;

export const COLLECTION_NAV = [
  { href: "/collections/everyday", label: "Everyday" },
  { href: "/collections/gifting", label: "Gifting" },
  { href: "/collections/the-petal-edit", label: "The Petal Edit" },
] as const;
