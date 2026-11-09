import account from "../assets/menu/account.svg";
import artists from "../assets/menu/artists.svg";
import favorites from "../assets/menu/favorites.svg";
import home from "../assets/menu/home.svg";
import importIcon from "../assets/menu/import.svg";
import keys from "../assets/menu/keys.svg";
import login from "../assets/menu/login.svg";
import logout from "../assets/menu/logout.svg";
import posts from "../assets/menu/posts.svg";
import recent from "../assets/menu/recent.svg";
import search from "../assets/menu/search.svg";
import { cn } from "./lib/format";

const ICONS = {
  home,
  discover: recent,
  creators: artists,
  search,
  favorites,
  playlists: posts,
  downloads: importIcon,
  account,
  settings: keys,
  login,
  logout,
} as const;

export type SiteIconName = keyof typeof ICONS;

export function SiteIcon({
  name,
  size = 20,
  className,
  tone = "default",
}: {
  name: SiteIconName;
  size?: number;
  className?: string;
  tone?: "default" | "favorite" | "muted" | "dark";
}) {
  return (
    <img
      src={ICONS[name]}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={cn(
        "site-icon shrink-0",
        tone === "favorite" && "site-icon--favorite",
        tone === "muted" && "site-icon--muted",
        tone === "dark" && "site-icon--dark",
        className,
      )}
    />
  );
}
