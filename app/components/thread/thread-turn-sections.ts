import { isThreadActiveStatus } from "~~/shared/thread-runtime-status";
import type { ThreadTimelineItem, ThreadTimelineTurn } from "~~/shared/types";
import { isThreadPlanItem } from "@/utils/thread-plan";
import { recordFromUnknown } from "~~/shared/utils/records";

export interface ThreadTurnSections {
  items: ThreadTimelineItem[];
  intermediateItems: ThreadTimelineItem[];
  finalItems: ThreadTimelineItem[];
  finalAgentIndex: number;
  hasFinalAnswer: boolean;
  turnIsActive: boolean;
}

export function buildThreadTurnSections(
  turn: ThreadTimelineTurn,
  options: { planModeActive: boolean },
): ThreadTurnSections {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const finalAgentIndex = findFinalAgentIndex(items, turn.status, options.planModeActive);
  const hasFinalAnswer = finalAgentIndex >= 0;

  return {
    items,
    finalAgentIndex,
    hasFinalAnswer,
    turnIsActive: isTurnActive(turn, items),
    intermediateItems: items.filter(
      (item, index) => (!hasFinalAnswer || index < finalAgentIndex) && isIntermediateItem(item),
    ),
    finalItems: hasFinalAnswer ? items.slice(finalAgentIndex) : [],
  };
}

export function itemKey(item: ThreadTimelineItem, section: string, index: number) {
  const id = typeof item.id === "string" && item.id !== "" ? item.id : item.clientId;
  return typeof id === "string" && id !== "" ? id : `${section}-${index}-${item.type}`;
}

export function statusValue(status: unknown) {
  return typeof status === "string" ? status : recordFromUnknown(status)?.type;
}

export function itemStatusSignature(items: ThreadTimelineItem[]) {
  return items.map((item) => statusValue(item.status));
}

function findFinalAgentIndex(
  turnItems: ThreadTimelineItem[],
  status: unknown,
  preferPlanFinal: boolean,
) {
  const explicitFinalIndex = findLastIndex(
    turnItems,
    (item) => item?.type === "agentMessage" && item?.phase === "final_answer",
  );
  if (explicitFinalIndex >= 0) {
    return explicitFinalIndex;
  }
  if (status !== "completed") {
    return -1;
  }
  if (preferPlanFinal) {
    const finalPlanIndex = findLastIndex(turnItems, isThreadPlanItem);
    if (finalPlanIndex >= 0) {
      return finalPlanIndex;
    }
  }
  const finalAgentMessageIndex = findLastIndex(turnItems, (item) => item?.type === "agentMessage");
  if (finalAgentMessageIndex >= 0) {
    return finalAgentMessageIndex;
  }
  return findLastIndex(turnItems, (item) => item?.type === "appNotification");
}

function isLeadTranscriptItem(item: ThreadTimelineItem) {
  return item?.type === "userMessage" || item?.type === "threadGoal";
}

function isIntermediateItem(item: ThreadTimelineItem) {
  return !isLeadTranscriptItem(item);
}

function isTurnActive(turn: ThreadTimelineTurn, items: ThreadTimelineItem[]) {
  return (
    isThreadActiveStatus(turn.status) || items.some((item) => isThreadActiveStatus(item?.status))
  );
}

function findLastIndex<T>(list: T[], predicate: (item: T) => boolean) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (item !== undefined && predicate(item)) {
      return index;
    }
  }
  return -1;
}
