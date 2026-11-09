import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Quote, RotateCw, UserRound } from "lucide-react";
import { useState } from "react";
import { api } from "../../../shared/api";
import { errorMessage } from "../../../shared/lib/constants";
import { cn, formatRelative } from "../../../shared/lib/format";
import { queryKeys } from "../../../shared/query/keys";
import { SanitizedHtml } from "../../../shared/SanitizedHtml";
import { Button, EmptyState, Spinner } from "../../../shared/ui";

type Tab = "comments" | "revisions";

/** Comments and revisions for a post, loaded lazily per tab. */
export function PostDiscussion({
  service,
  creatorId,
  postId,
}: {
  service: string;
  creatorId: string;
  postId: string;
}) {
  const [tab, setTab] = useState<Tab>("comments");
  const comments = useQuery({
    queryKey: queryKeys.comments(service, creatorId, postId),
    queryFn: ({ signal }) =>
      api.getPostComments({ service, creatorId, postId, signal }),
    enabled: tab === "comments",
    staleTime: 60_000,
  });
  const revisions = useQuery({
    queryKey: queryKeys.revisions(service, creatorId, postId),
    queryFn: ({ signal }) =>
      api.getPostRevisions({ service, creatorId, postId, signal }),
    enabled: tab === "revisions",
    staleTime: 60_000,
  });

  return (
    <section className="mt-8">
            <section className="mt-8">
              <div className="mb-3 flex gap-1 border-b border-line/60">
                <button
                  type="button"
                  onClick={() => setTab("comments")}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition",
                    tab === "comments" ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Comments
                  {comments.data?.length ? (
                    <span className="rounded-full bg-accent/12 px-1.5 py-0.5 text-[9px] text-accent">
                      {comments.data.length}
                    </span>
                  ) : null}
                  {tab === "comments" ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" />
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("revisions")}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition",
                    tab === "revisions" ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  <RotateCw className="h-3.5 w-3.5" /> Revisions
                  {tab === "revisions" ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" />
                  ) : null}
                </button>
              </div>

              {tab === "comments" ? (
                comments.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : comments.isError ? (
                  <EmptyState
                    icon={MessageSquare}
                    title="Comments unavailable"
                    message={errorMessage(comments.error)}
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => void comments.refetch()}
                      >
                        Try again
                      </Button>
                    }
                  />
                ) : comments.data?.length ? (
                  <div className="space-y-2">
                    {comments.data.map((comment) => (
                      <article
                        key={comment.id}
                        className={cn(
                          "rounded-xl border border-line/60 bg-base/20 p-3.5",
                          comment.parent_id &&
                            "ml-5 border-l-2 border-l-accent/30",
                        )}
                      >
                        <div className="mb-1.5 flex items-center gap-2 text-[10px] text-muted">
                          <UserRound className="h-3 w-3" />
                          <span className="font-medium text-ink">
                            {comment.commenter_name || comment.commenter}
                          </span>
                          <span>· {formatRelative(comment.published)}</span>
                          {comment.parent_id ? (
                            <span className="inline-flex items-center gap-1 text-accent/70">
                              <Quote className="h-2.5 w-2.5" /> reply
                            </span>
                          ) : null}
                          {comment.revisions.length ? (
                            <span className="ml-auto">
                              {comment.revisions.length} edits
                            </span>
                          ) : null}
                        </div>
                        <SanitizedHtml
                          html={comment.content}
                          className="text-xs leading-6 text-muted"
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={MessageSquare}
                    title="No comments"
                    message="The archive has no comments for this post."
                  />
                )
              ) : revisions.isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : revisions.isError ? (
                <EmptyState
                  icon={RotateCw}
                  title="Revisions unavailable"
                  message={errorMessage(revisions.error)}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => void revisions.refetch()}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : revisions.data?.length ? (
                <div className="space-y-2">
                  {revisions.data.map((revision) => (
                    <article
                      key={revision.revision_id}
                      className="rounded-xl border border-line/60 bg-base/20 p-3.5"
                    >
                      <div className="mb-1.5 flex items-center gap-2 text-[10px] text-muted">
                        <RotateCw className="h-3 w-3 text-accent/70" />
                        Revision {revision.revision_id}
                        <span>
                          ·{" "}
                          {formatRelative(
                            typeof revision.published === "number"
                              ? revision.published
                              : null,
                          )}
                        </span>
                      </div>
                      <h3 className="text-xs font-medium text-ink">
                        {typeof revision.title === "string" && revision.title
                          ? revision.title
                          : "Untitled revision"}
                      </h3>
                      <SanitizedHtml
                        html={
                          typeof revision.content === "string"
                            ? revision.content
                            : ""
                        }
                        className="mt-1 text-xs leading-6 text-muted"
                      />
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={RotateCw}
                  title="No revisions"
                  message="This post has not been edited in the archive."
                />
              )}
            </section>
    </section>
  );
}
