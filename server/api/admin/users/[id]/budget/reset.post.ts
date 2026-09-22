import { getRouterParam } from "h3";
import { requireAdmin } from "../../../../../utils/gateway/auth/context";
import { userStore } from "../../../../../utils/gateway/auth/users";
import {
  defineGatewayEventHandler,
  gatewayApiError,
} from "../../../../../utils/gateway/http/errors";
import { auditLog } from "../../../../../utils/gateway/audit/audit-log";
import { requireRecord } from "../../../../../utils/gateway/http/validation/common";
import { snapshotForUser } from "../../../../../utils/gateway/usage/budget-store";
import { usageStore } from "../../../../../utils/gateway/usage/usage-store";

export default defineGatewayEventHandler((event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw gatewayApiError("common.notFound", 404, "User not found");
  }
  const target = requireRecord(userStore.findById(id), "User not found");
  usageStore.resetCurrentPeriod(id);
  auditLog.record(admin, "budget.reset", { type: "user", id, label: target.username });
  return { budget: snapshotForUser(id), lastResetAt: new Date().toISOString() };
});
