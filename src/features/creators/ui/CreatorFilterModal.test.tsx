import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreatorFilterModal } from "./CreatorFilterModal";

const filter = {
  audioOnly: false,
  mediaFilter: "all" as const,
  hideUnavailable: false,
  overrideGlobalKeywords: false,
  keywords: [],
};

describe("creator filter modal", () => {
  it("groups the controls under clear headings", () => {
    render(
      <CreatorFilterModal
        open
        onClose={() => undefined}
        name="Test creator"
        filter={filter}
        keywordText=""
        isAsmr={false}
        detectedAsmr={false}
        autoAudioOnly={false}
        effectiveFilter={filter}
        onUpdateFilter={() => undefined}
        onClear={() => undefined}
        onKeywordsChange={() => undefined}
      />,
    );

    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("Posts")).toBeInTheDocument();
    expect(screen.getByText("Comic mode")).toBeInTheDocument();
    expect(screen.getByText("Keywords")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("Use main setting")).toHaveLength(2);
  });
});
