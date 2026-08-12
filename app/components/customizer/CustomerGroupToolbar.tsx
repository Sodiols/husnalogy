"use client";

// Contextual toolbar for a customer multiple selection, and for a selected
// group. It is the only place Group/Ungroup is reachable without opening the
// side panel, so it renders in the canvas toolbar dock alongside the text,
// image, element and grid toolbars.
//
// Actions the customer is not permitted to use are not rendered at all — a
// template that forbids grouping must not advertise it (spec: Customer
// customizer permissions). Actions that are permitted but not currently valid
// stay visible and disabled, with the reason in the tooltip.

import type { GroupActionState } from "@/lib/customizer/v2/groups";

type Props = {
  selectionCount: number;
  isGroup: boolean;
  groupingAllowed: boolean;
  ungroupingAllowed: boolean;
  group: GroupActionState;
  ungroup: GroupActionState;
  onGroup: () => void;
  onUngroup: () => void;
  onEnterGroup?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Compact layout for narrow screens: icons with tooltips, no labels. */
  compact?: boolean;
};

const ICONS = {
  group: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h4M7 10v4",
  ungroup: "M3 3h6v6H3zM15 15h6v6h-6zM9 6h3v3",
  edit: "M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z",
  duplicate: "M8 8h11v11H8zM16 8V6.5A1.5 1.5 0 0 0 14.5 5h-9A1.5 1.5 0 0 0 4 6.5v9A1.5 1.5 0 0 0 5.5 17H8",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
} as const;

function Icon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const BUTTON =
  "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#303839]/15 bg-white px-2.5 text-[12.5px] font-semibold text-[#303839] transition-colors hover:border-[#303839]/30 hover:bg-[#F4ECEC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] disabled:cursor-not-allowed disabled:border-[#303839]/10 disabled:bg-[#F4ECEC]/50 disabled:text-[#303839]/35";

export default function CustomerGroupToolbar({
  selectionCount,
  isGroup,
  groupingAllowed,
  ungroupingAllowed,
  group,
  ungroup,
  onGroup,
  onUngroup,
  onEnterGroup,
  onDuplicate,
  onDelete,
  compact = false,
}: Props) {
  const showGroup = groupingAllowed && !isGroup && selectionCount > 1;
  const showUngroup = ungroupingAllowed && isGroup;
  if (!showGroup && !showUngroup && !onDuplicate && !onDelete) return null;

  return (
    <div
      data-customizer-text-interaction
      data-customer-group-toolbar
      role="toolbar"
      aria-label="Selection grouping"
      className="pointer-events-auto flex max-w-full items-center gap-1 rounded-xl border border-[#303839]/12 bg-white p-1.5 shadow-[0_6px_20px_rgba(48,56,57,0.10)]"
    >
      {selectionCount > 1 && !compact && (
        <span className="shrink-0 rounded-full bg-[#F4ECEC] px-2.5 py-1 text-[10px] font-bold text-[#303839]/70">
          {selectionCount} selected
        </span>
      )}

      {showGroup && (
        <button
          type="button"
          aria-label="Group"
          aria-disabled={!group.enabled}
          title={group.reason}
          disabled={!group.enabled}
          onClick={onGroup}
          className={`${BUTTON} ${compact ? "w-9 px-0" : ""}`}
        >
          <Icon path={ICONS.group} />
          {!compact && <span>Group</span>}
        </button>
      )}

      {showUngroup && (
        <>
          <button
            type="button"
            aria-label="Ungroup"
            aria-disabled={!ungroup.enabled}
            title={ungroup.reason}
            disabled={!ungroup.enabled}
            onClick={onUngroup}
            className={`${BUTTON} ${compact ? "w-9 px-0" : ""}`}
          >
            <Icon path={ICONS.ungroup} />
            {!compact && <span>Ungroup</span>}
          </button>
          {onEnterGroup && (
            <button
              type="button"
              aria-label="Edit group"
              title="Edit the objects inside this group without ungrouping it"
              onClick={onEnterGroup}
              className={`${BUTTON} ${compact ? "w-9 px-0" : ""}`}
            >
              <Icon path={ICONS.edit} />
              {!compact && <span>Edit</span>}
            </button>
          )}
        </>
      )}

      {(onDuplicate || onDelete) && (showGroup || showUngroup) && (
        <span className="mx-0.5 h-6 w-px shrink-0 bg-[#303839]/12" aria-hidden />
      )}

      {onDuplicate && (
        <button type="button" aria-label="Duplicate selection" title="Duplicate selection" onClick={onDuplicate} className={`${BUTTON} w-9 px-0`}>
          <Icon path={ICONS.duplicate} />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label="Delete selection"
          title="Delete selection"
          onClick={onDelete}
          className={`${BUTTON} w-9 px-0 text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700`}
        >
          <Icon path={ICONS.trash} />
        </button>
      )}
    </div>
  );
}
