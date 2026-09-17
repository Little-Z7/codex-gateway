import { reactive, watch, type ComputedRef } from "vue";
import { itemStatusSignature, statusValue } from "./thread-turn-sections";
import type { ThreadTimelineItem } from "~~/shared/types";

interface IntermediateDisclosureTurn {
  id: string;
  status: unknown;
  items: ThreadTimelineItem[];
  turnIsActive: boolean;
}

export function useIntermediateStepsDisclosure(input: {
  turns: ComputedRef<IntermediateDisclosureTurn[]>;
  threadIsRunning: ComputedRef<boolean>;
  autoCollapseIntermediate: ComputedRef<boolean>;
}) {
  // Disclosure state belongs to the timeline, not to virtual row components. Rows are destroyed
  // offscreen, so keeping this small per-turn map here preserves explicit user choices without
  // coupling expansion to virtualizer measurements or a global store.
  const openByTurnId = reactive(new Map<string, boolean>());
  const touchedByUser = new Set<string>();
  // Turns observed while running are the only ones that may re-expand when a detached reader is
  // parked mid-scroll; freshly loaded historical turns stay collapsed.
  const seenActive = new Set<string>();

  watch(
    () => [
      input.threadIsRunning.value,
      input.autoCollapseIntermediate.value,
      ...input.turns.value.flatMap((turn) => [
        turn.id,
        statusValue(turn.status),
        ...itemStatusSignature(turn.items),
      ]),
    ],
    () => {
      const liveTurnIds = new Set(input.turns.value.map((turn) => turn.id));
      for (const turnId of openByTurnId.keys()) {
        if (!liveTurnIds.has(turnId)) {
          openByTurnId.delete(turnId);
          touchedByUser.delete(turnId);
          seenActive.delete(turnId);
        }
      }

      for (const turn of input.turns.value) {
        // Live work stays collapsed by default; the header surfaces the newest step's summary
        // instead of a streaming wall. The user can still open it explicitly.
        if (input.threadIsRunning.value && turn.turnIsActive) {
          touchedByUser.delete(turn.id);
          seenActive.add(turn.id);
          if (!openByTurnId.has(turn.id)) openByTurnId.set(turn.id, false);
          continue;
        }
        if (input.autoCollapseIntermediate.value && !touchedByUser.has(turn.id)) {
          openByTurnId.set(turn.id, false);
        } else if (
          !touchedByUser.has(turn.id) &&
          seenActive.has(turn.id) &&
          openByTurnId.get(turn.id) === false
        ) {
          // A detached reader was mid-scroll when the turn finished: expand the completed work so
          // their anchor stays visible instead of collapsing the row out from under them.
          openByTurnId.set(turn.id, true);
        } else if (!openByTurnId.has(turn.id)) {
          openByTurnId.set(turn.id, false);
        }
      }
    },
    { immediate: true },
  );

  function isIntermediateOpen(turnId: string) {
    return openByTurnId.get(turnId) ?? false;
  }

  function setIntermediateOpen(turnId: string, open: boolean) {
    const turn = input.turns.value.find((candidate) => candidate.id === turnId);
    // Opening live work is temporary inspection, not a request to keep historical work expanded.
    // Previously a click after the final stream delta but before turn/completed raced the watcher:
    // no later running-state update remained to clear touchedByUser, so completion stayed open.
    // Completed-turn clicks are the only durable disclosure choice; they remain open until the user
    // closes them, while every active turn still follows the normal completion auto-collapse policy.
    if (input.threadIsRunning.value && turn?.turnIsActive === true) {
      touchedByUser.delete(turnId);
    } else {
      touchedByUser.add(turnId);
    }
    openByTurnId.set(turnId, open);
  }

  return {
    isIntermediateOpen,
    setIntermediateOpen,
  };
}
