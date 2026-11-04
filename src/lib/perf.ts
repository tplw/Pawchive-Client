/**
 * Lightweight, development-only timing instrumentation. Production builds
 * compile the calls down to a boolean check and never send anything anywhere.
 */
const enabled = import.meta.env.DEV && import.meta.env.MODE !== "test";
let lastNavigation = typeof performance !== "undefined" ? performance.now() : 0;

function report(label: string, duration: number) {
  if (!enabled) return;
  console.debug(`[pawchive:perf] ${label} ${duration.toFixed(1)}ms`);
}

export function markNavigation(route: string) {
  if (!enabled) return;
  const now = performance.now();
  report(`navigation ${route}`, now - lastNavigation);
  lastNavigation = now;
}

export function recordTiming(label: string, startedAt: number) {
  if (!enabled) return;
  report(label, performance.now() - startedAt);
}
