import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { goBack, goForward, routeTitle } from "../../shared/lib/router";
import { currentWindow } from "../../shared/lib/window";
import { useAppStore } from "../store";
import { IconButton } from "../../shared/ui";
import { isMobile } from "../../shared/lib/platform";
import { BrandPaw } from "./BrandPaw";

export function TopBar() {
  const route = useAppStore((state) => state.route);
  const activeTab = useAppStore((state) => state.activeTab);
  const tabs = useAppStore((state) => state.tabs);
  const indexState = useAppStore((state) => state.indexState);
  const tab = tabs[activeTab];
  const canGoBack = tab.index > 0;
  const canGoForward = tab.index < tab.stack.length - 1;

  if (isMobile) {
    return (
      <header className="topbar flex shrink-0 items-center justify-between gap-2 border-b border-line/60 bg-base/90 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {canGoBack ? (
            <IconButton
              label="Back"
              icon={ArrowLeft}
              size="md"
              className="h-10 w-10 shrink-0"
              onClick={() => goBack()}
            />
          ) : null}
          <h1 className="truncate px-1 text-[15px] font-bold text-ink">
            {routeTitle(route)}
          </h1>
        </div>
        <BrandPaw size={30} />
      </header>
    );
  }

  return (
    <header className="topbar flex shrink-0 items-center gap-2 border-b border-line/55 px-4 sm:px-6">
      <div className="flex items-center gap-0.5">
        <IconButton
          label="Back"
          icon={ArrowLeft}
          size="sm"
          disabled={!canGoBack}
          onClick={() => goBack()}
        />
        <IconButton
          label="Forward"
          icon={ArrowRight}
          size="sm"
          disabled={!canGoForward}
          onClick={goForward}
        />
      </div>
      <div
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const win = currentWindow();
          if (win) void win.startDragging().catch(() => undefined);
        }}
        className="ml-1 min-w-0 flex-1 self-stretch"
      >
        <h1 className="flex h-full items-center truncate text-[13px] font-medium text-ink">
          {routeTitle(route)}
        </h1>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {indexState === "syncing" ? (
          <span className="hidden items-center gap-1.5 text-[10px] text-muted sm:inline-flex">
            <LoaderCircle className="h-3 w-3 animate-spin text-accent" />
            Indexing creators…
          </span>
        ) : null}
      </div>
    </header>
  );
}
