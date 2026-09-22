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
  // Turns observed while running are the only ones that may re-expand automatically once they
  // finish; freshly loaded historical turns never auto-expand.
  const seenActive = new Set<string>();
  // Once the user has explicitly opened or closed a turn's disclosure, its state is theirs: the
  // automatic detached-reader reopen below must never override that choice again.
  const touchedByUser = new Set<string>();

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
      for (const turnId of seenActive) {
        if (!liveTurnIds.has(turnId)) seenActive.delete(turnId);
      }
      for (const turnId of touchedByUser) {
        if (!liveTurnIds.has(turnId)) touchedByUser.delete(turnId);
      }

      if (userSelectedTurnId.value !== null) {
        openTurnId.value = userSelectedTurnId.value;
        return;
      }

      for (const turn of turns) {
        if (input.threadIsRunning.value && turn.turnIsActive) {
          seenActive.add(turn.id);
        }
      }

      // Live work stays collapsed by default; the header surfaces the newest step's summary
      // instead of a streaming wall. A reader who has scrolled away mid-stream is the exception:
      // collapsing a turn the instant it finishes would yank content out from under them, so the
      // most recently finished, untouched turn they were watching stays expanded until they act.
      if (input.autoCollapseIntermediate.value) {
        openTurnId.value = null;
        return;
      }
      const reopenCandidate = turns.findLast(
        (turn) =>
          !(input.threadIsRunning.value && turn.turnIsActive) &&
          seenActive.has(turn.id) &&
          !touchedByUser.has(turn.id),
      );
      openTurnId.value = reopenCandidate?.id ?? null;
    },
    { immediate: true },
  );

  function isIntermediateOpen(turnId: string) {
    return openTurnId.value === turnId;
  }

  function setIntermediateOpen(turnId: string, open: boolean) {
    // A click is the user's explicit accordion selection, regardless of whether the Turn is still
    // streaming. It remains the sole open Turn until the user closes it or it leaves the retained
    // timeline; another active Turn must never reopen alongside the one the user chose, and the
    // automatic detached-reader reopen never overrides an explicit choice again.
    touchedByUser.add(turnId);
    userSelectedTurnId.value = open ? turnId : null;
    openTurnId.value = open ? turnId : null;
  }

  return {
    isIntermediateOpen,
    setIntermediateOpen,
  };
}
