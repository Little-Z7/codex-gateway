import type { SettingsPanelKind } from "./types";

interface SettingsPanelPolicy {
  component: string;
  titleKey: string;
}

export const settingsPanelRegistry = {
  account: {
    component: "SettingsDockAccountPanel",
    titleKey: "app.accountSettings",
  },
  appearance: {
    component: "SettingsDockAppearancePanel",
    titleKey: "app.appearanceSettings",
  },
  config: {
    component: "SettingsDockConfigPanel",
    titleKey: "app.configJson",
  },
  hosts: {
    component: "SettingsDockHostPanel",
    titleKey: "app.hosts",
  },
  notifications: {
    component: "SettingsDockNotificationPanel",
    titleKey: "app.notificationSettings",
  },
  users: {
    component: "SettingsDockUsersPanel",
    titleKey: "app.adminUsersTitle",
  },
} satisfies Record<SettingsPanelKind, SettingsPanelPolicy>;

export const settingsPanelKinds = [
  "account",
  "appearance",
  "config",
  "hosts",
  "notifications",
  "users",
] as const satisfies readonly SettingsPanelKind[];
