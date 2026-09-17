import type { AppServerThread, HostRecord } from "~~/shared/types";
import type { ControllerRegistry } from "./controller-registry";
import { z } from "zod";
import { appServerThreadSchema } from "~~/shared/runtime/app-server";

const threadListPageSchema = z
  .object({
    data: z.array(appServerThreadSchema),
    nextCursor: z.string().nullable().optional(),
  })
  .loose();

const modelRecordSchema = z
  .object({ id: z.string(), model: z.string(), displayName: z.string() })
  .loose();
const modelListPageSchema = z
  .object({
    data: z.array(modelRecordSchema),
    nextCursor: z.string().nullable().optional(),
  })
  .loose();
const configReadResponseSchema = z
  .object({
    config: z
      .object({
        model: z.string().nullable(),
        model_reasoning_effort: z.string().nullable(),
      })
      .loose(),
  })
  .loose();

export interface ThreadListPage {
  data: AppServerThread[];
  nextCursor?: string | null;
  [key: string]: unknown;
}

export class ThreadCatalogService {
  constructor(private readonly registry: ControllerRegistry) {}

  async listThreads(host: HostRecord, params: Record<string, unknown>): Promise<ThreadListPage> {
    const client = await this.registry.getHostClient(host);
    const page = threadListPageSchema.parse(await client.request("thread/list", params));
    return page;
  }

  async listModels(host: HostRecord, params: Record<string, unknown>) {
    const client = await this.registry.getHostClient(host);
    const page = modelListPageSchema.parse(await client.request("model/list", params));

    // model/list returns Codex's built-in catalog regardless of the configured provider. Under a
    // custom model_provider the config.toml model is absent from the catalog; surface it so the
    // composer can display and select the real default instead of pretending it doesn't exist.
    try {
      const configRead = configReadResponseSchema.parse(
        await client.request("config/read", { includeLayers: false }),
      );
      const configuredModel = configRead.config.model;
      if (
        configuredModel !== null &&
        configuredModel !== "" &&
        !page.data.some((record) => record.model === configuredModel)
      ) {
        return {
          ...page,
          data: [
            {
              id: configuredModel,
              model: configuredModel,
              displayName: configuredModel,
              isDefault: true,
              defaultReasoningEffort: configRead.config.model_reasoning_effort,
            },
            ...page.data,
          ],
        };
      }
    } catch {
      // config/read is best-effort enrichment; the catalog alone stays usable without it.
    }
    return page;
  }
}
