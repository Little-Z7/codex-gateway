import { inject, provide, type InjectionKey } from "vue";
import { useComposerController } from "@/composables/composer/useComposerController";

type ComposerController = ReturnType<typeof useComposerController>;

const COMPOSER_CONTROLLER_KEY: InjectionKey<ComposerController> = Symbol(
  "composer-controller-context",
);

// One controller instance per workspace: ChatWorkspace provides it so the top bar model
// picker and the composer share the same draft text and new-thread settings.
export function provideComposerController() {
  const controller = useComposerController();
  provide(COMPOSER_CONTROLLER_KEY, controller);
  return controller;
}

export function useInjectedComposerController() {
  const controller = inject(COMPOSER_CONTROLLER_KEY, null);
  if (controller !== null) return controller;
  // Fallback for hosts rendered outside ChatWorkspace (e.g. tests or embedded panes).
  return useComposerController();
}
