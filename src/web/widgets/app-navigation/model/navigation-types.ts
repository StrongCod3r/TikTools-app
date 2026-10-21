import type { Component } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

export interface NavigationItem {
  id: string;
  label: string;
  icon: Component;
  to: RouteLocationRaw;
}

export interface NavigationSection {
  id: string;
  label: string;
  items: readonly NavigationItem[];
}
