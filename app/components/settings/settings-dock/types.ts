export type SettingsPanelKind = "appearance" | "config" | "hosts" | "notifications" | "users";

export interface SettingsDockPanelParams {
  kind: SettingsPanelKind;
}
