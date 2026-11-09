import { useEffect, useRef } from "react";
import { useAppStore } from "../../stores/app";
import { usePlayerStore } from "../../player/store";
import { hexToRgbTriplet } from "../../lib/format";

/** One-time app startup, theme application and player settings sync. */
export function useBootstrap() {
  const ready = useAppStore((state) => state.ready);
  const settings = useAppStore((state) => state.settings);
  const initialize = useAppStore((state) => state.initialize);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void initialize();
  }, [initialize]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = settings.reduceMotion
      ? "true"
      : "false";
  }, [settings.reduceMotion]);

  useEffect(() => {
    const triplet = hexToRgbTriplet(settings.accentColor) ?? "214 174 168";
    document.documentElement.style.setProperty("--accent", triplet);
    const [r, g, b] = triplet.split(" ").map(Number);
    document.documentElement.style.setProperty(
      "--accent-soft",
      `${Math.round(r * 0.36)} ${Math.round(g * 0.36)} ${Math.round(b * 0.36)}`,
    );
  }, [settings.accentColor]);

  useEffect(() => {
    if (!ready) return;
    const player = usePlayerStore.getState();
    player.setVolume(settings.volume);
    player.setSpeed(settings.playbackSpeed);
  }, [ready, settings.volume, settings.playbackSpeed]);
}
