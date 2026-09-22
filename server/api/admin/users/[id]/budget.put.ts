import { getRouterParam, readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../../utils/gateway/auth/context";
import { userStore } from "../../../../utils/gateway/auth/users";
import { defineGatewayEventHandler, gatewayApiError } from "../../../../utils/gateway/http/errors";
import { auditLog } from "../../../../utils/gateway/audit/audit-log";
import { requireRecord } from "../../../../utils/gateway/http/validation/common";
import {
  deleteUserBudget,
  snapshotForUser,
  upsertUserBudget,
  userBudgetRow,
  effectiveLimitsFor,
} from "../../../../utils/gateway/usage/budget-store";

const limitSchema = z.number().int().min(0).nullable().optional();

const bodySchema = z
  .object({
    dailyTokens: limitSchema,
    monthlyTokens: limitSchema,
    dailyTurns: limitSchema,
    monthlyTurns: limitSchema,
    useDefaults: z.boolean().optional(),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw gatewayApiError("common.notFound", 404, "User not found");
  }
  const target = requireRecord(userStore.findById(id), "User not found");
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body));
  if (input.useDefaults === true) {
    deleteUserBudget(id);
    auditLog.record(
      admin,
      "budget.update",
      { type: "user", id, label: target.username },
      {
        useDefaults: true,
      },
    );
    return { budget: snapshotForUser(id) };
  }
  const current = effectiveLimitsFor(userBudgetRow(id)).limits;
  const limits = {
    dailyTokens: input.dailyTokens !== undefined ? input.dailyTokens : current.dailyTokens,
    monthlyTokens: input.monthlyTokens !== undefined ? input.monthlyTokens : current.monthlyTokens,
    dailyTurns: input.dailyTurns !== undefined ? input.dailyTurns : current.dailyTurns,
    monthlyTurns: input.monthlyTurns !== undefined ? input.monthlyTurns : current.monthlyTurns,
  };
  upsertUserBudget(id, limits);
  auditLog.record(admin, "budget.update", { type: "user", id, label: target.username }, limits);
  return { budget: snapshotForUser(id) };
});
