import { z } from "zod";
import type { AgentProjectDefaults, ApprovalPolicy } from "~~/shared/types";
import type { AgentRpcClient } from "../../provider-adapter";

const configReadResponseSchema = z
  .object({
    config: z
      .object({
        model: z.string().nullable(),
        model_reasoning_effort: z.string().nullable(),
        approval_policy: z.unknown().optional(),
        approvalPolicy: z.unknown().optional(),
      })
      .loose(),
  })
  .loose();

export async function readCodexProjectDefaults(
  client: AgentRpcClient,
  cwd: string,
): Promise<AgentProjectDefaults> {
  // config/read is the only authoritative pre-thread view of Codex's layered configuration.
  // model/list.isDefault describes the catalog, not ~/.codex/config.toml or project overrides.
  const response = configReadResponseSchema.parse(
    await client.request("config/read", { cwd, includeLayers: false }),
  );
  return {
    provider: "codex",
    model: response.config.model,
    effort: response.config.model_reasoning_effort,
    approvalPolicy: approvalPolicyFromConfig(
      response.config.approval_policy ?? response.config.approvalPolicy,
    ),
  };
}

function approvalPolicyFromConfig(value: unknown): ApprovalPolicy | null {
  if (value === "untrusted" || value === "on-request" || value === "never") return value;
  return null;
}
