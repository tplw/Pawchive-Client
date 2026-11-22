import { useEffect, useRef } from "react";
import { useAppStore } from "../../../app/store";
import { leaveBlockedCreator } from "../model/blockedNavigation";

/** Small redirect for direct links to a blocked creator or post. */
export function BlockedCreatorRedirect({
  service,
  creatorId,
}: {
  service: string;
  creatorId: string;
}) {
  const toast = useAppStore((state) => state.toast);
  const notified = useRef(false);

  useEffect(() => {
    if (notified.current) return;
    notified.current = true;
    toast(
      "info",
      "Creator blocked",
      "Unblock this creator in Settings to view their content again.",
    );
    leaveBlockedCreator(service, creatorId);
  }, [creatorId, service, toast]);

  return null;
}
