import { inject, type InjectionKey } from 'vue';
import type { useAppController } from './useAppController.ts';

export type LegacyController = ReturnType<typeof useAppController>;

export const legacyControllerKey: InjectionKey<LegacyController> = Symbol('legacy-controller');

export function useLegacyController(): LegacyController {
  const controller = inject(legacyControllerKey);
  if (!controller) throw new Error('Legacy controller is not provided');
  return controller;
}
