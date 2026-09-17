import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { securitySettings } from "../../utils/gateway/settings/model-provider";

export default defineEventHandler((event) => {
  return {
    user: requireAuthenticatedUser(event),
    features: { selfPasswordChange: securitySettings().allowSelfPasswordChange },
  };
});
