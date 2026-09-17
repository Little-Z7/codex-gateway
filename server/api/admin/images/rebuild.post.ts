import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler, gatewayApiError } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { startImageRebuild } from "../../../utils/gateway/provisioning/image-rebuild";

const bodySchema = z
  .object({
    codexVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional(),
  })
  .strict()
  .optional();

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body ?? undefined)).catch(
    () => undefined,
  );
  try {
    const status = await startImageRebuild({ codexVersion: input?.codexVersion });
    auditLog.record(
      admin,
      "image.rebuild",
      { type: "system", id: null, label: "user image" },
      {
        codexVersion: input?.codexVersion ?? null,
      },
    );
    return status;
  } catch (error) {
    if (error instanceof Error && error.message.includes("already running")) {
      throw gatewayApiError("admin.rebuildBusy", 409, error.message);
    }
    throw error;
  }
});
