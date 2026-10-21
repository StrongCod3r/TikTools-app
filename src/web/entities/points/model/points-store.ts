import { defineStore } from 'pinia';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import { createPointsState } from './points-state.ts';

export const usePointsStore = defineStore('points', () => createPointsState(useControlClient()));
