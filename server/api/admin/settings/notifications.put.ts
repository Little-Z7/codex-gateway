import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { saveNotificationSettings } from "../../../utils/gateway/settings/model-provider";

const bodySchema = z.object({
  barkServerUrl: z.union([z.url(), z.literal(""), z.null()]),
});

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body));
  const barkServerUrl = input.barkServerUrl === "" ? null : (input.barkServerUrl ?? null);
  saveNotificationSettings({ barkServerUrl });
  auditLog.record(admin, "settings.notifications.update", {
    type: "system",
    id: "notifications",
    label: "notification settings",
  });
  return { notifications: { barkServerUrl } };
});
