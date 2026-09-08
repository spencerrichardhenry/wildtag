export function createAnalytics(options: {
  game: 'tiny-tide' | 'royal-yeet' | 'dungeon-run' | 'wildtag' | 'moss-and-maw';
  endpoint: string;
  isPlaying: () => boolean;
  idleMs?: number;
  sessionGapMs?: number;
}): { flush(): Promise<void>; stop(): void };
export function installPrivacyNotice(isPlaying: () => boolean): void;
