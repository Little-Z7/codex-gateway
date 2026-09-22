// Type shims for the custom Nitro node entry (server/nitro/node-entry.mjs). These mirror the
// signatures of the stock node-server entry bundled into .output; Nitro resolves them at build
// time even though the application tsconfig cannot see the virtual/internal modules.
export {};

declare module "#nitro-internal-pollyfills";

declare module "nitropack/runtime/internal" {
  import type { Server } from "node:net";
  import type { NitroApp } from "nitropack";
  export function setupGracefulShutdown(server: Server, nitroApp: NitroApp): void;
  export function startScheduleRunner(): void;
  export function trapUnhandledNodeErrors(): void;
}

declare module "destr" {
  export default function destr<T = unknown>(value: unknown): T | undefined;
}

declare module "crossws/adapters/node" {
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";
  import type { H3 } from "h3";
  export default function wsAdapter(websocket: H3["websocket"]): {
    handleUpgrade: (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      webRequest?: Request,
    ) => Promise<void>;
  };
}

declare global {
  interface ImportMeta {
    readonly _websocket?: boolean;
    readonly _tasks?: boolean;
  }
}
