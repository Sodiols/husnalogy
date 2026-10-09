"use client";

// Contextual toolbar for a customer multiple selection, and for a selected
// group. It is the only place Group/Ungroup is reachable without opening the
// side panel, so it renders in the canvas toolbar dock alongside the text,
// image, element and grid toolbars. Drawn like the studio's selection toolbar
// through CustomerToolbarKit.
//
// Actions the customer is not permitted to use are not rendered at all — a
// template that forbids grouping must not advertise it (spec: Customer
// customizer permissions). Actions that are permitted but not currently valid
// stay visible and disabled, with the reason in the tooltip.

import type { GroupActionState } from "@/lib/customizer/v2/groups";
import { ToolbarButton, ToolbarShell } from "./CustomerToolbarKit";

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
  /** Kept for callers; the shared toolbar shell collapses labels itself when the room is short. */
  compact?: boolean;
};

const ICONS = {
  group: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h4M7 10v4",
  ungroup: "M3 3h6v6H3zM15 15h6v6h-6zM9 6h3v3",
  edit: "M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z",
} as const;

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
}: Props) {
  const showGroup = groupingAllowed && !isGroup && selectionCount > 1;
  const showUngroup = ungroupingAllowed && isGroup;
  if (!showGroup && !showUngroup) return null;

  const sections: React.ReactNode[] = [];
  if (selectionCount > 1) {
    sections.push(
      <span key="count" className="whitespace-nowrap px-3 text-[13px] font-medium text-[#303839]/80">
        {selectionCount} selected
      </span>,
    );
  }
  sections.push(
    <div key="actions" className="flex shrink-0 items-center">
      {showGroup && (
        <ToolbarButton label="Group" icon={ICONS.group} showLabel collapsible={false} disabled={!group.enabled} title={group.reason || "Group"} onClick={onGroup} />
      )}
      {showUngroup && (
        <>
          <ToolbarButton label="Ungroup" icon={ICONS.ungroup} showLabel collapsible={false} disabled={!ungroup.enabled} title={ungroup.reason || "Ungroup"} onClick={onUngroup} />
          {onEnterGroup && (
            <ToolbarButton label="Edit" ariaLabel="Edit group" icon={ICONS.edit} showLabel title="Edit the objects inside this group without ungrouping it" onClick={onEnterGroup} />
          )}
        </>
      )}
    </div>,
  );

  return (
    <ToolbarShell
      label="Selection grouping"
      selectionKey={`group-${selectionCount}-${isGroup}`}
      sections={sections}
      // Safe for inline text editing: clicking it never ends an edit.
      attributes={{ "data-customer-group-toolbar": true, "data-customizer-text-interaction": true }}
    />
  );
}
