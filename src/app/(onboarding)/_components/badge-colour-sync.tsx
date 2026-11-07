"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { colourHex, readBadgePrefs } from "./badge-prefs";

/**
 * Applies the saved badge colour (convo_badge cookie) to the onboarding
 * wrapper before the browser paints, and again on every step change
 * (the layout stays mounted between steps). Until it first runs, the
 * wrapper's data-badge-pending keeps the stripe blank, so a fresh load
 * never flashes the default colour. No inline script: React warns about
 * scripts rendered by components.
 */
export function BadgeColourSync() {
  const marker = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();

  useLayoutEffect(() => {
    const wrapper = marker.current?.parentElement;
    if (!wrapper) return;
    wrapper.style.setProperty("--badge", colourHex(readBadgePrefs().colour));
    wrapper.removeAttribute("data-badge-pending"); // the stripe can show now
  }, [pathname]);

  return <span ref={marker} hidden />;
}
