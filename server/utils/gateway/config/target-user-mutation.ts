import { withUserConfigLock } from "../http/config-mutation";
import { ensureUserConfigLoaded } from "../http/errors";
import { runWithGatewayUser } from "../state/memory";
import { userConfigMutationService } from "./user-config-mutation-service";

/**
 * Runs a durable config mutation against a *target* user (typically an admin acting on a member).
 * Order matters: the per-user lock serializes with that user's own requests, the user scope makes
 * memory stores resolve to the target user, and ensureUserConfigLoaded prevents a stale empty
 * state from overwriting the target's stored config.
 */
export async function runAsUserConfigMutation<T>(
  targetUserId: number,
  mutate: () => T | Promise<T>,
): Promise<T> {
  return withUserConfigLock(targetUserId).runExclusive(async () =>
    runWithGatewayUser(targetUserId, async () => {
      ensureUserConfigLoaded(targetUserId);
      return userConfigMutationService.commit(targetUserId, mutate);
    }),
  );
}
