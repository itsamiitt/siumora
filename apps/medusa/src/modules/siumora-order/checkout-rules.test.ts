import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COD_FEE_KEY,
  FOLDED_AMOUNT_KEY,
  PAYMENTS_PAUSED,
  PAYMENT_METHOD_KEY,
  SHIPPING_BASE_KEY,
  cartVersion,
  codFeeOf,
  decideCompletion,
  foldCodFee,
  paiseToMajor,
  parseCompleteBody,
  paymentMethodOf,
  quoteTotals,
  validateCheckoutAddress,
  couponSpellings,
  parseCouponBody,
  cleanGiftMessage,
} from "./checkout-rules.ts";

const COD_OK = { available: true, fee: 4900, verification: "none", partialPayment: 0 } as const;
const COD_WITHHELD = {
  available: false,
  fee: 0,
  verification: "none",
  partialPayment: 0,
  reason: "Not available for this pincode",
} as const;

const ADDRESS = {
  first_name: "Asha",
  last_name: "Menon",
  phone: "9812345678",
  address_1: "Flat 4B, Sea View, Marine Drive",
  city: "Mumbai",
  province: "27",
  postal_code: "400001",
};

/** A 5% line under the free-shipping threshold. */
const LINE = {
  variantId: "variant_1",
  sku: "PS-GLD",
  productHandle: "petal-studs",
  title: "Petal Studs",
  variantTitle: "Gold",
  imageUrl: "",
  mrp: 59900,
  unitPrice: 49900,
  quantity: 1,
  gstSlab: 5,
  hsn: "7117",
  piercedJewellery: true,
} as const;

// ── parseCompleteBody ──────────────────────────────────────────────────────

test("an empty body is COD — the transport that predates the field", () => {
  assert.deepEqual(parseCompleteBody({}), { ok: true, value: { paymentMethod: "cod" } });
  assert.deepEqual(parseCompleteBody(undefined), { ok: true, value: { paymentMethod: "cod" } });
});

test("a named method is kept, an unknown one refused", () => {
  assert.deepEqual(parseCompleteBody({ paymentMethod: "cod" }), {
    ok: true,
    value: { paymentMethod: "cod" },
  });
  assert.equal(parseCompleteBody({ paymentMethod: "bitcoin" }).ok, false);
  assert.equal(parseCompleteBody({ paymentMethod: 7 }).ok, false);
});

// ── decideCompletion ───────────────────────────────────────────────────────

test("COD to a serviceable pincode completes with the server's fee", () => {
  assert.deepEqual(
    decideCompletion({ paymentMethod: "cod", serviceable: true, cod: COD_OK, prepaidAvailable: false }),
    { ok: true, codFee: 4900 },
  );
});

test("prepaid is refused while Razorpay is not connected", () => {
  const decision = decideCompletion({ paymentMethod: "upi", serviceable: true, cod: COD_OK, prepaidAvailable: false });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.refusal.status, 409);
    assert.equal(decision.refusal.body.error, "prepaid_unavailable");
  }
});

test("an unserviceable pincode is refused before COD terms are considered", () => {
  const decision = decideCompletion({ paymentMethod: "cod", serviceable: false, cod: COD_OK, prepaidAvailable: false });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.refusal.body.error, "not_serviceable");
});

test("COD withheld by the courier is refused with the engine's reason", () => {
  const decision = decideCompletion({ paymentMethod: "cod", serviceable: true, cod: COD_WITHHELD, prepaidAvailable: false });
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.refusal.body.error, "cod_unavailable");
    assert.equal(decision.refusal.body.message, "Not available for this pincode");
  }
});

test("the kill-switch refusal speaks the Fastify words", () => {
  assert.equal(PAYMENTS_PAUSED.status, 503);
  assert.equal(PAYMENTS_PAUSED.body.error, "payments_paused");
  assert.match(PAYMENTS_PAUSED.body.message, /Nothing was charged/);
});

// ── validateCheckoutAddress ────────────────────────────────────────────────

test("a complete address passes", () => {
  assert.deepEqual(validateCheckoutAddress(ADDRESS), { ok: true });
});

test("a phone with +91 and spaces still passes", () => {
  assert.deepEqual(validateCheckoutAddress({ ...ADDRESS, phone: "+91 98123 45678" }), { ok: true });
});

test("every missing field is named, keyed to the storefront's fields", () => {
  const result = validateCheckoutAddress({});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.status, 400);
    assert.equal(result.refusal.body.error, "invalid_address");
    assert.deepEqual(Object.keys(result.refusal.body.fields ?? {}).sort(), [
      "city",
      "line1",
      "name",
      "phone",
      "pincode",
      "stateCode",
    ]);
    // The headline message is the first problem, so a toast still reads.
    assert.equal(result.refusal.body.message, "Enter the name for delivery.");
  }
});

test("a blank-looking address line and a malformed state are refused", () => {
  const result = validateCheckoutAddress({ ...ADDRESS, address_1: "  x ", province: "MH" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(Object.keys(result.refusal.body.fields ?? {}).sort(), ["line1", "stateCode"]);
  }
});

test("a landline or short number is not a delivery phone", () => {
  const result = validateCheckoutAddress({ ...ADDRESS, phone: "02212345678" });
  assert.equal(result.ok, false);
});

// ── COD fee fold ───────────────────────────────────────────────────────────

test("the fee folds into the shipping amount and the split is recorded", () => {
  assert.deepEqual(foldCodFee({ amountPaise: 7900, data: {} }, 4900), {
    amountPaise: 12800,
    data: { [SHIPPING_BASE_KEY]: 7900, [COD_FEE_KEY]: 4900, [FOLDED_AMOUNT_KEY]: 12800 },
  });
});

test("a method Medusa repriced since the last fold takes its new amount as the base", () => {
  const folded = foldCodFee({ amountPaise: 7900, data: {} }, 4900);
  // The bag crossed ₹999: Medusa repriced the method to free, data kept.
  const repriced = foldCodFee({ amountPaise: 0, data: folded.data }, 4900);
  assert.equal(repriced.amountPaise, 4900);
  assert.equal(repriced.data[SHIPPING_BASE_KEY], 0);
});

test("folding twice never stacks a second fee", () => {
  const once = foldCodFee({ amountPaise: 7900, data: null }, 4900);
  const twice = foldCodFee({ amountPaise: once.amountPaise, data: once.data }, 4900);
  assert.equal(twice.amountPaise, 12800);
  assert.equal(twice.data[COD_FEE_KEY], 4900);
});

test("a zero fee restores the base charge", () => {
  const folded = foldCodFee({ amountPaise: 7900, data: {} }, 4900);
  const cleared = foldCodFee({ amountPaise: folded.amountPaise, data: folded.data }, 0);
  assert.equal(cleared.amountPaise, 7900);
  assert.equal(cleared.data[COD_FEE_KEY], 0);
});

test("other data on the method survives the fold", () => {
  const folded = foldCodFee({ amountPaise: 0, data: { carrier: "x" } }, 4900);
  assert.equal(folded.data.carrier, "x");
});

test("codFeeOf reads the recorded fee and ignores anything else", () => {
  assert.equal(codFeeOf([{ data: { [COD_FEE_KEY]: 4900 } }, { data: null }, null]), 4900);
  assert.equal(codFeeOf([{ data: { [COD_FEE_KEY]: "49" } }]), 0);
  assert.equal(codFeeOf(undefined), 0);
});

test("paiseToMajor is exact for whole paise and refuses fractions", () => {
  assert.equal(paiseToMajor(12800), 128);
  assert.equal(paiseToMajor(7949), 79.49);
  assert.throws(() => paiseToMajor(1.5));
});

// ── quoteTotals ────────────────────────────────────────────────────────────

test("prepaid and COD totals differ by exactly the fee", () => {
  const quoted = quoteTotals([LINE], { stateCode: "27", cod: COD_OK });
  assert.equal(quoted.prepaid.subtotal, 49900);
  assert.equal(quoted.prepaid.shipping, 7900);
  assert.equal(quoted.prepaid.codFee, 0);
  assert.equal(quoted.prepaid.total, 57800);
  assert.ok(quoted.cod);
  assert.equal(quoted.cod!.total - quoted.prepaid.total, 4900);
  assert.equal(quoted.interState, false);
});

test("an out-of-state address is quoted with IGST, not CGST+SGST", () => {
  const quoted = quoteTotals([LINE], { stateCode: "29", cod: COD_OK });
  assert.equal(quoted.interState, true);
  assert.equal(quoted.prepaid.gst.cgst, 0);
  assert.equal(quoted.prepaid.gst.sgst, 0);
  assert.ok(quoted.prepaid.gst.igst > 0);
});

test("tax is contained in the total, never added to it", () => {
  const { prepaid } = quoteTotals([LINE], { stateCode: "27", cod: COD_OK });
  const { taxableValue, cgst, sgst, igst } = prepaid.gst;
  assert.equal(taxableValue + cgst + sgst + igst, prepaid.total);
});

test("withheld COD quotes no COD total", () => {
  assert.equal(quoteTotals([LINE], { stateCode: "27", cod: COD_WITHHELD }).cod, null);
});

test("an unknown state is quoted intra-state, and says so", () => {
  assert.equal(quoteTotals([LINE], { cod: COD_OK }).interState, false);
});

// ── cartVersion ────────────────────────────────────────────────────────────

test("the cart version ignores line order but not quantity or price", () => {
  const a = { variantId: "a", quantity: 1, unitPrice: 100 };
  const b = { variantId: "b", quantity: 2, unitPrice: 200 };
  assert.equal(cartVersion([a, b]), cartVersion([b, a]));
  assert.notEqual(cartVersion([a, b]), cartVersion([a, { ...b, quantity: 3 }]));
  assert.notEqual(cartVersion([a, b]), cartVersion([a, { ...b, unitPrice: 201 }]));
  assert.match(cartVersion([a]), /^[0-9a-f]{16}$/);
});

// ── Phase B: prepaid ───────────────────────────────────────────────────────

test("prepaid with Razorpay connected completes with no COD fee, even where COD is withheld", () => {
  assert.deepEqual(
    decideCompletion({ paymentMethod: "upi", serviceable: true, cod: COD_WITHHELD, prepaidAvailable: true }),
    { ok: true, codFee: 0 },
  );
});

test("prepaid still needs a pincode the courier serves", () => {
  const decision = decideCompletion({
    paymentMethod: "card",
    serviceable: false,
    cod: COD_OK,
    prepaidAvailable: true,
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.refusal.body.error, "not_serviceable");
});

test("a prepaid completion must carry the full Checkout.js proof", () => {
  assert.equal(parseCompleteBody({ paymentMethod: "upi" }).ok, false);
  assert.equal(
    parseCompleteBody({ paymentMethod: "upi", razorpay: { orderId: "order_1", paymentId: "pay_1" } }).ok,
    false,
  );
  assert.deepEqual(
    parseCompleteBody({
      paymentMethod: "upi",
      razorpay: { orderId: "order_1", paymentId: "pay_1", signature: "abc" },
    }),
    {
      ok: true,
      value: {
        paymentMethod: "upi",
        proof: { orderId: "order_1", paymentId: "pay_1", signature: "abc" },
      },
    },
  );
});

test("COD ignores any proof it is sent", () => {
  assert.deepEqual(parseCompleteBody({ paymentMethod: "cod", razorpay: { orderId: "x" } }), {
    ok: true,
    value: { paymentMethod: "cod" },
  });
});

test("the order's method is read from metadata, COD when absent or unknown", () => {
  assert.equal(paymentMethodOf({ [PAYMENT_METHOD_KEY]: "upi" }), "upi");
  assert.equal(paymentMethodOf({ [PAYMENT_METHOD_KEY]: "bitcoin" }), "cod");
  assert.equal(paymentMethodOf(null), "cod");
});

test("parseCouponBody trims a code and refuses what cannot be one", () => {
  assert.deepEqual(parseCouponBody({ cartId: "cart_1", code: "  diwali10 " }), { ok: true, cartId: "cart_1", code: "diwali10" });
  assert.equal(parseCouponBody({ cartId: "cart_1", code: "10" }).ok, false);
  assert.equal(parseCouponBody({ cartId: "cart_1", code: "free stuff please" }).ok, false);
  assert.equal(parseCouponBody({ code: "DIWALI10" }).ok, false);
  assert.deepEqual(couponSpellings("diwali10"), ["diwali10", "DIWALI10"]);
  assert.deepEqual(couponSpellings("DIWALI10"), ["DIWALI10"]);
});

test("quoteTotals takes a coupon off the total and judges free shipping after it", () => {
  const line = {
    variantId: "v1", sku: "S", productHandle: "p", title: "t", variantTitle: "", imageUrl: "",
    mrp: 120000, unitPrice: 100000, quantity: 1, gstSlab: 5 as const, hsn: "7113", piercedJewellery: false,
  };
  const cod = { available: false } as Parameters<typeof quoteTotals>[1]["cod"];
  const plain = quoteTotals([line], { cod });
  assert.equal(plain.prepaid.shipping, 0);
  assert.equal(plain.prepaid.discount, 0);
  // ₹1,000 less ₹100 is under the ₹999 threshold: shipping comes back.
  const couponed = quoteTotals([{ ...line, discount: 10000 }], { cod });
  assert.equal(couponed.prepaid.discount, 10000);
  assert.equal(couponed.prepaid.shipping, 7900);
  assert.equal(couponed.prepaid.total, 100000 - 10000 + 7900);
});

test("cleanGiftMessage: tidied, bounded, and dropped when switched off", () => {
  assert.deepEqual(cleanGiftMessage("  Happy\nbirthday,\t Asha!  ", true), { ok: true, value: "Happy birthday, Asha!" });
  assert.deepEqual(cleanGiftMessage("Happy birthday", false), { ok: true, value: undefined });
  assert.deepEqual(cleanGiftMessage("   ", true), { ok: true, value: undefined });
  const long = cleanGiftMessage("x".repeat(151), true);
  assert.equal(long.ok, false);
  assert.match((long as { refusal: { body: { fields: { giftMessage: string } } } }).refusal.body.fields.giftMessage, /150/);
});
