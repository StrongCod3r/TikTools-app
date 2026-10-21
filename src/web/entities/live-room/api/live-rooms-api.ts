import type { ControlClient } from '@/shared/api/control-client.ts';
import type { LiveChannel } from '@/types.ts';

export interface LiveChannelsPage {
  rooms: LiveChannel[];
  nextOffset?: number;
  fetchedAt: number;
  source: string;
}

export function fetchLiveChannels(
  client: ControlClient,
  request: { keyword: string; offset: number; limit: number },
): Promise<LiveChannelsPage> {
  return client.call<LiveChannelsPage>('live.channels', {
    keyword: request.keyword || undefined,
    offset: request.offset || undefined,
    limit: request.limit,
  });
}
