import type { ReactNode, SVGProps } from "react";

export type StoreIconName = "search" | "bag" | "heart" | "user" | "arrow" | "close" | "menu" | "gift" | "truck" | "spark" | "return";
const paths: Record<StoreIconName, ReactNode> = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  bag: <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
  heart: <path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z" />,
  user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M3 8h18M3 16h18" />,
  gift: <><path d="M3 10h18v4H3zM5 14v7h14v-7M12 10v11" /><path d="M12 10C3 10 4 3 7.5 3 11 3 12 10 12 10Zm0 0s1-7 4.5-7C20 3 21 10 12 10Z" /></>,
  truck: <><path d="M2 5h12v12H2zM14 9h4l4 4v4h-8" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
  spark: <><path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z" /><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5L20 2Z" /></>,
  return: <path d="M4 10a8 8 0 1 1 0 5M4 4v6h6" />,
};
export function StoreIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: StoreIconName }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
