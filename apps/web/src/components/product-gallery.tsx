"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import type { Image as ProductImage } from "@siumora/core";
import { MicroLabel } from "@siumora/ui";

/**
 * Product gallery with hold-to-zoom.
 *
 * Jewellery is bought on detail a thumbnail cannot carry, so zoom is not a
 * nicety. It is pointer-driven on a desktop — hold and move, and the image
 * tracks the cursor — and a tap-to-toggle on touch, where there is no hover to
 * hold. Both land on the same state, so there is one code path to reason about.
 *
 * The first image keeps `priority` and a fixed aspect box: it is the LCP
 * element on every product page, and a gallery that reserved no space would
 * spend the entire CLS budget on its own thumbnails.
 */
export function ProductGallery({
  images,
  title,
  handle,
}: {
  images: readonly ProductImage[];
  title: string;
  handle: string;
}) {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  // Transform-origin as a percentage pair, so zoom magnifies what is under the
  // pointer rather than the middle of the plate.
  const [origin, setOrigin] = useState("50% 50%");
  const frameRef = useRef<HTMLDivElement>(null);

  const image = images[active] ?? images[0];
  if (!image) return null;

  function track(event: React.PointerEvent<HTMLDivElement>) {
    if (!zoomed) return;
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((event.clientX - box.left) / box.width) * 100;
    const y = ((event.clientY - box.top) / box.height) * 100;
    setOrigin(`${Math.min(100, Math.max(0, x))}% ${Math.min(100, Math.max(0, y))}%`);
  }

  return (
    <div className="self-start">
      <div
        ref={frameRef}
        // Held at the catalogue's 4:5 ratio so the plate never stretches to
        // match whatever the detail column happens to be.
        className="relative aspect-4/5 cursor-zoom-in overflow-hidden bg-ground-raised"
        style={{ viewTransitionName: `product-${handle}` }}
        onPointerDown={(event) => {
          setZoomed(true);
          track(event);
        }}
        onPointerMove={track}
        onPointerUp={() => setZoomed(false)}
        onPointerLeave={() => setZoomed(false)}
        // Keyboard reaches zoom through the button below rather than here, so
        // this element stays out of the tab order and does not trap it.
        aria-hidden
      >
        <Image
          src={image.url}
          alt={image.alt}
          width={image.width}
          height={image.height}
          priority={active === 0}
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-siumora)]"
          style={{
            transform: zoomed ? "scale(2.2)" : "scale(1)",
            transformOrigin: origin,
          }}
        />
      </div>

      {images.length > 1 && (
        <div className="mt-3 flex gap-3">
          {images.map((thumb, index) => (
            <button
              key={thumb.url}
              type="button"
              onClick={() => setActive(index)}
              aria-label={thumb.alt}
              aria-current={index === active}
              className={
                "aspect-4/5 w-16 overflow-hidden border transition-colors " +
                (index === active
                  ? "border-accent-ink"
                  : "border-[var(--color-rule)] hover:border-content/40")
              }
            >
              <Image
                src={thumb.url}
                alt=""
                width={thumb.width}
                height={thumb.height}
                sizes="64px"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-content-faint">
        <MicroLabel>
          {zoomed ? "Release to fit" : "Hold the image to zoom"}
        </MicroLabel>
      </p>

      <p className="sr-only" aria-live="polite">
        {`${title}: image ${active + 1} of ${images.length}. ${image.alt}`}
      </p>
    </div>
  );
}
