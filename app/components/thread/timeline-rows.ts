import type { ThreadResponseUsage, ThreadTimelineItem, ThreadTimelineTurn } from "~~/shared/types";
import type { DisplayedTurnTiming } from "@/utils/turn-timing";
import { itemKey, userMessageVariant, type ThreadTurnSections } from "./thread-turn-sections";
import { collapsibleIntermediateItem, intermediateItemSummary } from "@/utils/intermediate-summary";

export type { ThreadTimelineTurn } from "~~/shared/types";

type ThreadTimelineItemSection = "user" | "intermediate" | "final";

const estimatedItemHeights: Partial<Record<ThreadTimelineItem["type"], number>> = {
  commandExecution: 48,
  fileChange: 440,
  agentMessage: 144,
  reasoning: 128,
  userMessage: 160,
};

export type ThreadTimelineRow =
  | {
      key: string;
      type: "intermediateHeader";
      turnId: string;
      count: number;
      open: boolean;
      loading: boolean;
      activeLabel: string | null;
      summary: {
        fileItems: { itemId: string | null; path: string }[];
        commandCount: number;
        durationMs: number | null;
      } | null;
    }
  | {
      key: string;
      type: "item";
      turnId: string;
      section: ThreadTimelineItemSection;
      item: ThreadTimelineItem;
      userMessageVariant: "normal" | "steer";
      turnTiming: DisplayedTurnTiming | null;
      responseUsage: ThreadResponseUsage[] | undefined;
      agentActionsAvailable: boolean;
    }
  | {
      key: string;
      type: "turnDuration";
      turnId: string;
      startedAt: number | null;
      completedAt: number | null;
      durationMs: number | null;
      active: boolean;
      responseUsage: ThreadResponseUsage[] | undefined;
    }
  | {
      key: string;
      type: "turnSummary";
      turnId: string;
      fileItems: { itemId: string | null; path: string }[];
      commandCount: number;
      durationMs: number | null;
    };

export interface ThreadTimelineTurnState {
  turn: ThreadTimelineTurn;
  sections: ThreadTurnSections;
  intermediateOpen: boolean;
  intermediateLoading: boolean;
}

// Every visible entry is a direct row of the Agent timeline. Do not wrap intermediate items in a
// second virtualizer: two height caches sharing one scroll element can leave stale blank space on
// WebKit. Collapsing is represented only by omitting intermediate item rows from this flat model.
export function buildThreadTimelineRows(input: {
  threadId: string | null;
  turns: ThreadTimelineTurnState[];
  agentActionsAvailable: boolean;
}) {
  return input.turns.flatMap(({ turn, sections, intermediateOpen, intermediateLoading }) => {
    const rows: ThreadTimelineRow[] = [];
    const timing = displayedTurnTiming(turn);
    const timingTarget = sections.finalItems.findLast((item) => item.type === "agentMessage");
    appendItemRows(rows, input.threadId, turn.id, "user", sections.userItems, sections);

    // Only process artifacts collapse into "intermediate steps"; actionable items (approvals,
    // requests, notifications) stay visible even while the group is closed.
    const collapsedItems = sections.intermediateItems.filter(collapsibleIntermediateItem);
    const inlineItems = sections.intermediateItems.filter(
      (item) => !collapsibleIntermediateItem(item),
    );

    // Completed-turn summary ("done · N files · M commands · Xs") rides on the intermediate
    // header row when one exists, matching the single-line ChatGPT "thought" row. Turns without
    // a collapsible group keep the standalone summary row below.
    const fileItems: { itemId: string | null; path: string }[] = [];
    let commandCount = 0;
    for (const item of turn.items ?? []) {
      if (item?.type === "commandExecution") commandCount += 1;
      if (item?.type === "fileChange") {
        const changes = Array.isArray(item.changes) ? item.changes : [];
        for (const change of changes) {
          const record =
            typeof change === "object" && change !== null
              ? (change as Record<string, unknown>)
              : {};
          const path = record.path ?? record.filePath ?? record.pathAfter ?? record.pathBefore;
          if (typeof path === "string" && path !== "") {
            fileItems.push({ itemId: item.id == null ? null : String(item.id), path });
          }
        }
      }
    }
    const uniqueFiles = [...new Map(fileItems.map((f) => [f.path, f])).values()];
    const summary =
      turn.status === "completed" &&
      (uniqueFiles.length > 0 || commandCount > 0 || timing.durationMs !== null)
        ? { fileItems: uniqueFiles, commandCount, durationMs: timing.durationMs }
        : null;

    const hasIntermediateHeader = collapsedItems.length > 0 || turn.itemsView !== "full";
    if (hasIntermediateHeader) {
      // The latest-step preview only matters while the group is collapsed; when open it would
      // also duplicate the item's own title in the header's accessible name.
      const activeItem =
        sections.turnIsActive && !intermediateOpen ? collapsedItems.at(-1) : undefined;
      rows.push({
        key: `${input.threadId}:turn-${turn.id}:intermediate-header`,
        type: "intermediateHeader",
        turnId: turn.id,
        count: collapsedItems.length,
        open: intermediateOpen,
        loading: intermediateLoading,
        activeLabel: activeItem === undefined ? null : intermediateItemSummary(activeItem),
        summary,
      });
      if (intermediateOpen) {
        appendItemRows(
          rows,
          input.threadId,
          turn.id,
          "intermediate",
          sections.intermediateItems,
          sections,
        );
      } else {
        appendItemRows(rows, input.threadId, turn.id, "intermediate", inlineItems, sections);
      }
    } else {
      appendItemRows(rows, input.threadId, turn.id, "intermediate", inlineItems, sections);
    }

    appendItemRows(
      rows,
      input.threadId,
      turn.id,
      "final",
      sections.finalItems,
      sections,
      timingTarget,
      timing,
      input.agentActionsAvailable,
      turn.responseUsage,
    );
    if (!hasIntermediateHeader && summary !== null) {
      rows.push({
        key: `${input.threadId}:turn-${turn.id}:summary`,
        type: "turnSummary",
        turnId: turn.id,
        fileItems: summary.fileItems,
        commandCount: summary.commandCount,
        durationMs: summary.durationMs,
      });
    }
    // Completed turns normally render timing beside the final answer's copy action. Keep a
    // standalone row only for interrupted/error turns that never produced an Agent answer.
    if (
      input.agentActionsAvailable &&
      (hasTimingValue(timing) || (turn.responseUsage?.length ?? 0) > 0) &&
      timingTarget === undefined
    ) {
      rows.push({
        key: `${input.threadId}:turn-${turn.id}:duration`,
        type: "turnDuration",
        turnId: turn.id,
        ...timing,
        responseUsage: turn.responseUsage,
      });
    }
    return rows;
  });
}

export function reuseUnchangedTimelineRows(
  previous: ThreadTimelineRow[] | undefined,
  next: ThreadTimelineRow[],
) {
  if (previous === undefined || previous.length === 0) return next;
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  return next.map((row) => {
    const candidate = previousByKey.get(row.key);
    return candidate !== undefined && sameTimelineRow(candidate, row) ? candidate : row;
  });
}

export function estimateThreadTimelineRow(row: ThreadTimelineRow | undefined) {
  if (row === undefined) return 96;
  if (row.type === "intermediateHeader") return 48;
  if (row.type === "turnDuration") return 28;
  if (row.type === "turnSummary") return 32;
  return estimatedItemHeights[row.item.type] ?? 96;
}

function appendItemRows(
  rows: ThreadTimelineRow[],
  threadId: string | null,
  turnId: string,
  section: ThreadTimelineItemSection,
  items: ThreadTimelineItem[],
  sections: ThreadTurnSections,
  timingTarget?: ThreadTimelineItem,
  timing: DisplayedTurnTiming | null = null,
  agentActionsAvailable = false,
  responseUsage?: ThreadResponseUsage[],
) {
  items.forEach((item, index) => {
    rows.push({
      key: `${threadId}:turn-${turnId}:${section}:${itemKey(item, section, index)}`,
      type: "item",
      turnId,
      section,
      item,
      userMessageVariant: userMessageVariant(item, sections),
      turnTiming: item === timingTarget ? timing : null,
      responseUsage: item === timingTarget ? responseUsage : undefined,
      agentActionsAvailable: item === timingTarget && agentActionsAvailable,
    });
  });
}

function displayedTurnTiming(turn: ThreadTimelineTurn): DisplayedTurnTiming {
  return {
    startedAt: typeof turn.startedAt === "number" ? turn.startedAt : null,
    completedAt: typeof turn.completedAt === "number" ? turn.completedAt : null,
    durationMs: turn.durationMs ?? null,
    active: turn.status === "inProgress",
  };
}

function hasTimingValue(timing: DisplayedTurnTiming) {
  return timing.startedAt !== null || timing.durationMs !== null;
}

function sameTimelineRow(left: ThreadTimelineRow, right: ThreadTimelineRow) {
  if (left.type !== right.type) return false;
  if (left.type === "intermediateHeader" && right.type === "intermediateHeader") {
    return (
      left.count === right.count &&
      left.open === right.open &&
      left.loading === right.loading &&
      left.turnId === right.turnId &&
      left.activeLabel === right.activeLabel &&
      sameIntermediateSummary(left.summary, right.summary)
    );
  }
  if (left.type === "item" && right.type === "item") {
    // App-server deltas mutate this reactive item proxy in place. Reuse the lightweight row wrapper
    // so unrelated mounted Markdown rows do not rerender, but never clone or mark the item raw:
    // nested text/output reactivity is the official Vue update path that feeds TanStack's row
    // ResizeObserver. A separate presentation revision would duplicate timeline state.
    return (
      left.item === right.item &&
      left.turnId === right.turnId &&
      left.section === right.section &&
      left.userMessageVariant === right.userMessageVariant &&
      left.agentActionsAvailable === right.agentActionsAvailable &&
      sameResponseUsage(left.responseUsage, right.responseUsage) &&
      sameTurnTiming(left.turnTiming, right.turnTiming)
    );
  }
  if (left.type === "turnDuration" && right.type === "turnDuration") {
    return (
      left.turnId === right.turnId &&
      left.startedAt === right.startedAt &&
      left.completedAt === right.completedAt &&
      left.durationMs === right.durationMs &&
      left.active === right.active &&
      sameResponseUsage(left.responseUsage, right.responseUsage)
    );
  }
  if (left.type === "turnSummary" && right.type === "turnSummary") {
    return (
      left.turnId === right.turnId &&
      left.commandCount === right.commandCount &&
      left.durationMs === right.durationMs &&
      left.fileItems.length === right.fileItems.length &&
      left.fileItems.every(
        (file, index) =>
          file.path === right.fileItems[index]?.path &&
          file.itemId === right.fileItems[index]?.itemId,
      )
    );
  }
  return false;
}

function sameIntermediateSummary(
  left: {
    fileItems: { itemId: string | null; path: string }[];
    commandCount: number;
    durationMs: number | null;
  } | null,
  right: {
    fileItems: { itemId: string | null; path: string }[];
    commandCount: number;
    durationMs: number | null;
  } | null,
) {
  if (left === null || right === null) return left === right;
  return (
    left.commandCount === right.commandCount &&
    left.durationMs === right.durationMs &&
    left.fileItems.length === right.fileItems.length &&
    left.fileItems.every(
      (file, index) =>
        file.path === right.fileItems[index]?.path &&
        file.itemId === right.fileItems[index]?.itemId,
    )
  );
}

function sameResponseUsage(
  left: ThreadResponseUsage[] | undefined,
  right: ThreadResponseUsage[] | undefined,
) {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  return left.every(
    (usage, index) =>
      usage.responseId === right[index]?.responseId && usage.amount === right[index]?.amount,
  );
}

function sameTurnTiming(left: DisplayedTurnTiming | null, right: DisplayedTurnTiming | null) {
  if (left === null || right === null) return left === right;
  return (
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.durationMs === right.durationMs &&
    left.active === right.active
  );
}
