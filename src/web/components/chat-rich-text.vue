<script lang="tsx">
import { defineVueComponent } from '../vue/component.ts';
import { hasEmoteImageFailed, markEmoteImageFailed } from '../features/emote-images.ts';
import { resolveChatSegments, type ChatSegment, type LiveEmote } from '../../shared/emotes/index.ts';

type ChatRichTextProps = {
  /** The already-localized comment text to render. */
  text: string;
  /** Optional emote metadata from the event; absent today. */
  emotes?: LiveEmote[];
  imagesEnabled?: boolean;
};

/**
 * Renders a chat comment as inline text plus emote images.
 *
 * Never uses `innerHTML`/`v-html`: every segment becomes a text child or an
 * `<img>` element, so untrusted LIVE content can never become markup. An
 * emote with no usable image URL — or one that failed to load — renders its
 * original shortcode as text, so a broken emote can never swallow the rest of
 * the comment.
 *
 * `text` and `emotes` are passed as the raw values (not a precomputed segment
 * array) so the parent's prop-identity memoization still applies: the segment
 * work only re-runs when those inputs actually change.
 */
function renderChatRichText({ text, emotes, imagesEnabled = true }: ChatRichTextProps) {
  const segments: ChatSegment[] = resolveChatSegments(text, emotes);
  return segments.map((segment, index) => {
    if (segment.type === 'text') return segment.value;
    const imageUrl = segment.imageUrl;
    if (imagesEnabled && imageUrl && !hasEmoteImageFailed(imageUrl)) {
      return (
        <img
          key={`emote-${index}`}
          class="chat-emote"
          src={imageUrl}
          alt={segment.fallbackText}
          title={segment.fallbackText}
          loading="lazy"
          referrerpolicy="no-referrer"
          decoding="async"
          onError={() => markEmoteImageFailed(imageUrl)}
        />
      );
    }
    return segment.fallbackText;
  });
}

export const ChatRichText = defineVueComponent<ChatRichTextProps>(
  ['text', 'emotes', 'imagesEnabled'],
  (props) => () => renderChatRichText(props),
);

export default ChatRichText;
</script>
