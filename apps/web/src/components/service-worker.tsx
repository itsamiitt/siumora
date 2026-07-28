"use client";

import { useEffect } from "react";

/**
 * Registers the offline shell.
 *
 * Deferred until after load: registration competes with the same network the
 * first paint needs, and on the ₹15k Android over 4G that plan/02 sets the
 * budget against, that trade is not worth an offline page nobody has reached
 * yet.
 *
 * Development is skipped entirely — a stale worker holding a previous build is
 * a confusing hour for whoever hits it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs the offline page and nothing else, so it
        // is not worth surfacing to a shopper.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
