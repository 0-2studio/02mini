import type { MultimodalContentItem } from '../ai/client.js';

export function contentToText(content: string | MultimodalContentItem[] | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  return content.map((item) => {
    if (item.type === 'text') return item.text || '';
    if (item.type === 'image_url') return '[image]';
    if (item.type === 'input_audio') return '[audio]';
    return '[multimodal]';
  }).filter(Boolean).join('\n');
}

export function normalizeMultimodalContent(content: unknown): MultimodalContentItem[] | null {
  if (!Array.isArray(content)) return null;

  const normalized: MultimodalContentItem[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') return null;
    const value = item as Record<string, any>;
    if (value.type === 'text') {
      normalized.push({ type: 'text', text: typeof value.text === 'string' ? value.text : '' });
    } else if (value.type === 'image_url' && value.image_url?.url) {
      normalized.push({
        type: 'image_url',
        image_url: {
          url: String(value.image_url.url),
          detail: value.image_url.detail,
        },
      });
    } else if (value.type === 'input_audio' && value.input_audio?.data) {
      normalized.push({
        type: 'input_audio',
        input_audio: {
          data: String(value.input_audio.data),
          format: value.input_audio.format === 'mp3' ? 'mp3' : 'wav',
        },
      });
    } else {
      return null;
    }
  }

  return normalized;
}
