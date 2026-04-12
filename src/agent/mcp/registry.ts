/**
 * MCP extension registry — recommended servers, recommended skills, community search.
 *
 * Does NOT maintain its own registry. Delegates to:
 * - Static curated list for recommended servers/skills
 * - Official MCP Registry API for community search
 * - npm search as fallback
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecommendedMcpServer {
  id: string;
  name: string;
  description: string;
  descriptionZh: string;
  command: string;
  args: string[];
  category: 'development' | 'data' | 'communication' | 'search' | 'utility';
  envSchema: Record<string, { required?: boolean; secret?: boolean; description: string }>;
}

export interface RecommendedSkillRepo {
  id: string;
  name: string;
  description: string;
  descriptionZh: string;
  source: string;
  skills?: string[];
}

export interface McpSearchResult {
  name: string;
  description: string;
  npmPackage?: string;
  source?: string;
  stars?: number;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  source: string;
  author?: string;
  stars?: number;
}

// ---------------------------------------------------------------------------
// Recommended MCP servers
// ---------------------------------------------------------------------------

const RECOMMENDED_MCP_SERVERS: RecommendedMcpServer[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository management, pull requests, issues, code search',
    descriptionZh: '仓库管理、PR、Issues、代码搜索',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    category: 'development',
    envSchema: {
      GITHUB_PERSONAL_ACCESS_TOKEN: { required: true, secret: true, description: 'GitHub personal access token' },
    },
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, write, and search files on the local machine',
    descriptionZh: '读写和搜索本机文件',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    category: 'utility',
    envSchema: {},
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and manage PostgreSQL databases',
    descriptionZh: '查询和管理 PostgreSQL 数据库',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    category: 'data',
    envSchema: {
      POSTGRES_CONNECTION_STRING: { required: true, description: 'PostgreSQL connection string' },
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read channels, summarize threads, post messages',
    descriptionZh: '读取频道、总结对话、发送消息',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    category: 'communication',
    envSchema: {
      SLACK_BOT_TOKEN: { required: true, secret: true, description: 'Slack bot OAuth token' },
      SLACK_TEAM_ID: { required: true, description: 'Slack team/workspace ID' },
    },
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web and local search via Brave Search API',
    descriptionZh: '通过 Brave Search API 进行网页和本地搜索',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    category: 'search',
    envSchema: {
      BRAVE_API_KEY: { required: true, secret: true, description: 'Brave Search API key' },
    },
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent key-value memory for agents across sessions',
    descriptionZh: '跨会话的持久化键值存储',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    category: 'utility',
    envSchema: {},
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Make HTTP requests and retrieve web content',
    descriptionZh: '发起 HTTP 请求并获取网页内容',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    category: 'utility',
    envSchema: {},
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and manage local SQLite databases',
    descriptionZh: '查询和管理本地 SQLite 数据库',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    category: 'data',
    envSchema: {},
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Git repository operations — log, diff, blame, branch',
    descriptionZh: 'Git 仓库操作 — log, diff, blame, branch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    category: 'development',
    envSchema: {},
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Error tracking — search issues, view stack traces',
    descriptionZh: '错误追踪 — 搜索问题、查看堆栈',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server-sentry'],
    category: 'development',
    envSchema: {
      SENTRY_AUTH_TOKEN: { required: true, secret: true, description: 'Sentry auth token' },
    },
  },
];

// ---------------------------------------------------------------------------
// Recommended skill repos
// ---------------------------------------------------------------------------

const RECOMMENDED_SKILL_REPOS: RecommendedSkillRepo[] = [
  {
    id: 'anthropics-skills',
    name: 'Anthropic Official Skills',
    description: 'Official skill collection from Anthropic — testing, code generation, MCP server creation',
    descriptionZh: 'Anthropic 官方技能集 — 测试、代码生成、MCP 服务创建',
    source: 'anthropics/skills',
  },
  {
    id: 'vercel-agent-skills',
    name: 'Vercel Agent Skills',
    description: 'Curated skills from Vercel — deployment, Next.js, TypeScript best practices',
    descriptionZh: 'Vercel 精选技能 — 部署、Next.js、TypeScript 最佳实践',
    source: 'vercel-labs/agent-skills',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getRecommendedMcpServers(): RecommendedMcpServer[] {
  return RECOMMENDED_MCP_SERVERS;
}

export function getRecommendedSkillRepos(): RecommendedSkillRepo[] {
  return RECOMMENDED_SKILL_REPOS;
}

/**
 * Search the official MCP Registry API for servers.
 * Falls back gracefully if the API is unreachable.
 */
export async function searchMcpServers(query: string, limit = 20): Promise<McpSearchResult[]> {
  if (!query.trim()) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    // Try official MCP Registry API
    const url = `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`registry responded ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data?.servers)) {
      return data.servers.map((s: any) => ({
        name: s.name || s.display_name || '',
        description: s.description || '',
        npmPackage: s.npm_package || undefined,
        source: s.repository || s.url || undefined,
        stars: typeof s.stars === 'number' ? s.stars : undefined,
      })).filter((s: McpSearchResult) => s.name);
    }

    // Try flat array response format
    if (Array.isArray(data)) {
      return data.slice(0, limit).map((s: any) => ({
        name: s.name || '',
        description: s.description || '',
        source: s.repository || s.url || undefined,
      })).filter((s: McpSearchResult) => s.name);
    }
  } catch {
    clearTimeout(timer);
  }

  // Fallback: npm search
  try {
    const npmUrl = `https://registry.npmjs.org/-/v1/search?text=mcp+server+${encodeURIComponent(query)}&size=${limit}`;
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), 5_000);
    const res = await fetch(npmUrl, { signal: controller2.signal });
    clearTimeout(timer2);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.objects)) {
        return data.objects.map((o: any) => ({
          name: o.package?.name || '',
          description: o.package?.description || '',
          npmPackage: o.package?.name,
        })).filter((s: McpSearchResult) => s.name);
      }
    }
  } catch { /* fallback failed */ }

  return [];
}

/**
 * Search for skills. Currently delegates to npm search with skill-related keywords.
 */
export async function searchSkills(query: string, limit = 20): Promise<SkillSearchResult[]> {
  if (!query.trim()) return [];
  try {
    const npmUrl = `https://registry.npmjs.org/-/v1/search?text=agent+skill+${encodeURIComponent(query)}&size=${limit}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(npmUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return [];
    const data = await res.json();

    if (Array.isArray(data.objects)) {
      return data.objects.map((o: any) => ({
        name: o.package?.name || '',
        description: o.package?.description || '',
        source: o.package?.links?.repository || o.package?.name || '',
        author: o.package?.publisher?.username,
      })).filter((s: SkillSearchResult) => s.name);
    }
  } catch { /* unreachable */ }
  return [];
}
