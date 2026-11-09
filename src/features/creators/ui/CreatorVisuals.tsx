import { AlertTriangle, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import {
  creatorAvatar,
  creatorBanner,
  serviceLabel,
} from "../../../shared/lib/constants";
import { cn } from "../../../shared/lib/format";
import { useAppStore } from "../../../app/store";
import type { Service } from "../../../shared/types";

const SERVICE_COLORS: Record<string, string> = {
  patreon: "bg-[#f96854]/12 text-[#ff8a78] border-[#f96854]/25",
  fanbox: "bg-[#00a4e4]/12 text-[#5cc8f4] border-[#00a4e4]/25",
  discord: "bg-[#5865f2]/12 text-[#8c95ff] border-[#5865f2]/25",
};

export function CreatorAvatar({
  service,
  id,
  name,
  size = "md",
  className,
}: {
  service: Service;
  id: string;
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const config = useAppStore((state) => state.config);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const sizes = {
    xs: "h-6 w-6 text-[9px]",
    sm: "h-9 w-9 text-xs",
    md: "h-12 w-12 text-sm",
    lg: "h-16 w-16 text-lg",
    xl: "h-24 w-24 text-2xl",
  };
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [id, service]);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg border border-line/80 bg-elevated",
        sizes[size],
        className,
      )}
    >
      {!failed ? (
        <img
          src={creatorAvatar(config, service, id)}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="grid h-full w-full place-items-center font-semibold text-accent">
          {initials || <Radio className="h-4 w-4" />}
        </span>
      )}
    </div>
  );
}

export function CreatorBanner({
  service,
  id,
  name,
}: {
  service: Service;
  id: string;
  name: string;
}) {
  const config = useAppStore((state) => state.config);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [id, service]);
  if (failed) {
    return (
      <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgb(var(--accent)/0.22),transparent_45%),radial-gradient(circle_at_80%_70%,rgb(var(--accent)/0.1),transparent_40%)]" />
    );
  }
  return (
    <img
      src={creatorBanner(config, service, id)}
      alt={`${name} banner`}
      loading="lazy"
      decoding="async"
      className={cn(
        "h-full w-full object-cover transition-opacity duration-300",
        loaded ? "opacity-100" : "opacity-0",
      )}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}

export function ServiceBadge({ service }: { service: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        SERVICE_COLORS[service.toLowerCase()] ?? "bg-white/7 text-muted border-white/10",
      )}
    >
      {serviceLabel(service)}
    </span>
  );
}

/** Mirrors Pawchive's warning marker for content the archive has not imported. */
export function NotImportedBadge({
  creator = false,
  className,
}: {
  creator?: boolean;
  className?: string;
}) {
  const title = creator
    ? "haven't imported this creator yet"
    : "haven't archived this post yet";
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center rounded border border-favorite/25 bg-favorite/10 px-1 py-0.5 text-favorite",
        className,
      )}
    >
      <AlertTriangle className="h-3 w-3" />
    </span>
  );
}
