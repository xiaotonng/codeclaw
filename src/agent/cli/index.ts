/**
 * Barrel entry for the CLI extension module.
 */

export {
  getRecommendedClis, getRecommendedCli,
  type RecommendedCli, type CliCategory, type CliAuthType,
  type CliInstallSpec, type CliInstallCommand, type CliAuthSpec,
} from './registry.js';

export {
  detectCli, getCachedCliStatus, invalidateCliStatus, currentPlatform,
  type CliState, type CliStatus,
} from './detector.js';

export {
  getCliCatalog, refreshCliStatus,
  type CliCatalogItem,
} from './catalog.js';

export {
  startCliAuthSession, getAuthSession, cancelAuthSession,
  applyCliToken, logoutCli,
  type AuthSession, type AuthSessionEvent,
  type ApplyTokenResult, type LogoutResult,
  type StartAuthSessionResult,
} from './auth.js';
