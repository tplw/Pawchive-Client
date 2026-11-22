import { useAppStore } from "../../../app/store";
import { routeToHash } from "../../../shared/lib/router";
import type { Route } from "../../../shared/types";

function routeBelongsToCreator(
  route: Route,
  service: string,
  creatorId: string,
): boolean {
  if (route.name !== "creator" && route.name !== "post") return false;
  return (
    (route.service ?? "").toLowerCase() === service.toLowerCase() &&
    (route.creatorId ?? "").toLowerCase() === creatorId.toLowerCase()
  );
}

/**
 * Walk back past the blocked creator profile and any of their posts. This
 * keeps the surrounding playlist, search or feed context instead of showing a
 * full-page blocked notice after the block action.
 */
export function leaveBlockedCreator(
  service: string,
  creatorId: string,
): boolean {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = useAppStore.getState();
    if (!routeBelongsToCreator(state.route, service, creatorId)) return true;

    const before = routeToHash(state.route);
    state.back();
    if (routeToHash(useAppStore.getState().route) === before) {
      const current = useAppStore.getState();
      current.switchTab(current.activeTab);
      return !routeBelongsToCreator(
        useAppStore.getState().route,
        service,
        creatorId,
      );
    }
  }

  const state = useAppStore.getState();
  state.switchTab(state.activeTab);
  return !routeBelongsToCreator(
    useAppStore.getState().route,
    service,
    creatorId,
  );
}
