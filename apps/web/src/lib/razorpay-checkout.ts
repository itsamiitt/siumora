/**
 * The browser half of the payment handoff.
 *
 * Loads Checkout.js once and opens the provider's modal for an order the API
 * already created. Confirmation is deliberately NOT driven from here: the
 * signed webhook and the reconciliation sweep are the authority on whether
 * money moved, so the handler resolving only tells the UI where to navigate —
 * an order page that renders whatever the server knows to be true.
 */

interface RazorpayModal {
  open(): void;
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
  handler: () => void;
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

export type RazorpayCheckoutOutcome = "paid" | "dismissed" | "unavailable";

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
    return "unavailable";
  }
  if (!window.Razorpay) return "unavailable";

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
      handler: () => resolve("paid"),
      modal: { ondismiss: () => resolve("dismissed") },
    });
    modal.open();
  });
}
