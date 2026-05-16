/**
 * agent-driver.ts — Agent driver interface and registry.
 *
 * Each CLI agent (claude, codex, gemini, ...) implements AgentDriver.
 * Register with `registerDriver()`, look up with `getDriver()`.
 */

import type {
  StreamOpts, StreamResult,
  SessionListResult, SessionTailOpts, SessionTailResult,
  SessionMessagesOpts, SessionMessagesResult,
  ModelListOpts, ModelListResult,
  UsageOpts, UsageResult,
  AgentDriverCapabilities,
} from './index.js';

/**
 * Optional descriptor of an agent's *external* (non-pikiclaw) configuration.
 *
 * Some agents (e.g. Hermes) maintain their own provider/model state outside
 * pikiclaw — in `~/.hermes/config.yaml` and `~/.hermes/.env`. When that's the
 * case, `getNativeConfig()` returns a read-only snapshot so the dashboard can
 * surface what the agent will actually run with even before the user has
 * configured a pikiclaw-managed BYOK Provider.
 *
 * Pikiclaw never writes back to the source file; users edit native config via
 * the agent's own CLI (e.g. `hermes config`).
 */
export interface AgentNativeConfig {
  model: string;
  provider: string;
  baseURL: string | null;
  effort: string | null;
  configPath: string;
  source: string;
}

export interface AgentDriver {
  readonly id: string;
  /** CLI binary name (e.g. 'claude', 'codex', 'gemini') */
  readonly cmd: string;
  /** UI label for thinking/reasoning display */
  readonly thinkLabel: string;
  /** Static capability flags. Drivers omit this to opt into all defaults (false). */
  readonly capabilities?: AgentDriverCapabilities;
  /**
   * Which BYOK provider kinds this driver can route through. The unified
   * /models picker uses this to filter compatible Profiles into the agent's
   * cross-provider model list (cf. resolveAgentModels). String values
   * intentionally — kept bare so this interface stays independent of the
   * Model layer's ProviderKind union (see src/model/types.ts).
   * Omit to opt out of BYOK Profile listing entirely.
   */
  readonly acceptedProviderKinds?: readonly string[];

  doStream(opts: StreamOpts): Promise<StreamResult>;
  getSessions(workdir: string, limit?: number): Promise<SessionListResult>;
  getSessionTail(opts: SessionTailOpts): Promise<SessionTailResult>;
  getSessionMessages(opts: SessionMessagesOpts): Promise<SessionMessagesResult>;
  listModels(opts: ModelListOpts): Promise<ModelListResult>;
  getUsage(opts: UsageOpts): UsageResult;
  /** Optional live/async usage (e.g. codex app-server). Falls back to getUsage. */
  getUsageLive?(opts: UsageOpts): Promise<UsageResult>;
  /** Optional read-only snapshot of the agent's external config. */
  getNativeConfig?(): AgentNativeConfig | null;
  shutdown(): void;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const drivers = new Map<string, AgentDriver>();

export function registerDriver(d: AgentDriver) { drivers.set(d.id, d); }

export function getDriver(id: string): AgentDriver {
  const d = drivers.get(id);
  if (!d) throw new Error(`Unknown agent: ${id}. Available: ${[...drivers.keys()].join(', ')}`);
  return d;
}

export function hasDriver(id: string): boolean { return drivers.has(id); }
export function allDrivers(): AgentDriver[] { return [...drivers.values()]; }
export function allDriverIds(): string[] { return [...drivers.keys()]; }

export function shutdownAllDrivers() {
  for (const d of drivers.values()) d.shutdown();
}

const DEFAULT_CAPABILITIES: AgentDriverCapabilities = { fork: false, modelSwitch: true };

export function getDriverCapabilities(id: string): AgentDriverCapabilities {
  const d = drivers.get(id);
  if (!d?.capabilities) return DEFAULT_CAPABILITIES;
  return { ...DEFAULT_CAPABILITIES, ...d.capabilities };
}

/**
 * Provider kinds this driver can route through. Empty array means the driver
 * declared no compatibility (so no Profiles will be listed for it). Callers
 * should treat this as the filter for cross-provider model offerings.
 */
export function getAcceptedProviderKinds(id: string): readonly string[] {
  return drivers.get(id)?.acceptedProviderKinds ?? [];
}
