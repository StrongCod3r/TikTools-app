import { createRouter, createWebHashHistory, type Router } from 'vue-router';
import { routes } from './routes.ts';

export function createAppRouter(): Router {
  return createRouter({
    history: createWebHashHistory(),
    routes,
  });
}
