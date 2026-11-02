import { api } from "../services/api";
import { useAppStore } from "../stores/app";
import { cn } from "../lib/format";

/**
 * Render backend-sanitized HTML. Links are intercepted and opened in the
 * system browser so the application webview never navigates away.
 */
export function SanitizedHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const reportError = useAppStore((state) => state.reportError);

  return (
    <div
      className={cn("prose-pawchive", className)}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href) return;
        event.preventDefault();
        void Promise.resolve(api.openExternal(href)).catch((error) => {
          reportError(error, "Could not open this link");
        });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
