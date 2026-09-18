import type { AgentProviderId } from "../agent/providers";
import type { ApprovalPolicy, ReasoningEffort } from "./thread";

/** Effective new-thread defaults resolved by the agent provider for one project directory. */
export interface AgentProjectDefaults {
  provider: AgentProviderId;
  model: string | null;
  effort: ReasoningEffort | null;
  approvalPolicy: ApprovalPolicy | null;
}
