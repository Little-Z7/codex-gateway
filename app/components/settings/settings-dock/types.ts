export type SettingsPanelKind =
  | "account"
  | "appearance"
  | "config"
  | "hosts"
  | "notifications"
  | "users";

export interface SettingsDockPanelParams {
  kind: SettingsPanelKind;
}
