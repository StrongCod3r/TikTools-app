import { defineStore } from 'pinia';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import { useAutomation } from './automation-state.ts';

export const useAutomationStore = defineStore('automation', () => useAutomation(useControlClient()));
