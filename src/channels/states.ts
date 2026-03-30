/**
 * Channel validation state caching.
 */

import type { ChannelSetupState } from '../cli/onboarding.js';

export function shouldCacheChannelStates(channels: readonly ChannelSetupState[]): boolean {
  return channels.every(channel => !channel.configured || channel.validated);
}
