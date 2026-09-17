import SettingsDockTab from "@/components/settings/settings-dock/SettingsDockTab.vue";
import { defineAsyncComponent } from "vue";

const asyncPanels = {
  SettingsDockAccountPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockAccountPanel.vue"),
  ),
  SettingsDockAppearancePanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockAppearancePanel.vue"),
  ),
  SettingsDockConfigPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockConfigPanel.vue"),
  ),
  SettingsDockHostPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockHostPanel.vue"),
  ),
  SettingsDockNotificationPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockNotificationPanel.vue"),
  ),
  SettingsDockUsersPanel: defineAsyncComponent(
    () => import("@/components/settings/settings-dock/SettingsDockUsersPanel.vue"),
  ),
};

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component("SettingsDockTab", SettingsDockTab);
  for (const [name, component] of Object.entries(asyncPanels)) {
    nuxtApp.vueApp.component(name, component);
  }
});
