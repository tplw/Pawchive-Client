import type { MediaProvider } from "../types";
import { errorMessage, isAppError } from "./constants";
import { MEDIA_PROVIDER_LABELS } from "./format";

function providerName(provider?: MediaProvider): string {
  if (provider === "pawchive") return "archive";
  if (provider === "external") return "external host";
  if (provider) return MEDIA_PROVIDER_LABELS[provider];
  return "cloud provider";
}

/** Turn provider lookup failures into actionable playback messages. */
export function playbackErrorMessage(
  error: unknown,
  provider?: MediaProvider,
): string {
  if (!isAppError(error)) return errorMessage(error);
  const name = providerName(provider);
  if (error.code === "not_found") {
    return `This ${name} file is no longer available. It may have been removed, or the shared link may have expired.`;
  }
  if (error.code === "unavailable") {
    return `${name} could not provide this file. It may have been removed, the shared link may have expired, or the service may be temporarily unavailable.`;
  }
  if (error.code === "validation") {
    return `This ${name} link is invalid or is no longer supported.`;
  }
  return error.message;
}
