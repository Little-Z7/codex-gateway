import { useAuthStore } from "@/stores/auth";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { messageFromError } from "@/stores/gateway/thread-utils/identity";
import {
  hasGatewayRouteSelection,
  readGatewayRouteSelection,
  writeGatewayRouteSelection,
} from "@/stores/gateway/route-state";
import { useGatewayBootstrapStore } from ".";

// Restoring the last-open thread reads a browser-local hint that never validates its threadId
// against the server. An unreachable or deleted thread can leave the underlying request
// unsettled, which must not hang the whole bootstrap. Give it its own deadline, well under the
// realtime broker's 31-minute long-operation timeout (see gateway-realtime/request-broker.ts).
const RESTORE_LAST_OPEN_THREAD_TIMEOUT_MS = 20_000;

// hydrateNavigationData chains three sequential realtime requests (connectAllHosts -> listModels
// -> listThreads, each possibly repeated once a project is auto-selected). Any one of them can hang
// up to the realtime broker's 31-minute long-operation timeout (see gateway-realtime/request-broker.ts).
// Without its own deadline, a stuck host connection or thread listing leaves `initializing` stuck at
// true forever, since it is only cleared in this module's outer `finally`. Bound the whole chain so
// bootstrap always reaches that `finally`.
const HYDRATE_NAVIGATION_TIMEOUT_MS = 30_000;

/** Orchestrates independent stores without making the bootstrap state store import them. */
export async function refreshGatewayClient() {
  const auth = useAuthStore();
  const sessionEpoch = auth.sessionEpoch;
  const bootstrap = useGatewayBootstrapStore();
  const catalog = useGatewayCatalogStore();
  const config = useGatewayConfigStore();
  const navigation = useGatewayNavigationStore();
  const views = useGatewayThreadViewStore();
  const refreshViewEpoch = views.viewEpoch;
  const sessionIsCurrent = () => auth.isCurrentSession(sessionEpoch);

  bootstrap.initializing = true;
  views.loading = true;
  bootstrap.clearError();
  try {
    const routeSelection = readGatewayRouteSelection();
    useGatewayRealtimeStore().connectHostLifecycleEvents();
    catalog.projects = [];
    catalog.projectDirectoryAvailability = {};
    navigation.threads = [];
    catalog.models = [];
    catalog.modelsHostId = null;
    if (!(await config.loadConfigFromServer()) || !sessionIsCurrent()) return;

    const routeHostExists =
      routeSelection.hostId !== null
        ? catalog.hosts.some((host) => host.id === routeSelection.hostId)
        : false;
    if (routeHostExists) navigation.selectedHostId = routeSelection.hostId;
    else if (navigation.selectedHostId === null) {
      navigation.selectedHostId = catalog.hosts[0]?.id ?? null;
    }
    navigation.selectedProjectId = routeHostExists ? routeSelection.projectId : null;
    navigation.selectedThreadId = routeHostExists ? routeSelection.threadId : null;
    navigation.newThreadDraft =
      routeHostExists && routeSelection.threadId === null ? routeSelection.draft : false;
    views.resetCurrentView();

    const viewUnchanged = () => sessionIsCurrent() && views.viewEpoch === refreshViewEpoch;
    if (
      routeHostExists &&
      routeSelection.hostId !== null &&
      routeSelection.threadId !== null &&
      viewUnchanged()
    ) {
      bootstrap.initializing = false;
      views.loading = false;
      await views.openThread(routeSelection.threadId, {
        hostId: routeSelection.hostId,
        projectId: routeSelection.projectId,
        replaceRoute: true,
      });
      hydrateNavigationDataInBackground(sessionEpoch);
    } else {
      await hydrateNavigationDataSafely(sessionEpoch, bootstrap, navigation);
      if (!sessionIsCurrent()) return;
      const restoredLastOpenThread =
        !hasGatewayRouteSelection(routeSelection) && viewUnchanged()
          ? await restoreLastOpenThreadSafely(navigation, bootstrap, views, viewUnchanged)
          : false;
      if (restoredLastOpenThread) {
        // Browser-local route selection was restored by the view owner.
      } else if (viewUnchanged()) {
        writeGatewayRouteSelection(
          {
            hostId: navigation.selectedHostId,
            projectId: navigation.selectedProjectId,
            threadId: null,
          },
          { replace: true },
        );
      }
    }
  } catch (error: unknown) {
    if (!sessionIsCurrent()) return;
    bootstrap.setError(
      messageFromError(error, bootstrap.t("app.bootstrapFailed"), bootstrap.errorLabels),
      {
        hostId: navigation.selectedHostId,
        projectId: navigation.selectedProjectId,
        threadId: navigation.selectedThreadId,
      },
    );
  } finally {
    if (sessionIsCurrent()) {
      views.loading = false;
      bootstrap.initializing = false;
    }
  }
}

async function hydrateNavigationData(sessionEpoch: number) {
  const auth = useAuthStore();
  const catalog = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const anchor = navigationHydrationAnchor();
  const canContinue = () =>
    auth.isCurrentSession(sessionEpoch) && canContinueNavigationHydration(anchor);
  await navigation.connectAllHosts();
  if (!canContinue()) return;
  await catalog.listModels();
  if (!canContinue()) return;
  await navigation.listThreads();
  if (!canContinue()) return;
  if (navigation.selectedProjectId === null) catalog.ensureSelectedProject();
  // listModels is skipped while no project is selected; once one is ensured here, the project
  // page's composer still needs the picker populated.
  if (canContinue() && navigation.selectedProjectId !== null) await catalog.listModels();
  if (canContinue() && navigation.selectedProjectId !== null) await navigation.listThreads();
}

function hydrateNavigationDataInBackground(sessionEpoch: number) {
  void hydrateNavigationData(sessionEpoch).catch((error: unknown) => {
    const auth = useAuthStore();
    if (!auth.isCurrentSession(sessionEpoch)) return;
    const bootstrap = useGatewayBootstrapStore();
    const navigation = useGatewayNavigationStore();
    bootstrap.setError(
      messageFromError(error, bootstrap.t("app.bootstrapFailed"), bootstrap.errorLabels),
      {
        hostId: navigation.selectedHostId,
        projectId: navigation.selectedProjectId,
        threadId: navigation.selectedThreadId,
      },
    );
  });
}

async function hydrateNavigationDataSafely(
  sessionEpoch: number,
  bootstrap: ReturnType<typeof useGatewayBootstrapStore>,
  navigation: ReturnType<typeof useGatewayNavigationStore>,
) {
  const auth = useAuthStore();
  try {
    await withTimeout(
      hydrateNavigationData(sessionEpoch),
      HYDRATE_NAVIGATION_TIMEOUT_MS,
      () => new Error(bootstrap.t("app.hydrateNavigationFailed")),
    );
  } catch (error: unknown) {
    if (!auth.isCurrentSession(sessionEpoch)) return;
    // Surface the failure but do not rethrow: the caller still needs to reach its own `finally`
    // (and, for this call site, still attempt last-open-thread restore / route write below) so
    // `initializing` never gets stuck at true.
    bootstrap.setError(
      messageFromError(error, bootstrap.t("app.hydrateNavigationFailed"), bootstrap.errorLabels),
      {
        hostId: navigation.selectedHostId,
        projectId: navigation.selectedProjectId,
        threadId: navigation.selectedThreadId,
      },
    );
  }
}

async function restoreLastOpenThreadSafely(
  navigation: ReturnType<typeof useGatewayNavigationStore>,
  bootstrap: ReturnType<typeof useGatewayBootstrapStore>,
  views: ReturnType<typeof useGatewayThreadViewStore>,
  viewUnchanged: () => boolean,
) {
  try {
    return await withTimeout(
      views.restoreLastOpenThread(),
      RESTORE_LAST_OPEN_THREAD_TIMEOUT_MS,
      () => new Error(bootstrap.t("app.restoreLastOpenThreadFailed")),
    );
  } catch (error: unknown) {
    if (!viewUnchanged()) return false;
    // The abandoned restore attempt may already have pointed navigation at an unresolved thread
    // before timing out or failing. Drop that leftover selection so the caller's normal-state
    // fallback (route threadId=null) stays consistent with the store.
    navigation.selectedThreadId = null;
    bootstrap.setError(
      messageFromError(
        error,
        bootstrap.t("app.restoreLastOpenThreadFailed"),
        bootstrap.errorLabels,
      ),
      { hostId: navigation.selectedHostId, projectId: navigation.selectedProjectId },
    );
    return false;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(onTimeout()), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function navigationHydrationAnchor() {
  const navigation = useGatewayNavigationStore();
  return { hostId: navigation.selectedHostId, threadId: navigation.selectedThreadId };
}

function canContinueNavigationHydration(anchor: ReturnType<typeof navigationHydrationAnchor>) {
  const catalog = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  return (
    navigation.selectedHostId === anchor.hostId &&
    navigation.selectedThreadId === anchor.threadId &&
    (anchor.hostId === null || catalog.hosts.some((host) => host.id === anchor.hostId))
  );
}
