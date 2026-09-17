import { getQuery } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { usageStore } from "../../utils/gateway/usage/usage-store";
import { userStore } from "../../utils/gateway/auth/users";

const querySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  groupBy: z.enum(["user", "day", "model"]).default("user"),
});

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const query = querySchema.parse(getQuery(event));
  const rows = usageStore.query(query);
  const usernames = new Map(userStore.listUsers().map((user) => [String(user.id), user.username]));
  return {
    rows: rows.map((row) => ({
      ...row,
      label: query.groupBy === "user" ? (usernames.get(row.bucket) ?? row.bucket) : row.bucket,
    })),
  };
});
