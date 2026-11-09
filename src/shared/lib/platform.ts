const userAgent =
  typeof navigator !== "undefined" ? navigator.userAgent : "";

export const isIos = /iPhone|iPad|iPod/.test(userAgent);
export const isAndroid = /Android/.test(userAgent);
export const isMobile = isIos || isAndroid;
export const isDesktop = !isMobile;
