import { useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import {
  findBlockedCreator,
  removeBlockedCreator,
} from "../lib/blockedCreators";
import { goBack } from "../lib/router";
import { useAppStore } from "../stores/app";
import { Button, EmptyState } from "./ui";

/** Shown instead of a creator profile or post from a blocked creator. */
export function BlockedCreatorNotice({
  service,
  id,
}: {
  service: string;
  id: string;
}) {
  const blocked = useAppStore(
    (state) => state.settings.blockedCreators ?? [],
  );
  const saveSettings = useAppStore((state) => state.saveSettings);
  const queryClient = useQueryClient();
  const creator = findBlockedCreator(blocked, service, id);
  const name = creator?.name || id;

  const unblock = async () => {
    await saveSettings({
      blockedCreators: removeBlockedCreator(blocked, service, id),
    });
    await queryClient.invalidateQueries();
  };

  return (
    <div className="mx-auto max-w-2xl py-10">
      <EmptyState
        icon={Ban}
        title="Creator blocked"
        message={`${name} and all posts from this creator are hidden. Unblock the creator to view the profile and content again.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => goBack()}>
              Go back
            </Button>
            <Button variant="primary" onClick={() => void unblock()}>
              Unblock creator
            </Button>
          </div>
        }
      />
    </div>
  );
}
