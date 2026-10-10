/**
 * The cash-on-delivery gate at checkout (auth plan phase 2) — pure, so
 * node --test can strip-type it.
 *
 * COD is where Indian e-commerce loses money: a fake or mistyped number is
 * a parcel shipped out and a courier fee paid twice when it comes back. So
 * COD asks for the delivery phone to be verified by OTP — which is the
 * same as being signed in on that number. Prepaid needs no such proof.
 *
 * And because a stolen session could otherwise send a large COD order to a
 * new address, an order above the threshold going somewhere this account
 * has never had delivered asks for a FRESH code (the StepUpGate), not just
 * a session.
 */

export interface CodGateInput {
  /** The settings lever (cod_requires_otp). Off = the gate is open. */
  readonly codRequiresOtp: boolean;
  /** The signed-in account's phone, normalised; undefined when signed out. */
  readonly signedInPhone: string | undefined;
  /** The delivery phone on the cart, normalised. */
  readonly orderPhone: string | undefined;
  readonly totalPaise: number;
  /** cod_step_up_above, paise. */
  readonly stepUpAbove: number;
  readonly isNewAddress: boolean;
  readonly stepUpFresh: boolean;
}

export type CodGateDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly body: { readonly error: "verify_phone" | "step_up_required"; readonly message: string };
    };

export function decideCodGate(input: CodGateInput): CodGateDecision {
  if (!input.codRequiresOtp) return { ok: true };

  if (!input.signedInPhone || !input.orderPhone || input.signedInPhone !== input.orderPhone) {
    return {
      ok: false,
      body: {
        error: "verify_phone",
        message: "Verify the delivery phone number to pay on delivery.",
      },
    };
  }

  if (input.totalPaise > input.stepUpAbove && input.isNewAddress && !input.stepUpFresh) {
    return {
      ok: false,
      body: {
        error: "step_up_required",
        message: "This is a new address. Confirm it's you with a fresh code to pay on delivery.",
      },
    };
  }

  return { ok: true };
}

/** An address as a comparable key: pincode + the first line, squeezed. */
export function addressKey(address: {
  postal_code?: unknown;
  address_1?: unknown;
} | null | undefined): string | undefined {
  const pincode = typeof address?.postal_code === "string" ? address.postal_code.trim() : "";
  const line = typeof address?.address_1 === "string" ? address.address_1 : "";
  const squeezed = line.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!pincode || !squeezed) return undefined;
  return `${pincode}:${squeezed}`;
}
