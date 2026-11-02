import {
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TabName } from "../types";
import { cn } from "../lib/format";
import { switchTab } from "../lib/router";
import { currentWindow } from "../lib/window";
import { useAppStore } from "../stores/app";
import { SiteIcon, type SiteIconName } from "./SiteIcon";
import { BrandPaw } from "./BrandPaw";

const PRIMARY: Array<{
  name: TabName;
  label: string;
  siteIcon: SiteIconName;
  shortcut: string;
}> = [
  { name: "home", label: "Home", siteIcon: "home", shortcut: "1" },
  { name: "discover", label: "Discover", siteIcon: "discover", shortcut: "2" },
  { name: "search", label: "Search", siteIcon: "search", shortcut: "3" },
];

const SECONDARY: Array<{
  name: TabName;
  label: string;
  siteIcon?: SiteIconName;
  lucideIcon?: LucideIcon;
}> = [
  { name: "downloads", label: "Downloads", lucideIcon: Download },
  { name: "settings", label: "Settings", lucideIcon: Settings },
];

function NavButton({
  name,
  label,
  siteIcon,
  lucideIcon: Lucide,
  shortcut,
  collapsed,
  active,
}: {
  name: TabName;
  label: string;
  siteIcon?: SiteIconName;
  lucideIcon?: LucideIcon;
  shortcut?: string;
  collapsed: boolean;
  active: boolean;
}) {
  return (
    <button
      type="button"
      title={collapsed ? label : undefined}
      onClick={() => switchTab(name)}
      className={cn(
        "group relative flex h-[34px] w-full items-center gap-2.5 px-2.5 text-left text-[13px] outline-none transition",
        active
          ? "bg-white/10 font-bold text-ink"
          : "text-muted hover:bg-white/10 hover:text-ink",
        collapsed && "justify-center px-0",
      )}
    >
      {siteIcon ? (
        <SiteIcon
          name={siteIcon}
          size={20}
          className={cn(active && "site-icon--active")}
        />
      ) : Lucide ? (
        <Lucide
          className={cn(
            "h-5 w-5 shrink-0",
            active ? "text-accent" : "text-current",
          )}
        />
      ) : null}
      {!collapsed ? (
        <>
          <span className="truncate">{label}</span>
          {shortcut ? (
            <span className="ml-auto text-[9px] text-dim">⌘{shortcut}</span>
          ) : null}
        </>
      ) : null}
    </button>
  );
}

export function Sidebar() {
  const activeTab = useAppStore((state) => state.activeTab);
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const collapsed = !settings.sidebarVisible || narrow;

  return (
    <aside
      className={cn(
        "app-sidebar relative z-30 flex h-full shrink-0 flex-col border-r border-line/70 bg-surface transition-[width] duration-200",
        collapsed ? "w-[64px]" : "w-[192px]",
      )}
    >
      <div
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const win = currentWindow();
          if (win) void win.startDragging().catch(() => undefined);
        }}
        className={cn(
          "sidebar-brand flex shrink-0 items-center gap-2.5 px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <BrandPaw size={36} />
        {!collapsed ? (
          <div className="sidebar-label min-w-0">
            <p className="truncate text-[15px] font-bold tracking-tight text-ink">
              Pawchive
            </p>
            <p className="text-[9px] uppercase tracking-[0.18em] text-dim">
              Desktop
            </p>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {PRIMARY.map((item) => (
          <NavButton
            key={item.name}
            {...item}
            collapsed={collapsed}
            active={activeTab === item.name}
          />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-line/60 px-2 py-3">
        {SECONDARY.map((item) => (
          <NavButton
            key={item.name}
            {...item}
            collapsed={collapsed}
            active={activeTab === item.name}
          />
        ))}
        {!narrow ? (
          <button
            type="button"
            onClick={() => void saveSettings({ sidebarVisible: collapsed })}
            className={cn(
            "mt-1 flex h-[34px] w-full items-center gap-2.5 px-2.5 text-[12px] text-dim transition hover:bg-white/10 hover:text-ink",
            collapsed && "justify-center px-0",
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
            {!collapsed ? (
              <span className="sidebar-label">Collapse sidebar</span>
            ) : null}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
