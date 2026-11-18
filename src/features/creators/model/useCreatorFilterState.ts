import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGlobalMediaFilterDefault,
  loadCreatorFilter,
  parseFilterKeywords,
  saveCreatorFilter,
  type CreatorFilter,
} from "../../../shared/lib/creatorFilters";
import type { MediaFilter } from "../../../shared/types";

/** Per-creator filter state, persisted to localStorage on every change. */
export function useCreatorFilterState({
  service,
  creatorId,
  mediaFilterDefault,
}: {
  service: string;
  creatorId: string;
  mediaFilterDefault: MediaFilter;
}) {
  const [filter, setFilter] = useState<CreatorFilter>(() =>
    loadCreatorFilter(service, creatorId),
  );
  const [keywordText, setKeywordText] = useState(() =>
    loadCreatorFilter(service, creatorId).keywords.join(", "),
  );
  const lastMediaFilterDefault = useRef(mediaFilterDefault);

  useEffect(() => {
    const next = loadCreatorFilter(service, creatorId);
    setFilter(next);
    setKeywordText(next.keywords.join(", "));
  }, [service, creatorId]);

  // Keep an already-open creator profile in sync when the main Settings
  // toggle changes. The updated value is also persisted for this creator.
  useEffect(() => {
    if (lastMediaFilterDefault.current === mediaFilterDefault) return;
    lastMediaFilterDefault.current = mediaFilterDefault;
    setFilter((current) => {
      const next = { ...current, mediaFilter: mediaFilterDefault };
      saveCreatorFilter(service, creatorId, next);
      return next;
    });
  }, [mediaFilterDefault, service, creatorId]);

  const updateFilter = (next: CreatorFilter) => {
    setFilter(next);
    saveCreatorFilter(service, creatorId, next);
  };
  const markAutoAsmr = useCallback(() => {
    setFilter((current) => {
      if (current.asmr !== undefined) return current;
      const next = { ...current, asmr: true };
      saveCreatorFilter(service, creatorId, next);
      return next;
    });
  }, [creatorId, service]);


  const clearFilter = () => {
    updateFilter({
      audioOnly: false,
      mediaFilter: getGlobalMediaFilterDefault(),
      hideUnavailable: false,
      overrideGlobalKeywords: false,
      keywords: [],
    });
    setKeywordText("");
  };

  const changeKeywords = (value: string) => {
    setKeywordText(value);
    updateFilter({
      ...filter,
      keywords: parseFilterKeywords(value),
    });
  };

  return {
    filter,
    keywordText,
    updateFilter,
    markAutoAsmr,
    clearFilter,
    changeKeywords,
  };
}
