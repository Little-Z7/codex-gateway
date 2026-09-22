import type { ThreadTimelineItem } from "~~/shared/types";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { isItemInProgress } from "@/utils/thread-items";

// The "intermediate steps" group only holds process artifacts; approvals, requests, plans and
// notifications remain inline so nothing actionable is hidden behind a collapsed disclosure.
const COLLAPSIBLE_TYPES = new Set([
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "webSearch",
  "imageGeneration",
  // Non-final agent commentary between turns belongs to the process, not the answer.
  "agentMessage",
]);

export function collapsibleIntermediateItem(item: ThreadTimelineItem) {
  // The agent answer currently streaming is the content itself, not process noise — only settled
  // commentary collapses into the group.
  if (item.type === "agentMessage") {
    return !isItemInProgress(item);
  }
  return COLLAPSIBLE_TYPES.has(item.type);
}

/** One-line summary used beside the collapsed header while a turn is still running. */
export function intermediateItemSummary(item: ThreadTimelineItem): string | null {
  if (item.type === "commandExecution") {
    const command = stringFromUnknown(item.command);
    return command === null ? null : (command.split("\n")[0] ?? null);
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    for (const change of changes) {
      const record = recordFromUnknown(change);
      const path =
        stringFromUnknown(record?.path) ??
        stringFromUnknown(record?.filePath) ??
        stringFromUnknown(record?.pathAfter) ??
        stringFromUnknown(record?.pathBefore);
      if (path !== null) return path;
    }
    return null;
  }
  if (item.type === "mcpToolCall") {
    const server = stringFromUnknown(item.server) ?? "MCP";
    const tool = stringFromUnknown(item.tool) ?? "tool";
    return `${server} · ${tool}`;
  }
  if (item.type === "dynamicToolCall") {
    return stringFromUnknown(item.name) ?? stringFromUnknown(item.tool);
  }
  if (item.type === "collabAgentToolCall") return stringFromUnknown(item.tool);
  if (item.type === "webSearch") return stringFromUnknown(item.query);
  if (item.type === "imageGeneration") return stringFromUnknown(item.prompt);
  return null;
}
