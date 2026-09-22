import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import {
  saveSecuritySettings,
  securitySettings,
} from "../../../utils/gateway/settings/model-provider";

const bodySchema = z.object({
  loginMaxFailures: z.number().int().min(1).max(100).optional(),
  lockoutMinutes: z.number().int().min(1).max(1440).optional(),
  sessionDays: z.number().int().min(1).max(3650).optional(),
  allowSelfPasswordChange: z.boolean().optional(),
});

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body));
  saveSecuritySettings(input);
  const security = securitySettings();
  auditLog.record(admin, "settings.security.update", {
    type: "system",
    id: "security",
    label: "security settings",
  });
  return { security };
});
