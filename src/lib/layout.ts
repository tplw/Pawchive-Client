import type { PostCardSize } from "../types";

export function postGridMetrics(size: PostCardSize): {
  rowHeight: number;
  minColumnWidth: number;
} {
  switch (size) {
    case "small":
      return { rowHeight: 290, minColumnWidth: 150 };
    case "large":
      return { rowHeight: 400, minColumnWidth: 320 };
    default:
      return { rowHeight: 340, minColumnWidth: 280 };
  }
}

export function creatorGridMetrics(size: PostCardSize): {
  rowHeight: number;
  minColumnWidth: number;
} {
  switch (size) {
    case "small":
      return { rowHeight: 104, minColumnWidth: 280 };
    case "large":
      return { rowHeight: 280, minColumnWidth: 280 };
    default:
      return { rowHeight: 250, minColumnWidth: 250 };
  }
}
