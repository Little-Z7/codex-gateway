export type GatewayTranslate = (key: string, values?: Record<string, unknown>) => string;
export type GatewayTranslateExists = (key: string) => boolean;

/** Uses Nuxt I18n's global composer without requiring a current Vue component instance. */
export function useGatewayTranslator(): {
  t: GatewayTranslate;
  te: GatewayTranslateExists;
} {
  const { $i18n } = useNuxtApp();
  return {
    t: (key, values) => $i18n.t(key, values ?? {}),
    te: (key) => $i18n.te(key),
  };
}
