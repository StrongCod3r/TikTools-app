<script setup lang="ts">
import { reactive } from 'vue';
import { useLegacyController } from '@/composables/legacy-controller.ts';
import BehaviorView from '@/views/behavior-view.vue';

const app = reactive(useLegacyController());
</script>

<template>
  <BehaviorView
    :locale="app.locale"
    :gifts="app.giftCatalog"
    :viewers="app.leaderboard"
    :snapshot="app.behavior"
    :runs="app.behaviorRuns"
    :test-runs="app.behaviorTestRuns"
    :globals="app.globals"
    :hotkey-status="app.hotkeyStatus"
    :last-hotkey-event="app.lastHotkeyEvent"
    :hotkey-access-pending="app.hotkeyAccessPending"
    :on-request-hotkey-access="app.handleRequestHotkeyAccess"
    :error="app.behaviorError"
    :on-save-action="app.handleSaveAction"
    :on-apply-rule-template="app.handleApplyRuleTemplate"
    :rule-template-custom="app.ruleTemplateCustom"
    :rule-template-error="app.ruleTemplateError"
    :on-load-rule-template-custom="app.loadRuleTemplateCustom"
    :on-import-rule-templates="app.importRuleTemplates"
    :on-delete-rule-template-custom="app.deleteRuleTemplateCustom"
    :rule-profile-packs="app.ruleProfilePacks"
    :active-rule-profile-id="app.activeRuleProfileId"
    :rule-profile-error="app.ruleProfileError"
    :rule-profile-notice="app.ruleProfileNotice"
    :on-apply-rule-profile="app.handleApplyRuleProfile"
    :on-switch-rule-profile="app.handleSwitchRuleProfile"
    :on-create-rule-profile="app.handleCreateRuleProfile"
    :on-delete-rule-profile="app.handleDeleteRuleProfile"
    :on-export-rule-profile="app.handleExportRuleProfile"
    :on-delete-action="app.handleDeleteAction"
    :on-set-action-enabled="app.handleSetActionEnabled"
    :on-test-action="app.handleTestAction"
    :on-save-event="app.handleSaveEvent"
    :on-delete-event="app.handleDeleteEvent"
    :on-set-event-enabled="app.handleSetEventEnabled"
    :on-test-event="app.handleTestEvent"
    :on-fire-event="app.handleFireEvent"
    :on-open-plugins="app.openPlugins"
    :on-open-media-picker="app.openMediaPicker"
    :action-options="app.actionOptions"
    :action-option-errors="app.actionOptionErrors"
    :on-get-action-options="app.handleGetActionOptions"
  />
</template>
