export { AI_CRAWLERS, SITE } from "./site.ts";

export {
  breadcrumbJsonLd,
  collectionJsonLd,
  faqJsonLd,
  organizationJsonLd,
  productJsonLd,
  websiteJsonLd,
  type Crumb,
  type FaqEntry,
  type JsonLd,
} from "./jsonld.ts";

export {
  collectionMetadata,
  noindexMetadata,
  productMetadata,
  truncate,
  type PageMetadata,
} from "./metadata.ts";

export {
  buildLlmsTxt,
  buildRobots,
  buildSitemap,
  type RobotsConfig,
  type RobotsRule,
  type SitemapEntry,
} from "./discovery.ts";
