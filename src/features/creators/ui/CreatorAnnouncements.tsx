import type { UseQueryResult } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { errorMessage } from "../../../shared/lib/constants";
import { formatDate } from "../../../shared/lib/format";
import { SanitizedHtml } from "../../../shared/SanitizedHtml";
import { Badge, Button, EmptyState, SectionHeader, Spinner } from "../../../shared/ui";
import type { Announcement } from "../../../shared/types";

export function CreatorAnnouncements({
  announcements,
}: {
  announcements: UseQueryResult<Announcement[], Error>;
}) {
  return (
    <section className="mt-6">
          <SectionHeader
            eyebrow="From the creator"
            title="Announcements"
            description="Public announcements archived by Pawchive."
          />
          {announcements.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : announcements.isError ? (
            <EmptyState
              icon={Bell}
              title="Announcements unavailable"
              message={errorMessage(announcements.error)}
              action={
                <Button
                  variant="secondary"
                  onClick={() => void announcements.refetch()}
                >
                  Try again
                </Button>
              }
            />
          ) : announcements.data && announcements.data.length > 0 ? (
            <div className="space-y-3">
              {announcements.data.map((announcement) => (
                <article
                  key={announcement.hash}
                  className="rounded-xl border border-line/70 bg-surface/40 p-4"
                >
                  <div className="mb-2 flex items-center gap-2 text-[10px] text-muted">
                    <Badge tone="accent">Announcement</Badge>
                    <span>{formatDate(announcement.added)}</span>
                  </div>
                  <SanitizedHtml
                    html={announcement.content}
                    className="text-xs leading-6 text-muted"
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Bell}
              title="No announcements"
              message="This creator has no archived announcements."
            />
          )}
    </section>
  );
}

