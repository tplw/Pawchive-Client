import { useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { usePlayerStore } from "../../features/player/model/store";
import { hexToRgbTriplet } from "../../shared/lib/format";

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

  useEffect(() => {
    if (!ready) return;
    // The store decides whether the index is old enough to download again,
    // so this hourly check is cheap while the app stays open.
    const timer = window.setInterval(() => {
      void useAppStore.getState().ensureCreatorIndex();
    }, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready]);
}
