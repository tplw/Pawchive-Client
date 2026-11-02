import {
  AlertCircle,
  CheckCircle2,
  Info,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/format";
import { useAppStore } from "../stores/app";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ink text-base border border-ink hover:bg-white active:bg-[#dbdbdb] font-semibold",
  secondary:
    "bg-elevated text-ink border border-line hover:bg-[#36393f] hover:border-[#676d79]",
  ghost: "text-muted hover:text-ink hover:bg-white/10",
  danger:
    "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  subtle: "bg-white/5 text-muted hover:text-ink hover:bg-white/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-sm gap-2.5",
  icon: "h-9 w-9 justify-center",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  loading,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center rounded-xl transition duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  active,
  className,
  iconClassName,
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  iconClassName?: string;
  size?: "sm" | "md";
}) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-muted transition outline-none hover:bg-white/8 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 w-7" : "h-9 w-9",
        active && "bg-accent/15 text-accent",
        className,
      )}
    >
      <Icon
        className={cn(
          size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
          iconClassName,
        )}
      />
    </button>
  );
}

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    default: "bg-white/7 text-muted border-white/10",
    accent: "bg-accent/12 text-accent border-accent/25",
    success: "bg-success/10 text-success border-success/25",
    warning: "bg-favorite/10 text-favorite border-favorite/25",
    danger: "bg-danger/10 text-danger border-danger/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("h-5 w-5 animate-spin text-accent", className)} />;
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-line/80 bg-surface/35 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-elevated text-muted">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">{message}</p>
      </div>
      {action}
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/80">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-lg bg-[linear-gradient(90deg,rgb(var(--elevated))_0px,rgb(var(--line))_40px,rgb(var(--elevated))_80px)] bg-[length:500px_100%]",
        className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11px] leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-lg border border-line bg-base px-3 text-sm text-ink outline-none transition placeholder:text-dim focus:border-accent/70 focus:ring-2 focus:ring-accent/15",
        className,
      )}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  compact = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full cursor-pointer items-start justify-between gap-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        compact ? "py-1.5" : "py-3",
      )}
    >
      <span>
        <span
          className={cn(
            "block font-medium text-ink",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {label}
        </span>
        {description ? (
          <span
            className={cn(
              "block leading-relaxed text-muted",
              compact ? "mt-0.5 text-[10px]" : "mt-0.5 text-xs",
            )}
          >
            {description}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition",
          checked
            ? "border-accent/40 bg-accent"
            : "border-line bg-elevated hover:border-muted/40",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => ref.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-5 backdrop-blur-sm animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-modal-open="true"
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "max-h-[88vh] w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-lift outline-none animate-slide-up",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/70 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <div className="max-h-[64vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-line/70 px-5 py-3.5">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onClose,
  danger,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{message}</p>
    </Modal>
  );
}

export function Toaster() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);
  return (
    <div className="toaster pointer-events-none fixed bottom-24 left-1/2 z-[120] flex w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-1.5">
      {toasts.slice(-3).map((toast) => {
        const Icon =
          toast.kind === "success"
            ? CheckCircle2
            : toast.kind === "error"
              ? AlertCircle
              : Info;
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-lg border bg-elevated/95 px-3 py-2 shadow-lift backdrop-blur animate-slide-up",
              toast.kind === "error"
                ? "border-red-500/30"
                : toast.kind === "success"
                  ? "border-emerald-500/25"
                  : "border-line",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 h-3.5 w-3.5 shrink-0",
                toast.kind === "error"
                  ? "text-red-400"
                  : toast.kind === "success"
                    ? "text-emerald-400"
                    : "text-accent",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold leading-tight text-ink">
                {toast.title}
              </p>
              {toast.message ? (
                <p className="mt-0.5 line-clamp-2 break-words text-[10px] leading-snug text-muted">
                  {toast.message}
                </p>
              ) : null}
            </div>
            <IconButton
              label="Dismiss"
              icon={X}
              size="sm"
              onClick={() => dismiss(toast.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
