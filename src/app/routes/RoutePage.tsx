import { CreatorsPage, CreatorProfilePage } from "../../features/creators";
import { DownloadsPage } from "../../features/downloads";
import { HomePage, PlaylistPage } from "../../features/playlists";
import { DiscoverPage, PostDetailPage } from "../../features/posts";
import { SearchPage } from "../../features/search";
import { SettingsPage } from "../../features/settings";
import type { Route } from "../../types";

export function RoutePage({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "discover":
      return <DiscoverPage />;
    case "creators":
      return <CreatorsPage query={route.query ?? ""} />;
    case "creator":
      if (route.service && route.creatorId) {
        return (
          <CreatorProfilePage
            service={route.service}
            creatorId={route.creatorId}
          />
        );
      }
      return <CreatorsPage />;
    case "post":
      if (route.service && route.creatorId && route.postId) {
        return (
          <PostDetailPage
            key={`${route.service}:${route.creatorId}:${route.postId}`}
            service={route.service}
            creatorId={route.creatorId}
            postId={route.postId}
          />
        );
      }
      return <DiscoverPage />;
    case "search":
      return <SearchPage query={route.query ?? ""} />;
    case "playlist":
      return route.playlistId ? (
        <PlaylistPage playlistId={route.playlistId} />
      ) : (
        <HomePage />
      );
    case "downloads":
      return <DownloadsPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}
