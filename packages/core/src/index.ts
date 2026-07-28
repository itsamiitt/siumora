export {
  GST_SLABS,
  ORIGIN_STATE_CODE,
  extractGst,
  isGstSlab,
  isInterState,
  type GstBreakup,
  type GstSlab,
} from "./gst.ts";

export {
  FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING,
  amountToFreeShipping,
  calculateTotals,
  lineTotal,
  principalSlab,
  shippingFor,
  type CartLine,
  type CartTotals,
  type TotalsOptions,
} from "./cart.ts";

export {
  COD_FEE,
  COD_MAX_ORDER,
  COD_MIN_ORDER,
  COD_PARTIAL_PAYMENT,
  COD_TRUSTED_ORDER_COUNT,
  evaluateCod,
  prepaidIncentive,
  type CodDecision,
  type CodInput,
  type RtoRisk,
} from "./cod.ts";

export {
  scoreAddress,
  type AddressInput,
  type AddressQuality,
} from "./address.ts";

export {
  RTO_HIGH_THRESHOLD,
  RTO_MEDIUM_THRESHOLD,
  bandFor,
  explainRto,
  scoreRto,
  type RtoContribution,
  type RtoFactors,
  type RtoScore,
} from "./rto.ts";

export {
  SYNONYM_GROUPS,
  editDistance,
  expandTerm,
  searchProducts,
  tokenise,
  type SearchHit,
} from "./search.ts";

export {
  financialYear,
  hsnSummary,
  invoiceNumber,
  orderNumber,
  summariseInvoice,
  type HsnSummaryRow,
  type InvoiceTotals,
} from "./invoice.ts";

export {
  ORDER_STATUSES,
  canTransition,
  initialStatus,
  isRevenueRecognised,
  isTerminal,
  transition,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type ShippingAddress,
} from "./order.ts";

export {
  canEmitAggregateRating,
  reviewSchema,
  sortByNewest,
  summariseRatings,
  type RatingSummary,
  type Review,
} from "./reviews.ts";

export {
  DAMAGE_REPORT_HOURS,
  REFUND_WORKING_DAYS,
  RETURN_REASON_LABELS,
  RETURN_WINDOW_DAYS,
  canTransitionRma,
  daysSince,
  evaluateReturn,
  isFault,
  transitionRma,
  type ReturnEligibility,
  type ReturnEligibilityInput,
  type ReturnReason,
  type ReturnRequest,
  type ReturnResolution,
  type RmaStatus,
} from "./returns.ts";

export {
  awaitsRestock,
  restockTiming,
  type RestockTiming,
} from "./restock.ts";

export {
  MAX_DELIVERY_ATTEMPTS,
  NDR_REASON_LABELS,
  escalation,
  isRefusal,
  ndrState,
  needsAddressFix,
  outcomeFor,
  type NdrAction,
  type NdrEvent,
  type NdrReason,
  type NdrState,
} from "./ndr.ts";

export {
  invoiceSeriesHealth,
  ndrQueue,
  rtoBreakdown,
  statusCounts,
  summariseRevenue,
  type InvoiceSeriesHealth,
  type RevenueSummary,
  type RtoBreakdown,
} from "./metrics.ts";

export {
  collectionSchema,
  gstSlabSchema,
  imageSchema,
  isInStock,
  lowestPrice,
  priceSchema,
  productSchema,
  variantSchema,
  type Collection,
  type Image,
  type Price,
  type Product,
  type Variant,
} from "./catalog.ts";

export {
  ADMIN_SESSION_TTL_SECONDS,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  evaluateOtpRequest,
  evaluateOtpVerification,
  isAdminPhone,
  maskPhone,
  normalisePhone,
  parseAdminPhones,
  toE164,
  type OtpRequestDecision,
  type OtpRequestInput,
  type OtpVerification,
  type OtpVerificationInput,
  type OtpVerificationStatus,
} from "./auth.ts";

export {
  NO_FILTERS,
  PRICE_BANDS,
  SORTS,
  SORT_LABELS,
  applyFilters,
  filtersToQuery,
  hasActiveFilters,
  materialFacets,
  parseFilters,
  priceFacets,
  sortProducts,
  type Facet,
  type FilterState,
  type PriceBand,
  type Sort,
} from "./facets.ts";

export {
  B2CL_THRESHOLD,
  buildGstr1,
  gstinStateCode,
  isValidGstin,
  monthOf,
  type B2bInvoice,
  type B2clInvoice,
  type B2csRow,
  type Gstr1Order,
  type Gstr1Return,
} from "./gstr1.ts";
