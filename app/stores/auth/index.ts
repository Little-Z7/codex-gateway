import { defineStore } from "pinia";
import { useLocalStorage } from "@vueuse/core";

export const AUTH_STORAGE_KEY = "codex-gateway-auth-token";

export type GatewayUserRole = "admin" | "user";

export const useAuthStore = defineStore("auth", () => {
  const token = ref("");
  const username = ref("");
  const role = ref<GatewayUserRole>("user");
  const initialized = ref(false);
  const sessionEpoch = ref(0);
  const storedToken = useLocalStorage<string | null>(AUTH_STORAGE_KEY, null);
  const storedUsername = useLocalStorage<string | null>(`${AUTH_STORAGE_KEY}:username`, null);
  const storedRole = useLocalStorage<GatewayUserRole | null>(`${AUTH_STORAGE_KEY}:role`, null);

  const isAuthenticated = computed(() => token.value !== "");
  const isAdmin = computed(() => role.value === "admin");

  watch([storedToken, storedUsername, storedRole], ([nextToken, nextUsername, nextRole]) => {
    if (!initialized.value) return;
    // VueUse synchronizes useLocalStorage across same-origin tabs. Mirror that durable state into
    // the live session so logout/account switches advance sessionEpoch and cancel stale HTTP/RAF
    // work in every open Gateway tab without waiting for a refresh.
    replaceSession(nextToken ?? "", nextUsername ?? "", normalizeRole(nextRole));
  });

  function hydrate() {
    if (!import.meta.client || initialized.value) {
      return;
    }
    replaceSession(
      storedToken.value ?? "",
      storedUsername.value ?? "",
      normalizeRole(storedRole.value),
    );
    initialized.value = true;
    // Tokens written before roles existed carry no stored role; fetch it once so isAdmin settles.
    if (token.value !== "" && storedRole.value === null) {
      void refreshProfile();
    }
  }

  async function refreshProfile() {
    if (token.value === "") return;
    try {
      const response = await $fetch<{ user: { role?: string } }>("/api/auth/me", {
        headers: { authorization: `Bearer ${token.value}` },
      });
      role.value = normalizeRole(response.user.role);
      storedRole.value = role.value;
    } catch {}
  }

  async function login(input: { username: string; password: string }) {
    const session = await $fetch<{
      token: string;
      expiresAt: string;
      user: { id: number; username: string; role?: GatewayUserRole };
    }>("/api/auth/login", {
      method: "POST",
      body: input,
    });
    setSession(session.token, session.user.username, normalizeRole(session.user.role));
    return session;
  }

  function setSession(nextToken: string, nextUsername: string, nextRole: GatewayUserRole = "user") {
    replaceSession(nextToken, nextUsername, nextRole);
    initialized.value = true;
    storedToken.value = nextToken;
    storedUsername.value = nextUsername;
    storedRole.value = nextRole;
  }

  async function logout() {
    const currentToken = token.value;
    if (currentToken !== "") {
      try {
        await $fetch("/api/auth/logout", {
          method: "POST",
          headers: { authorization: `Bearer ${currentToken}` },
        });
      } finally {
        clearSession();
      }
      return;
    }
    clearSession();
  }

  function clearSession() {
    replaceSession("", "", "user");
    initialized.value = true;
    storedToken.value = null;
    storedUsername.value = null;
    storedRole.value = null;
  }

  function replaceSession(nextToken: string, nextUsername: string, nextRole: GatewayUserRole) {
    if (token.value !== nextToken) sessionEpoch.value += 1;
    token.value = nextToken;
    username.value = nextUsername;
    role.value = nextToken === "" ? "user" : nextRole;
  }

  function isCurrentSession(epoch: number) {
    return sessionEpoch.value === epoch;
  }

  return {
    token,
    username,
    role,
    isAdmin,
    initialized,
    sessionEpoch,
    isAuthenticated,
    hydrate,
    refreshProfile,
    login,
    logout,
    clearSession,
    isCurrentSession,
  };
});

function normalizeRole(value: unknown): GatewayUserRole {
  return value === "admin" ? "admin" : "user";
}
