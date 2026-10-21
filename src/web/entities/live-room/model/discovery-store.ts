import { defineStore } from 'pinia';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import { createDiscoveryState } from './discovery-state.ts';

export const useDiscoveryStore = defineStore('live-discovery', () => createDiscoveryState(useControlClient()));
