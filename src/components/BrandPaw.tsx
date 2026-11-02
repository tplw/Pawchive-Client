import pawMask from "../assets/brand/paw_white.png";
import { cn } from "../lib/format";

export function BrandPaw({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("brand-paw inline-block shrink-0", className)}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${pawMask})`,
        maskImage: `url(${pawMask})`,
      }}
    />
  );
}
