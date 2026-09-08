import { createAnalytics, installPrivacyNotice } from './arcade-analytics.mjs';

export function startAnalytics(game: Parameters<typeof createAnalytics>[0]['game'], isPlaying: () => boolean) {
  installPrivacyNotice(isPlaying);
  return createAnalytics({ game, isPlaying, endpoint: 'https://arcade-collector.spencerrichardhenry.workers.dev/v1/events' });
}
