"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { colourHex, readBadgePrefs } from "./badge-prefs";

/**
 * Keeps --badge on the onboarding wrapper in step with the convo_badge
 * cookie when moving between steps without a full page load (the layout
 * stays mounted, so its first-paint script doesn't run again). Runs before
 * paint, so the new step shows the right colour straight away.
 */
export function BadgeColourSync() {
  const marker = useRef<HTMLSpanElement>(null);
  const pathname = usePathname();

  useLayoutEffect(() => {
    const wrapper = marker.current?.parentElement;
    if (wrapper) wrapper.style.setProperty("--badge", colourHex(readBadgePrefs().colour));
  }, [pathname]);

  return <span ref={marker} hidden />;
}
