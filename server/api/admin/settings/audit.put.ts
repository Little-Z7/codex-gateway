import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import {
  auditSettings,
  saveAuditRetentionDays,
} from "../../../utils/gateway/settings/model-provider";

const bodySchema = z.object({
  retentionDays: z.number().int().min(1).max(3650),
});

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body));
  saveAuditRetentionDays(input.retentionDays);
  auditLog.record(admin, "settings.audit.update", {
    type: "system",
    id: "audit",
    label: "audit retention",
  });
  return { audit: auditSettings() };
});
