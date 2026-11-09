import { Download, Sparkles } from "lucide-react";
import { api } from "../../../shared/api";
import { pendingUpdateVersion, useAppStore } from "../../../app/store";
import { Button, Modal } from "../../../shared/ui";

/**
 * One-time announcement for a new release.
 *
 * The prompt is derived from the last checked release and the version the user
 * dismissed. Dismissing any way (button, Escape, backdrop) persists that
 * version, so the prompt stays hidden until a newer release appears.
 */
export function UpdateDialog() {
  const info = useAppStore((state) => state.updateInfo);
  const dismissedVersion = useAppStore(
    (state) => state.settings.dismissedUpdateVersion,
  );
  const dismissUpdate = useAppStore((state) => state.dismissUpdate);

  const version = pendingUpdateVersion(info, {
    dismissedUpdateVersion: dismissedVersion,
  });

  if (!info || !version) return null;

  const dismiss = () => {
    void dismissUpdate();
  };

  const openRelease = () => {
    void api.openExternal(info.url).catch(() => undefined);
    dismiss();
  };

  return (
    <Modal
      open
      onClose={dismiss}
      title="A new Pawchive update is available"
      description={
        info.currentVersion
          ? `You're running version ${info.currentVersion}.`
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
          <Button variant="primary" onClick={openRelease}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Get version {version}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold text-ink">
            Pawchive {version} is ready
          </p>
          {info.releaseName ? (
            <p className="text-xs text-muted">{info.releaseName}</p>
          ) : null}
          <p className="text-xs leading-relaxed text-muted">
            Update to get the latest fixes and features. You will only see this
            reminder once for this version.
          </p>
        </div>
      </div>
    </Modal>
  );
}
