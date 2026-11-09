import type { CreatorFilter } from "../../../lib/creatorFilters";
import { Button, Field, Modal, Toggle } from "../../../components/ui";

export function CreatorFilterModal({
  open,
  onClose,
  name,
  filter,
  keywordText,
  isAsmr,
  detectedAsmr,
  autoAudioOnly,
  effectiveFilter,
  onUpdateFilter,
  onClear,
  onKeywordsChange,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  filter: CreatorFilter;
  keywordText: string;
  isAsmr: boolean;
  detectedAsmr: boolean;
  autoAudioOnly: boolean;
  effectiveFilter: CreatorFilter;
  onUpdateFilter: (filter: CreatorFilter) => void;
  onClear: () => void;
  onKeywordsChange: (value: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Creator filters"
      description={`Customize which posts appear for ${name}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClear}>
            Clear filters
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Toggle
          checked={isAsmr}
          onChange={(checked) =>
            onUpdateFilter({
              ...filter,
              asmr: checked,
              audioOnly: checked ? true : false,
            })
          }
          label="ASMR creator"
          description={
            detectedAsmr
              ? "Detected automatically from this creator's name, profile or posts. Audio-only is applied."
              : "Manually mark this creator as ASMR and enable audio-only."
          }
        />
        <Toggle
          checked={effectiveFilter.audioOnly}
          onChange={(checked) => {
            if (autoAudioOnly && !checked) {
              onUpdateFilter({ ...filter, asmr: false, audioOnly: false });
            } else {
              onUpdateFilter({ ...filter, audioOnly: checked });
            }
          }}
          label="Audio only"
          description={
            autoAudioOnly
              ? "Auto-enabled because this creator is marked as ASMR."
              : "Only show posts that include an audio attachment."
          }
        />
        <Toggle
          checked={filter.hideNoMedia}
          onChange={(checked) =>
            onUpdateFilter({ ...filter, hideNoMedia: checked })
          }
          label="Hide posts without media"
          description="Hide posts that have no media attachments. Follows the main Settings toggle until you override it here."
        />
        <Toggle
          checked={filter.hideUnavailable}
          onChange={(checked) =>
            onUpdateFilter({ ...filter, hideUnavailable: checked })
          }
          label="Hide unavailable posts"
          description="Hide posts that aren't imported or exceed the archive file-size limit. Posts with playable or downloadable non-image files stay visible."
        />
        <Field
          label="Hide keywords"
          hint="Separate with commas or new lines. Matching posts are hidden for this creator."
        >
          <textarea
            value={keywordText}
            onChange={(event) => onKeywordsChange(event.target.value)}
            rows={3}
            placeholder="sketch, commission, teaser"
            className="w-full resize-y rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink outline-none transition placeholder:text-dim focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
          />
        </Field>
        <p className="text-[10px] leading-relaxed text-dim">
          Filters are saved on this device and apply to this creator's post
          list. Direct post links still open normally.
        </p>
      </div>
    </Modal>
  );
}
