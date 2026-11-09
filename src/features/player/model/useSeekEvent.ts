import { useEffect, type RefObject } from "react";

/** Apply seek requests dispatched by the player store. */
export function useSeekEvent(videoRef: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    const onSeek = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      if (videoRef.current && Number.isFinite(detail)) {
        videoRef.current.currentTime = detail;
      }
    };
    window.addEventListener("pawchive:seek", onSeek);
    return () => window.removeEventListener("pawchive:seek", onSeek);
  }, [videoRef]);
}
