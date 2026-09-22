import { readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { budgetDefaults, saveBudgetDefaults } from "../../../utils/gateway/usage/budget-store";

const limitSchema = z.number().int().min(0).nullable();

const bodySchema = z
  .object({
    dailyTokens: limitSchema,
    monthlyTokens: limitSchema,
    dailyTurns: limitSchema,
    monthlyTurns: limitSchema,
    warnPercent: z.number().int().min(1).max(100),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  const admin = requireAdmin(event);
  const input = await readValidatedBody(event, (body) => bodySchema.parse(body));
  saveBudgetDefaults(input);
  auditLog.record(
    admin,
    "settings.budget.update",
    { type: "system", id: "budget", label: "budget defaults" },
    {
      dailyTokens: input.dailyTokens,
      monthlyTokens: input.monthlyTokens,
      dailyTurns: input.dailyTurns,
      monthlyTurns: input.monthlyTurns,
      warnPercent: input.warnPercent,
    },
  );
  return { defaults: budgetDefaults() };
});
