import { ref, watch, type ComputedRef } from "vue";
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
  // A timeline is an accordion, not a set of independent disclosures. Keeping one id prevents
  // concurrent/continued Turns from mounting every intermediate stream at once, while locating the
  // state above virtual rows preserves it when offscreen rows are destroyed and recreated.
  const openTurnId = ref<string | null>(null);
  const userSelectedTurnId = ref<string | null>(null);

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
      const turns = input.turns.value;
      const liveTurnIds = new Set(turns.map((turn) => turn.id));
      if (userSelectedTurnId.value !== null && !liveTurnIds.has(userSelectedTurnId.value)) {
        userSelectedTurnId.value = null;
      }
      if (openTurnId.value !== null && !liveTurnIds.has(openTurnId.value)) {
        openTurnId.value = null;
      }

      if (userSelectedTurnId.value !== null) {
        openTurnId.value = userSelectedTurnId.value;
        return;
      }

      const latestActiveTurn = turns.findLast(
        (turn) => input.threadIsRunning.value && turn.turnIsActive,
      );
      if (latestActiveTurn !== undefined) {
        openTurnId.value = latestActiveTurn.id;
      } else if (input.autoCollapseIntermediate.value) {
        openTurnId.value = null;
      }
    },
    { immediate: true },
  );

  function isIntermediateOpen(turnId: string) {
    return openTurnId.value === turnId;
  }

  function setIntermediateOpen(turnId: string, open: boolean) {
    // A click is the user's explicit accordion selection, regardless of whether the Turn is still
    // streaming. It remains the sole open Turn until the user closes it or it leaves the retained
    // timeline; another active Turn must never reopen alongside the one the user chose.
    userSelectedTurnId.value = open ? turnId : null;
    openTurnId.value = open ? turnId : null;
  }

  return {
    isIntermediateOpen,
    setIntermediateOpen,
  };
}
