/**
 * The browser half of the payment handoff.
 *
 * Loads Checkout.js once and opens the provider's modal for a Razorpay order
 * the backend already created. The success handler's response is returned as
 * the payment proof: on a payment-first backend (Medusa) the proof is what
 * the order is completed with — and the backend still asks Razorpay itself
 * before placing anything. On the order-first backend (Fastify) the signed
 * webhook and the recon sweep confirm; the proof just tells the UI to move on.
 */

interface RazorpayModal {
  open(): void;
}

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: "INR";
  name: string;
  description?: string;
  prefill?: { contact?: string; name?: string };
  theme?: { color: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayModal;
  }
}

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

let scriptPromise: Promise<void> | undefined;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => {
      // Cleared so a transient network failure can retry on the next attempt
      // instead of caching the rejection forever.
      scriptPromise = undefined;
      reject(new Error("checkout.js failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type RazorpayCheckoutOutcome =
  | { kind: "paid"; proof: { orderId: string; paymentId: string; signature: string } }
  | { kind: "dismissed" }
  | { kind: "unavailable" };

export async function openRazorpayCheckout(input: {
  keyId: string;
  orderId: string;
  amountPaise: number;
  contact?: string;
  name?: string;
}): Promise<RazorpayCheckoutOutcome> {
  try {
    await loadScript();
  } catch {
    return { kind: "unavailable" };
  }
  if (!window.Razorpay) return { kind: "unavailable" };

  return new Promise<RazorpayCheckoutOutcome>((resolve) => {
    const modal = new window.Razorpay!({
      key: input.keyId,
      order_id: input.orderId,
      amount: input.amountPaise,
      currency: "INR",
      name: "Siumora",
      description: "Order payment",
      prefill: {
        ...(input.contact ? { contact: input.contact } : {}),
        ...(input.name ? { name: input.name } : {}),
      },
      // Mulberry — the single accent (brand kit rule 4).
      theme: { color: "#6B2942" },
      handler: (response) =>
        resolve({
          kind: "paid",
          proof: {
            orderId: response.razorpay_order_id,
            paymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          },
        }),
      modal: { ondismiss: () => resolve({ kind: "dismissed" }) },
    });
    modal.open();
  });
}
