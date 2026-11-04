import { useEffect, useState } from "react";

function isLandscapeNow(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(orientation: landscape)");
  if (media) return media.matches;
  return window.innerWidth > window.innerHeight;
}

/** Tracks phone/tablet orientation so immersive controls only hide in landscape. */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(isLandscapeNow);

  useEffect(() => {
    const media = window.matchMedia?.("(orientation: landscape)");
    const update = () => setLandscape(isLandscapeNow());
    update();
    media?.addEventListener?.("change", update);
    media?.addListener?.(update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      media?.removeEventListener?.("change", update);
      media?.removeListener?.(update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return landscape;
}
