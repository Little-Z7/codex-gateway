import { requireAuthenticatedUser } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import { securitySettings } from "../../utils/gateway/settings/model-provider";

export default defineEventHandler((event) => {
  const user = requireAuthenticatedUser(event);
  const record = userStore.findById(user.id);
  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: record?.displayName ?? null,
      mustChangePassword: record?.mustChangePassword === true,
    },
    features: {
      selfPasswordChange:
        securitySettings().allowSelfPasswordChange || record?.mustChangePassword === true,
    },
  };
});
