import type { UseQueryResult } from "@tanstack/react-query";
import { ExternalLink, Info, Link2 } from "lucide-react";
import { errorMessage } from "../../../shared/lib/constants";
import { formatDate } from "../../../shared/lib/format";
import { navigate } from "../../../shared/lib/router";
import { CreatorAvatar } from "./CreatorVisuals";
import { Spinner } from "../../../shared/ui";
import { serviceLabel } from "../../../shared/lib/constants";
import type { CreatorProfile, CreatorSummary } from "../../../shared/types";

export function CreatorAbout({
  service,
  creatorId,
  summary,
  details,
  updated,
  links,
}: {
  service: string;
  creatorId: string;
  summary: CreatorSummary | null | undefined;
  details: CreatorProfile | undefined;
  updated: number | null | undefined;
  links: UseQueryResult<CreatorProfile[], Error>;
}) {
  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-2xl border border-line/70 bg-surface/40 p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
              About
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted">
              {details?.description?.trim() ||
                "The archive does not expose a written description for this creator."}
            </p>
            <div className="mt-6 border-t border-line/60 pt-4">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                <Link2 className="h-3.5 w-3.5" /> Linked accounts
              </p>
              {links.isLoading ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                  <Spinner className="h-4 w-4" /> Loading links…
                </div>
              ) : links.isError ? (
                <p className="mt-3 text-xs text-muted">
                  {errorMessage(links.error)}
                </p>
              ) : links.data && links.data.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  {links.data.map((link) => (
                    <button
                      key={`${link.service}:${link.id}`}
                      type="button"
                      onClick={() =>
                        navigate({
                          name: "creator",
                          service: link.service,
                          creatorId: link.id,
                        })
                      }
                      className="flex w-full items-center gap-3 rounded-xl border border-line/60 bg-base/20 px-3 py-2.5 text-left transition hover:border-accent/30 hover:bg-base/40"
                    >
                      <CreatorAvatar
                        service={link.service}
                        id={link.id}
                        name={link.name}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink">
                          {link.name}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted">
                          {serviceLabel(link.service)}
                        </span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-muted" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">
                  No linked accounts are available.
                </p>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-line/70 bg-base/25 p-4 text-[10px] text-muted">
              <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em]">
                Creator details
              </p>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt>Service</dt>
                  <dd className="text-ink">{serviceLabel(service)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Creator ID</dt>
                  <dd className="max-w-36 truncate text-ink">{creatorId}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Indexed</dt>
                  <dd className="text-ink">{formatDate(summary?.indexed)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Updated</dt>
                  <dd className="text-ink">{formatDate(updated)}</dd>
                </div>
              </dl>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/[0.055] p-3 text-[10px] leading-relaxed text-accent/80">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Descriptions and links are shown only when the archive provides them.
            </div>
          </aside>
    </section>
  );
}

