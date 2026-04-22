/**
 * Skill repository catalog — single source of truth for what the Dashboard
 * shows under Extensions → Skills.
 *
 * ─── How this plugs into the rest of the stack ───────────────────────────────
 *
 *   Dashboard → GET /api/extensions/skills/catalog
 *     → dashboard/routes/extensions.ts
 *       → agent/mcp/registry.ts              (types + re-exports this array)
 *       → agent/skills.ts                    (locally-installed discovery)
 *       → agent/skill-installer.ts           (`npx skills add …` runner)
 *         ← src/catalog/skill-repos.ts       ← YOU ARE HERE
 *
 * ─── How to add a skill pack ─────────────────────────────────────────────────
 *
 *   Append a `RecommendedSkillRepo` entry with `source` set to an `owner/repo`
 *   GitHub slug (or full URL). The install flow runs `npx skills add <source>`
 *   and drops the skill into `~/.pikiclaw/skills/` for global installs, or
 *   `<workdir>/.pikiclaw/skills/` for project installs.
 *
 * ─── recommendedScope ────────────────────────────────────────────────────────
 *
 *   'global'    — skills that generalize across projects (Atlassian triage,
 *                 general productivity).
 *   'both'      — skills useful in either scope (code review, doc gen).
 *   'workspace' — skills that only make sense pinned to one project (rare for
 *                 skills; most are global).
 */

import type { RecommendedSkillRepo } from '../agent/mcp/registry.js';

export const SKILL_REPOS: RecommendedSkillRepo[] = [
  {
    id: 'anthropics-skills',
    name: 'Anthropic Skills',
    description: 'Official skill collection from Anthropic',
    descriptionZh: 'Anthropic 官方技能集',
    source: 'anthropics/skills',
    category: 'general',
    recommendedScope: 'global',
    homepage: 'https://github.com/anthropics/skills',
  },
  {
    id: 'pikiclaw-builtins',
    name: 'Pikiclaw built-in skills',
    description: 'snipe, promote, dev, install — pikiclaw operational skills',
    descriptionZh: 'snipe / promote / dev / install — pikiclaw 自带运营技能',
    source: 'xiaotonng/pikiclaw',
    category: 'pikiclaw',
    recommendedScope: 'global',
    homepage: 'https://github.com/xiaotonng/pikiclaw',
  },
  {
    id: 'obra-superpowers',
    name: 'Obra Superpowers',
    description: 'Opinionated productivity skills — focus, writing, research',
    descriptionZh: '精选生产力技能 — 专注、写作、调研',
    source: 'obra/superpowers',
    category: 'productivity',
    recommendedScope: 'global',
    homepage: 'https://github.com/obra/superpowers',
  },
  {
    id: 'vercel-agent-skills',
    name: 'Vercel Agent Skills',
    description: 'Next.js, deployment, and TypeScript workflows',
    descriptionZh: 'Next.js、部署、TypeScript 工作流',
    source: 'vercel-labs/agent-skills',
    category: 'dev',
    recommendedScope: 'both',
  },
  {
    id: 'mcp-server-examples',
    name: 'MCP Server Examples',
    description: 'Reference implementations for building MCP servers',
    descriptionZh: '构建 MCP 服务的参考实现',
    source: 'modelcontextprotocol/servers',
    category: 'dev',
    recommendedScope: 'global',
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'claude-code-cookbook',
    name: 'Claude Code Cookbook',
    description: 'Recipes and workflows for Claude Code',
    descriptionZh: 'Claude Code 的配方和工作流',
    source: 'anthropics/claude-code-cookbook',
    category: 'dev',
    recommendedScope: 'global',
  },
  {
    id: 'atlassian-skills',
    name: 'Atlassian Agent Skills',
    description: 'Jira triage, Confluence spec-to-backlog, status reports',
    descriptionZh: 'Jira 三重奏、Confluence 规格转 backlog、状态报告',
    source: 'atlassian/agent-skills',
    category: 'productivity',
    recommendedScope: 'global',
  },
  {
    id: 'review-skills',
    name: 'Code Review Skills',
    description: 'PR review, security review, performance audit',
    descriptionZh: 'PR 评审、安全评审、性能审计',
    source: 'anthropics/review-skills',
    category: 'dev',
    recommendedScope: 'both',
  },
  {
    id: 'docgen-skills',
    name: 'Documentation Skills',
    description: 'Auto-generate README, API docs, changelogs',
    descriptionZh: '自动生成 README、API 文档、CHANGELOG',
    source: 'community/docgen-skills',
    category: 'dev',
    recommendedScope: 'both',
  },
  {
    id: 'devops-skills',
    name: 'DevOps Skills',
    description: 'CI debugging, deploy pipelines, observability',
    descriptionZh: 'CI 调试、部署流水线、可观测性',
    source: 'community/devops-skills',
    category: 'dev',
    recommendedScope: 'global',
  },
];
