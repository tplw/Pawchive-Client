import { useEffect, useRef, useState } from "react";
import {
  getGlobalHideNoMediaDefault,
  loadCreatorFilter,
  parseFilterKeywords,
  saveCreatorFilter,
  type CreatorFilter,
} from "../../../lib/creatorFilters";

/** Per-creator filter state, persisted to localStorage on every change. */
export function useCreatorFilterState({
  service,
  creatorId,
  hideNoMediaDefault,
}: {
  service: string;
  creatorId: string;
  hideNoMediaDefault: boolean;
}) {
  const [filter, setFilter] = useState<CreatorFilter>(() =>
    loadCreatorFilter(service, creatorId),
  );
  const [keywordText, setKeywordText] = useState(() =>
    loadCreatorFilter(service, creatorId).keywords.join(", "),
  );
  const lastHideNoMediaDefault = useRef(hideNoMediaDefault);

  useEffect(() => {
    const next = loadCreatorFilter(service, creatorId);
    setFilter(next);
    setKeywordText(next.keywords.join(", "));
  }, [service, creatorId]);

  // Keep an already-open creator profile in sync when the main Settings
  // toggle changes. The updated value is also persisted for this creator.
  useEffect(() => {
    if (lastHideNoMediaDefault.current === hideNoMediaDefault) return;
    lastHideNoMediaDefault.current = hideNoMediaDefault;
    setFilter((current) => {
      const next = { ...current, hideNoMedia: hideNoMediaDefault };
      saveCreatorFilter(service, creatorId, next);
      return next;
    });
  }, [hideNoMediaDefault, service, creatorId]);

  const updateFilter = (next: CreatorFilter) => {
    setFilter(next);
    saveCreatorFilter(service, creatorId, next);
  };

  const clearFilter = () => {
    updateFilter({
      audioOnly: false,
      hideNoMedia: getGlobalHideNoMediaDefault(),
      hideUnavailable: false,
      keywords: [],
      asmr: false,
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
    clearFilter,
    changeKeywords,
  };
}
