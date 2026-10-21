import { createPinia } from 'pinia';
import { createApp, type App as VueApp } from 'vue';
import { createControlClient, notifyFrontendReady } from '@/shared/api/control-client.ts';
import { controlClientKey } from '@/shared/api/use-control-client.ts';
import { activateLocale, i18n } from '@/shared/i18n/i18n.ts';
import { detectLocale } from '@/shared/i18n/locale-preference.ts';
import App from './App.vue';
import { createAppRouter } from './router/router.ts';
import './styles/tokens.css';
import './styles/base.css';

declare global {
  interface Window {
    __tiktools_remount__?: () => Promise<void>;
  }
}

async function mountApp(): Promise<VueApp> {
  const router = createAppRouter();
  const app = createApp(App)
    .use(createPinia())
    .use(i18n)
    .use(router)
    .provide(controlClientKey, createControlClient());
  await Promise.all([activateLocale(detectLocale()), router.isReady()]);
  app.mount('#app');
  notifyFrontendReady();
  return app;
}

let app = await mountApp();

if (import.meta.env.DEV || import.meta.env.VITE_TIKTOOLS_DIAGNOSTICS === '1') {
  window.__tiktools_remount__ = async () => {
    app.unmount();
    app = await mountApp();
  };
}
