// Per-user network isolation (CODEX_GATEWAY_USER_NETWORK_ISOLATION=per-user). Each user's
// container gets its own `Internal: true` Docker bridge network so it cannot reach other users'
// containers, the LAN, or the internet directly. The Gateway's own container and (optionally) the
// outbound proxy container are connected into every per-user network so SSH and outbound proxying
// keep working. See deploy/README.zh-CN.md's "安全加固" section for the full threat model,
// including the two residual gaps (Gateway HTTP port and proxy control port reachable over the
// same L2 segment; a container's own bridge gateway IP reaching host services bound to 0.0.0.0)
// that Docker's `Internal` flag alone does not close and that require a small, documented,
// host-level iptables setup instead of code here — this module only owns the Docker-native half.
import { hostname } from "node:os";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { DockerEngineClient, DockerEngineError, isDockerNotFound } from "./docker-engine-client";
import { runtimeLog } from "../runtime/runtime-log";
import type { ProvisioningConfig } from "./provisioning-config";

export const USER_NETWORK_LABEL = "codex-gateway.user-network";

export function userNetworkNameFor(prefix: string, username: string) {
  return `${prefix}${username}-net`;
}

function parseIPv4(ip: string): number {
  const parts = ip.split(".").map((part) => Number(part));
  const valid =
    parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  if (!valid) throw new Error(`invalid IPv4 address: "${ip}"`);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function formatIPv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
    ".",
  );
}

function parseSubnetBase(base: string): { address: string; prefix: number } {
  const [address, prefixRaw] = base.split("/");
  const prefix = Number(prefixRaw);
  if (address === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 24) {
    throw new Error(
      `CODEX_GATEWAY_USER_NETWORK_SUBNET_BASE must be a CIDR with prefix length <= 24, got "${base}"`,
    );
  }
  return { address, prefix };
}

/** Number of distinct /24 slots the reserved supernet can carve out for per-user networks. */
export function userNetworkPoolSize(base: string): number {
  const { prefix } = parseSubnetBase(base);
  return 2 ** (24 - prefix);
}

/**
 * Splits a reserved supernet (default 172.30.0.0/16) into deterministic /24 slots, one per user
 * network. This is what lets a *single, static* host firewall rule matched by source subnet
 * (rather than per-network destination IP) cover every current and future per-user network
 * without the Gateway needing host-level iptables access — see deploy/README.zh-CN.md.
 */
export function computeUserSubnet(base: string, index: number): string {
  const { address, prefix } = parseSubnetBase(base);
  const poolSize = 2 ** (24 - prefix);
  const normalizedIndex = ((index % poolSize) + poolSize) % poolSize;
  const subnetNum = (parseIPv4(address) + (normalizedIndex << 8)) >>> 0;
  return `${formatIPv4(subnetNum)}/24`;
}

function subnetFromInspect(inspect: Record<string, unknown> | null): string | null {
  const ipam = recordFromUnknown(inspect?.IPAM);
  const configs = Array.isArray(ipam?.Config) ? ipam.Config : [];
  const first = recordFromUnknown(configs[0]);
  return first === null ? null : stringFromUnknown(first.Subnet);
}

function isPoolOverlap(error: unknown) {
  return error instanceof Error && /overlap/i.test(error.message);
}

export function isDockerConflict(error: unknown) {
  return (
    error instanceof DockerEngineError && (error.statusCode === 409 || error.statusCode === 403)
  );
}

function isAlreadyConnected(error: unknown) {
  return (
    error instanceof Error &&
    /already exists|already attached|already connected/i.test(error.message)
  );
}

function isNotConnected(error: unknown) {
  return error instanceof Error && /not (a )?connected|is not connected/i.test(error.message);
}

/**
 * Ensures a per-user internal bridge network exists, reusing it by name when already present
 * (a recreate flow that only tore down the container keeps the network stable), otherwise
 * creating it with a deterministic subnet slot carved from the reserved supernet — probing
 * forward through the pool on a rare overlap collision.
 */
export async function ensureUserNetwork(
  docker: DockerEngineClient,
  options: { name: string; subnetBase: string; startIndex: number; username: string },
): Promise<{ name: string; subnet: string | null }> {
  try {
    const existing = await docker.inspectNetwork(options.name);
    return { name: options.name, subnet: subnetFromInspect(existing) };
  } catch (error) {
    if (!isDockerNotFound(error)) throw error;
  }
  const poolSize = userNetworkPoolSize(options.subnetBase);
  const attempts = Math.min(poolSize, 512);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const subnet = computeUserSubnet(options.subnetBase, options.startIndex + attempt);
    try {
      await docker.createNetwork({
        Name: options.name,
        Driver: "bridge",
        Internal: true,
        IPAM: { Config: [{ Subnet: subnet }] },
        Labels: { [USER_NETWORK_LABEL]: "true", "codex-gateway.user": options.username },
      });
      return { name: options.name, subnet };
    } catch (error) {
      if (isPoolOverlap(error)) {
        lastError = error;
        continue;
      }
      if (isDockerConflict(error)) {
        const existing = await docker.inspectNetwork(options.name).catch(() => null);
        if (existing !== null) return { name: options.name, subnet: subnetFromInspect(existing) };
      }
      throw error;
    }
  }
  throw new Error(
    `No free subnet for user network "${options.name}" in ${options.subnetBase} after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Attach that ignores "already connected"; with `tolerateMissing` (the default, for background
 *  reconnect sweeps) it also ignores a network or container that no longer exists. */
export async function connectIfNeeded(
  docker: DockerEngineClient,
  network: string,
  container: string,
  tolerateMissing = true,
) {
  try {
    await docker.connectNetwork(network, container);
  } catch (error) {
    if (isAlreadyConnected(error) || (tolerateMissing && isDockerNotFound(error))) return;
    throw error;
  }
}

/** Best-effort detach: ignores "not connected" and a network/container that is already gone. */
export async function disconnectIfPresent(
  docker: DockerEngineClient,
  network: string,
  container: string,
) {
  try {
    await docker.disconnectNetwork(network, container, true);
  } catch (error) {
    if (isDockerNotFound(error) || isNotConnected(error)) return;
    throw error;
  }
}

type InfraConfig = Pick<ProvisioningConfig, "selfContainer" | "outboundProxyContainer">;

function selfContainerRef(config: InfraConfig) {
  // Docker sets a container's hostname to its own (short) container ID unless the compose file
  // overrides `hostname:` — neither docker-compose.yml nor tests/e2e/docker-compose.yml do this
  // for the Gateway service, so os.hostname() reliably resolves to a Docker Engine API-addressable
  // identifier with zero configuration. CODEX_GATEWAY_SELF_CONTAINER overrides it for topologies
  // that do set a custom hostname.
  return config.selfContainer ?? hostname();
}

/**
 * Attaches the Gateway's own container and (if configured) the outbound proxy container to a
 * per-user network. Called right after the network is created, and again on every Gateway
 * startup and periodic reconcile pass so a *recreated* Gateway or proxy container regains access
 * (see `reconnectAllUserNetworks`).
 */
export async function attachInfraToUserNetwork(
  docker: DockerEngineClient,
  config: InfraConfig,
  networkName: string,
  tolerateMissing = true,
) {
  await connectIfNeeded(docker, networkName, selfContainerRef(config), tolerateMissing);
  if (config.outboundProxyContainer !== null) {
    await connectIfNeeded(docker, networkName, config.outboundProxyContainer, tolerateMissing);
  }
}

/** Detaches the Gateway/proxy containers and removes the network (full deprovision only). */
export async function detachInfraAndRemoveUserNetwork(
  docker: DockerEngineClient,
  config: InfraConfig,
  networkName: string,
) {
  await disconnectIfPresent(docker, networkName, selfContainerRef(config));
  if (config.outboundProxyContainer !== null) {
    await disconnectIfPresent(docker, networkName, config.outboundProxyContainer);
  }
  try {
    await docker.removeNetwork(networkName);
  } catch (error) {
    if (!isDockerNotFound(error)) throw error;
  }
}

/**
 * Re-attaches the Gateway's own container (and the outbound proxy container) to every provisioned
 * user's isolated network. Safe to call unconditionally and often: connecting an already-connected
 * container is a no-op. Run at Gateway startup (a restarted/recreated Gateway container loses its
 * previous network memberships) and on every periodic reconcile pass (in case the *proxy*
 * container was recreated by something outside the Gateway).
 */
export async function reconnectAllUserNetworks(
  docker: DockerEngineClient,
  config: InfraConfig,
  networks: string[],
) {
  for (const name of networks) {
    try {
      await attachInfraToUserNetwork(docker, config, name);
    } catch (error) {
      runtimeLog("user network reconnect failed", {
        network: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
