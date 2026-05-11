/**
 * CLI catalog — merges the recommended registry with live detection status.
 */

import { getRecommendedClis, type RecommendedCli, type CliAuthSpec, type CliInstallSpec } from './registry.js';
import { detectCli, getCachedCliStatus, currentPlatform, type CliState, type CliStatus } from './detector.js';
import { resolveAutoInstallSpec } from './auth.js';

export interface CliCatalogItem {
  id: string;
  binary: string;
  name: string;
  description: string;
  descriptionZh: string;
  category: RecommendedCli['category'];
  iconSlug?: string;
  iconUrl?: string;
  homepage?: string;
  install: CliInstallSpec;
  auth: CliAuthSpec;
  state: CliState;
  version?: string;
  authDetail?: string;
  platform: 'darwin' | 'linux' | 'win';
  /**
   * Present when the CLI has a single safe install command for the current
   * platform (npm-based). Frontend uses this to surface an "Auto-install"
   * button next to the manual copy-paste commands.
   */
  autoInstall?: { label: string };
}

export async function getCliCatalog(): Promise<CliCatalogItem[]> {
  const recs = getRecommendedClis();
  const platform = currentPlatform();
  const results = await Promise.all(recs.map(async (cli): Promise<CliCatalogItem> => {
    const cached = getCachedCliStatus(cli.id);
    const status: CliStatus = cached ?? await detectCli(cli);
    const auto = resolveAutoInstallSpec(cli, platform);
    return {
      id: cli.id,
      binary: cli.binary,
      name: cli.name,
      description: cli.description,
      descriptionZh: cli.descriptionZh,
      category: cli.category,
      iconSlug: cli.iconSlug,
      iconUrl: cli.iconUrl,
      homepage: cli.homepage,
      install: cli.install,
      auth: cli.auth,
      state: status.state,
      version: status.version,
      authDetail: status.authDetail,
      platform,
      autoInstall: auto ? { label: auto.label } : undefined,
    };
  }));
  return results;
}

export async function refreshCliStatus(id: string): Promise<CliStatus | undefined> {
  const cli = getRecommendedClis().find(c => c.id === id);
  if (!cli) return undefined;
  return await detectCli(cli);
}
