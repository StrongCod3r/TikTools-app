<script lang="tsx">
import { ref } from 'vue';
import { defineVueComponent } from '../vue/component.ts';

import { t, type Locale } from '../i18n/index.ts';
import {
  sanitizeTtsText,
  type TtsEmoteSpeechMode,
  type TtsSettings,
  type TtsTextSanitizerSettings,
} from '../../../shared/tts/tts-policy.ts';

type TtsTextProcessingProps = {
  locale: Locale;
  settings: TtsSettings;
  onSettingsChange: (next: TtsSettings) => void;
};

/**
 * Text Processing card: the emote/emoji/whitespace cleanup applied to the
 * permitted spoken text, plus a live preview. The preview calls the exact
 * `sanitizeTtsText` the speech policy uses, so what the operator sees here is
 * what the backend will speak — the two can never disagree.
 */
export const TtsTextProcessing = defineVueComponent<TtsTextProcessingProps>(
  ['locale', 'settings', 'onSettingsChange'],
  (props) => {
    const previewInput = ref('Hello [laughcry][laughcry] world');

    const update = (patch: Partial<TtsTextSanitizerSettings>): void => {
      props.onSettingsChange({
        ...props.settings,
        sanitizer: { ...props.settings.sanitizer, ...patch },
      });
    };

    return () => {
      const locale = props.locale;
      const sanitizer = props.settings.sanitizer;
      const preview = sanitizeTtsText(previewInput.value, sanitizer);

      return (
        <section class="tts-card">
          <h4 class="tts-card__title">{t(locale, 'ttsTextProcessing')}</h4>
          <label class="tts-check">
            <input
              type="checkbox"
              checked={sanitizer.removeKnownEmotes}
              onChange={(event) => update({ removeKnownEmotes: (event.currentTarget as HTMLInputElement).checked })}
            />
            {t(locale, 'ttsRemoveEmoteCodes')}
          </label>
          <label class="tts-check">
            <input
              type="checkbox"
              checked={sanitizer.removeUnicodeEmoji}
              onChange={(event) => update({ removeUnicodeEmoji: (event.currentTarget as HTMLInputElement).checked })}
            />
            {t(locale, 'ttsRemoveUnicodeEmoji')}
          </label>
          <label class="tts-check">
            <input
              type="checkbox"
              checked={sanitizer.removeInvisibleCharacters}
              onChange={(event) => update({ removeInvisibleCharacters: (event.currentTarget as HTMLInputElement).checked })}
            />
            {t(locale, 'ttsRemoveInvisibleCharacters')}
          </label>
          <label class="tts-check">
            <input
              type="checkbox"
              checked={sanitizer.collapseWhitespace}
              onChange={(event) => update({ collapseWhitespace: (event.currentTarget as HTMLInputElement).checked })}
            />
            {t(locale, 'ttsCollapseWhitespace')}
          </label>
          <div class="tts-row tts-row--stack">
            <label class="tts-label" for="tts-emote-mode">{t(locale, 'ttsEmoteHandling')}</label>
            <select
              id="tts-emote-mode"
              class="tts-select"
              value={sanitizer.emoteSpeechMode}
              disabled={!sanitizer.removeKnownEmotes}
              onChange={(event) => update({ emoteSpeechMode: (event.currentTarget as HTMLSelectElement).value as TtsEmoteSpeechMode })}
            >
              <option value="remove">{t(locale, 'ttsEmoteRemove')}</option>
              <option value="describe">{t(locale, 'ttsEmoteDescribe')}</option>
            </select>
          </div>
          <label class="tts-check">
            <input
              type="checkbox"
              checked={sanitizer.skipEmptyMessages}
              onChange={(event) => update({ skipEmptyMessages: (event.currentTarget as HTMLInputElement).checked })}
            />
            {t(locale, 'ttsSkipEmptyMessages')}
          </label>
          <p class="tts-hint">{t(locale, 'ttsTextProcessingNote')}</p>

          <div class="tts-preview">
            <label class="tts-label" for="tts-preview-input">{t(locale, 'ttsPreviewOriginal')}</label>
            <input
              id="tts-preview-input"
              class="tts-input"
              type="text"
              value={previewInput.value}
              onInput={(event) => { previewInput.value = (event.currentTarget as HTMLInputElement).value; }}
            />
            <p class="tts-preview__result">
              <span class="tts-value">{t(locale, 'ttsPreviewResult')}</span>{' '}
              {preview || t(locale, 'ttsPreviewEmpty')}
            </p>
          </div>
        </section>
      );
    };
  },
);

export default TtsTextProcessing;
</script>
