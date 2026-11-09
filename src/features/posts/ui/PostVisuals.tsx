import { AlertTriangle } from "lucide-react";
import { cn } from "../../../lib/format";

/** Pawchive's red warning marker for posts that lost files to the size limit. */
export function ExceedsLimitBadge({ className }: { className?: string }) {
  const title =
    "Some files exceed the archive size limit and weren't saved";
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center rounded border border-[#e0483d]/35 bg-[#e0483d]/12 px-1 py-0.5 text-[#e0483d]",
        className,
      )}
    >
      <AlertTriangle className="h-3 w-3" />
    </span>
  );
}
