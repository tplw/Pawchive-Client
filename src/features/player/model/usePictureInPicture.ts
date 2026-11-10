import { useCallback, useEffect, useState, type RefObject } from "react";
import { isMobile } from "../../../shared/lib/platform";

type PictureInPictureMode = "standard" | "webkit";

type WebkitVideo = HTMLVideoElement & {
  webkitSetPresentationMode?: (mode: "inline" | "picture-in-picture") => void;
  webkitPresentationMode?: string;
};

/**
 * Pick the available mobile PiP implementation. Standard Chrome/Android uses
 * requestPictureInPicture; iOS Safari exposes webkitSetPresentationMode.
 */
export function resolvePictureInPictureSupport({
  mobile = isMobile,
  enabled = typeof document !== "undefined" &&
    Boolean(document.pictureInPictureEnabled),
  standard = typeof HTMLVideoElement !== "undefined" &&
    "requestPictureInPicture" in HTMLVideoElement.prototype,
  webkit = typeof HTMLVideoElement !== "undefined" &&
    "webkitSetPresentationMode" in HTMLVideoElement.prototype,
}: {
  mobile?: boolean;
  enabled?: boolean;
  standard?: boolean;
  webkit?: boolean;
} = {}): PictureInPictureMode | null {
  if (!mobile) return null;
  if (enabled && standard) return "standard";
  if (webkit) return "webkit";
  return null;
}

/** Mobile-only Picture-in-Picture control for the persistent video element. */
export function usePictureInPicture(
  videoRef: RefObject<HTMLVideoElement | null>,
  itemId: string | null | undefined,
) {
  const mode = resolvePictureInPictureSupport();
  const supported = mode !== null;
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
    if (!supported) return;
    const video = videoRef.current as WebkitVideo | null;
    if (!video) return;
    const entered = () => setActive(true);
    const left = () => setActive(false);
    const presentationChanged = () =>
      setActive(video.webkitPresentationMode === "picture-in-picture");
    video.addEventListener("enterpictureinpicture", entered);
    video.addEventListener("leavepictureinpicture", left);
    video.addEventListener("webkitpresentationmodechanged", presentationChanged);
    return () => {
      video.removeEventListener("enterpictureinpicture", entered);
      video.removeEventListener("leavepictureinpicture", left);
      video.removeEventListener(
        "webkitpresentationmodechanged",
        presentationChanged,
      );
    };
  }, [itemId, supported, videoRef]);

  const toggle = useCallback(async () => {
    const video = videoRef.current as WebkitVideo | null;
    if (!video) return;
    try {
      if (typeof document !== "undefined" && document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (mode === "standard" && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
        return;
      }
      if (mode === "webkit" && video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode(
          video.webkitPresentationMode === "picture-in-picture"
            ? "inline"
            : "picture-in-picture",
        );
        setActive(video.webkitPresentationMode === "picture-in-picture");
      }
    } catch {
      // PiP is an enhancement; playback continues inline if it is unavailable.
    }
  }, [mode, videoRef]);

  return { supported, active, toggle };
}
