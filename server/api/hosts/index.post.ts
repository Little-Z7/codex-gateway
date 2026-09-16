import { readValidatedBody } from "h3";
import { requireAdmin } from "../../utils/gateway/auth/context";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import { hostCreateSchema } from "../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../utils/gateway/state/hosts";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler(async (event) => {
  // Members cannot register their own hosts; administrators assign managed hosts instead.
  requireAdmin(event);
  const input = await readValidatedBody(event, (body) => hostCreateSchema.parse(body));
  return userConfigMutationService.commit(event.context.auth!.user.id, () =>
    hostStore.create(input),
  );
});
