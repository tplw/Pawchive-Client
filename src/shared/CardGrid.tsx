import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./lib/format";
import { useAppStore } from "../app/store";

interface CardGridProps<T> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  getKey?: (item: T) => string;
  minColumnWidth?: number;
  gap?: number;
  itemHeight?: number;
  className?: string;
  onEndReached?: () => void;
}

/**
 * CSS grid used for post and creator collections. Unlike a windowed grid it
 * keeps every card in normal document flow, which avoids row-height jumps and
 * overlap artifacts while scrolling on WKWebView.
 */
export function CardGrid<T>({
  items,
  renderItem,
  getKey,
  minColumnWidth = 160,
  gap = 16,
  itemHeight,
  className,
  onEndReached,
}: CardGridProps<T>) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadAheadPages = useAppStore(
    (state) => state.settings.loadAheadPages ?? 1,
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !onEndReached) return;
    if (typeof IntersectionObserver === "undefined") return;
    const root = document.getElementById("main-scroll");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEndReached();
      },
      { root, rootMargin: `${loadAheadPages * 800}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, loadAheadPages, onEndReached]);

  return (
    <div
      className={cn("grid", className)}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`,
        gap,
      }}
    >
      {items.map((item, index) => (
        <div
          key={getKey ? getKey(item) : index}
          className="card-grid-item min-w-0"
          style={
            itemHeight
              ? { containIntrinsicSize: `auto ${itemHeight}px` }
              : undefined
          }
        >
          {renderItem(item)}
        </div>
      ))}
      <div ref={sentinelRef} className="col-span-full h-px" aria-hidden="true" />
    </div>
  );
}
