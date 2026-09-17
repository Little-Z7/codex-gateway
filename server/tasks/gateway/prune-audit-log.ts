import { auditLog } from "../../utils/gateway/audit/audit-log";
import { auditSettings } from "../../utils/gateway/settings/model-provider";

export default defineTask({
  meta: {
    name: "gateway:prune-audit-log",
    description: "Delete audit_log rows older than the configured retention window.",
  },
  async run() {
    const retentionDays = auditSettings().retentionDays;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const deleted = auditLog.pruneBefore(cutoff);
    if (deleted > 0) {
      auditLog.record(
        null,
        "audit.prune",
        { type: "system", id: "audit_log", label: "audit log" },
        { deleted, retentionDays },
      );
    }
    return { result: { deleted } };
  },
});
