import { useEffect, useRef, useState } from "react";
import { Button, Modal, TextInput } from "../../../shared/ui";
import {
  resolveProviderPassword,
  subscribeProviderPassword,
  type ProviderPasswordRequest,
} from "../../../shared/lib/providerPasswords";

/** Global dialog for MEGA and Proton link passwords. Mounted once by App. */
export function ProviderPasswordDialog() {
  const [request, setRequest] = useState<ProviderPasswordRequest | null>(null);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      subscribeProviderPassword((next) => {
        setRequest(next);
        setPassword("");
        setRemember(true);
      }),
    [],
  );

  useEffect(() => {
    if (!request) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [request]);

  const providerName = request?.provider === "proton" ? "Proton Drive" : "MEGA";
  const submit = () => {
    if (!request || password.length === 0) return;
    resolveProviderPassword({ password, remember });
  };

  return (
    <Modal
      open={request !== null}
      onClose={() => resolveProviderPassword(null)}
      title="Password required"
      description={
        request?.provider === "proton"
          ? "This Proton Drive link has a custom password."
          : "This MEGA link is protected by a password."
      }
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => resolveProviderPassword(null)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={password.length === 0}
          >
            Unlock
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {request?.message ? (
          <p className="rounded-lg border border-favorite/25 bg-favorite/10 px-3 py-2 text-xs leading-relaxed text-favorite">
            {request.message}
          </p>
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink">
            {providerName} password
          </span>
          <TextInput
            ref={inputRef}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="Enter the link password"
          />
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
          />
          <span>
            Remember this password on this device. If it stops working, the app
            asks again.
          </span>
        </label>
      </div>
    </Modal>
  );
}
