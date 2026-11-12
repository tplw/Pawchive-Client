import { useRef } from "react";
import { Sidebar } from "./shell/Sidebar";
import { MobileTabBar } from "./shell/MobileTabBar";
import { TopBar } from "./shell/TopBar";
import { Player } from "../features/player/ui/Player";
import { Toaster } from "../shared/ui";
import { UpdateDialog } from "../features/updates";
import { ProviderPasswordDialog } from "../features/media/ui/ProviderPasswordDialog";
import { useAppStore } from "./store";
import { isMobile } from "../shared/lib/platform";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { LoadingScreen } from "./shell/LoadingScreen";
import { RoutePage } from "./routes/RoutePage";
import { useHashSync } from "./navigation/useHashSync";
import { useBootstrap } from "./bootstrap/useBootstrap";
import { useScrollRestoration } from "./navigation/useScrollRestoration";
import { useDownloadEvents } from "./events/useDownloadEvents";
import { useMobileEdgeSwipe } from "./navigation/useMobileEdgeSwipe";
import { useAndroidBack } from "./navigation/useAndroidBack";
import { useGlobalShortcuts } from "./navigation/useGlobalShortcuts";
import { useBrowserNavigation } from "./navigation/useBrowserNavigation";

export default function App() {
  const ready = useAppStore((state) => state.ready);
  const route = useAppStore((state) => state.route);
  const mainRef = useRef<HTMLElement>(null);

  useHashSync();
  useBootstrap();
  const { pageKey } = useScrollRestoration({ ready, mainRef, route });
  useDownloadEvents();
  useMobileEdgeSwipe();
  useAndroidBack();
  useGlobalShortcuts();
  useBrowserNavigation();

  if (!ready) return <LoadingScreen />;

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-base text-ink">
      {!isMobile ? <Sidebar /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main
          ref={mainRef}
          id="main-scroll"
          className="main-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-7"
        >
          <div key={pageKey} className="animate-fade-in">
            <ErrorBoundary>
              <RoutePage route={route} />
            </ErrorBoundary>
          </div>
        </main>
        <Player />
        {isMobile ? <MobileTabBar /> : null}
      </div>
      <UpdateDialog />
      <ProviderPasswordDialog />
      <Toaster />
    </div>
  );
}
