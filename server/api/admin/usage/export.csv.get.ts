import { getQuery, setResponseHeader } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";
import { usageStore } from "../../../utils/gateway/usage/usage-store";

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

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const query = querySchema.parse(getQuery(event));
  const rows = usageStore.query(query);
  const lines = [
    "bucket,threads,turns,input_tokens,output_tokens",
    ...rows.map((row) =>
      [row.bucket, row.threads, row.turns, row.inputTokens, row.outputTokens]
        .map(csvCell)
        .join(","),
    ),
  ];
  setResponseHeader(event, "content-type", "text/csv; charset=utf-8");
  setResponseHeader(event, "content-disposition", 'attachment; filename="usage.csv"');
  return lines.join("\n") + "\n";
});
