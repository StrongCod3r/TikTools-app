import type { MediaPickerOptions } from '../../../../shared/messages.ts';

export type PluginInstallState = {
  installing: boolean;
  error: string;
  success: string;
  pendingPath: string;
  needsReplace: boolean;
};

export function createInitialPluginInstallState(): PluginInstallState {
  return { installing: false, error: '', success: '', pendingPath: '', needsReplace: false };
}

export function pluginPickerOptions(title: string): MediaPickerOptions {
  return { mode: 'file', kind: 'other', title, extensions: ['plugin'] };
}
