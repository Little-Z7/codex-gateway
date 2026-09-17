import { getQuery, setResponseHeader } from "h3";
import { requireAdmin } from "../../../utils/gateway/auth/context";
import { auditLog } from "../../../utils/gateway/audit/audit-log";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const query = getQuery(event);
  const rows = auditLog.exportRows({
    userId: query.userId === undefined || query.userId === "" ? undefined : Number(query.userId),
    action: typeof query.action === "string" ? query.action : undefined,
  });
  const lines = [
    "id,created_at,actor_user_id,actor_username,action,target_type,target_id,target_label,detail",
    ...rows.map((row) =>
      [
        row.id,
        row.createdAt,
        row.actorUserId,
        row.actorUsername,
        row.action,
        row.targetType,
        row.targetId,
        row.targetLabel,
        row.detail,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  setResponseHeader(event, "content-type", "text/csv; charset=utf-8");
  setResponseHeader(event, "content-disposition", 'attachment; filename="audit.csv"');
  return lines.join("\n") + "\n";
});
