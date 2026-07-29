"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";

import { getConsent, track } from "@siumora/analytics/client";

import {
  PIXEL_SCRIPT_URL,
  afterIdleOrInteraction,
  installPixelStub,
  shouldLoadPixel,
} from "@/lib/pixel";

/**
 * The Meta Pixel base, injected only after ads consent AND first
 * idle/interaction (eng review 8A). The consent banner dispatches
 * `siumora:consent` on every decision, including the restored one on a
 * return visit, so this component never polls.
 *
 * Purchase dedup needs no work here: `track()` already sends the shared
 * `event_id` to `fbq`, and the server-side CAPI send carries the same id.
 */
export function MetaPixelLoader({ pixelId }: { pixelId: string }) {
  useEffect(() => {
    let cancelled = false;

    async function loadIfConsented() {
      if (cancelled || !shouldLoadPixel(getConsent())) return;
      window.removeEventListener("siumora:consent", loadIfConsented);

      await afterIdleOrInteraction();
      if (cancelled || document.getElementById("siumora-pixel")) return;

      // Stub first: anything tracked between now and script-load queues
      // instead of vanishing.
      installPixelStub();
      window.fbq?.("init", pixelId);
      window.fbq?.("track", "PageView");

      const script = document.createElement("script");
      script.id = "siumora-pixel";
      script.async = true;
      script.src = PIXEL_SCRIPT_URL;
      document.head.appendChild(script);
    }

    window.addEventListener("siumora:consent", loadIfConsented);
    void loadIfConsented();

    return () => {
      cancelled = true;
      window.removeEventListener("siumora:consent", loadIfConsented);
    };
  }, [pixelId]);

  return null;
}

/**
 * Field Core Web Vitals through the typed event contract (W2). Without this
 * the launch gate's LCP/INP/CLS budgets are unmeasurable in production.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (
      metric.name !== "LCP" &&
      metric.name !== "INP" &&
      metric.name !== "CLS" &&
      metric.name !== "FCP" &&
      metric.name !== "TTFB"
    ) {
      return;
    }
    track("web_vitals", {
      event_id: metric.id,
      metric_name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigation_type: metric.navigationType,
    });
  });

  return null;
}
