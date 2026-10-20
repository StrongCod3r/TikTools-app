<script setup lang="ts">
import { reactive } from 'vue';
import { useLegacyController } from '@/composables/legacy-controller.ts';
import WidgetsView from '@/views/widgets-view.vue';

const app = reactive(useLegacyController());
</script>

<template>
  <WidgetsView
    :locale="app.locale"
    :status="app.widgetsStatus"
    :status-error="app.widgetsStatusError"
    :refreshing="app.widgetsRefreshing"
    :on-refresh="app.refreshWidgetsStatus"
    :on-copy="app.copyWidgetObsUrl"
    :designs="app.widgetDesigns"
    :designs-loading="app.widgetDesignsLoading"
    :designs-error="app.widgetDesignsError"
    :on-load-designs="app.loadWidgetDesigns"
    :on-save-design="app.saveWidgetDesign"
  />
</template>
