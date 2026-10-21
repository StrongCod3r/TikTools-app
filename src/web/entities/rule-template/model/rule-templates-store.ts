import { defineStore } from 'pinia';
import { useControlClient } from '@/shared/api/use-control-client.ts';
import { useRuleTemplates } from './rule-templates-state.ts';

export const useRuleTemplatesStore = defineStore('rule-templates', () => useRuleTemplates(useControlClient()));
