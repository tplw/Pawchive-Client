import { Download, Settings } from "lucide-react";
import type { TabName } from "../../shared/types";
import { cn } from "../../shared/lib/format";
import { switchTab } from "../../shared/lib/router";
import { useAppStore } from "../store";
import { SiteIcon, type SiteIconName } from "../../shared/SiteIcon";

const ITEMS: Array<{
  name: TabName;
  label: string;
  siteIcon?: SiteIconName;
  lucideIcon?: typeof Download;
}> = [
  { name: "home", label: "Home", siteIcon: "home" },
  { name: "discover", label: "Discover", siteIcon: "discover" },
  { name: "search", label: "Search", siteIcon: "search" },
  { name: "downloads", label: "Downloads", lucideIcon: Download },
  { name: "settings", label: "Settings", lucideIcon: Settings },
];

export function MobileTabBar() {
  const activeTab = useAppStore((state) => state.activeTab);

  return (
    <nav
      className="mobile-tabbar grid shrink-0 grid-cols-5 border-t border-line/70 bg-surface"
      aria-label="Primary navigation"
    >
      {ITEMS.map((item) => {
        const Icon = item.lucideIcon;
        const isActive = activeTab === item.name;
        return (
          <button
            key={item.name}
            type="button"
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            onClick={() => switchTab(item.name)}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-1 py-2 text-[9px] transition",
              isActive ? "text-accent" : "text-muted",
            )}
          >
            {item.siteIcon ? (
              <SiteIcon
                name={item.siteIcon}
                size={20}
                className={isActive ? "site-icon--active" : undefined}
              />
            ) : Icon ? (
              <Icon className="h-5 w-5" />
            ) : null}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
