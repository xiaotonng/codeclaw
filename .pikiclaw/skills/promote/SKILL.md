---
name: promote
description: This skill should be used to search GitHub for relevant issues, filter them, draft replies to promote pikiclaw using a sub-agent, and publish those replies while tracking already replied issues to avoid duplicates.
version: 1.0.0
---

# GitHub Promotion Workflow

This skill automates searching for GitHub issues where `pikiclaw` can be promoted as a helpful solution, generating contextual replies, and posting them, while maintaining a history to prevent duplicate replies.

## 1. Context Check (Anti-Duplication)

Before doing anything, ALWAYS read the registry of already replied issues to ensure we do not spam or reply to the same issue twice.

- **Registry Path:** `.pikiclaw/skills/promote/replied_issues.txt`
- **Action:** Read this file using standard file reading tools (e.g., `read_file`) and keep the URLs in context.

## 2. Search for Potential Issues

Use `gh search issues` (via `run_shell_command`) to find recent, open issues related to our domain. 

Suggested search queries:
- `"claude code mobile" --state open`
- `"claude code telegram" --state open`
- `"gemini cli telegram" --state open`
- `"claude code 手机" --state open`

Example command (filters out trending/news bots):
```bash
gh search issues "claude code telegram" --state open --limit 30 --json url,title,state,repository | jq '.[] | select(.repository.name | test("trending|news|weekly|github-daily") | not)'
```

## 3. Filter and Select the Best Issues

Filter out any URLs that are already present in `replied_issues.txt`.
For the remaining candidate issues, use `gh issue view <url>` to read the context. 

Select issues that express a pain point `pikiclaw` explicitly solves, such as:
- Needing remote or mobile control for local agents.
- Telegram/Feishu bot integrations breaking or losing context.
- Desiring long-running task persistence and async notifications (e.g. `ask_user` notifications).
- Sending/receiving images or files via MCP/IM.
- Issues with Official Web UIs or SSH on mobile.

Pick 1-5 most relevant issues.

## 4. Draft the Replies using the Generalist Sub-Agent

Delegate the drafting process to the `generalist` sub-agent. This ensures high-quality, thoughtful drafts without cluttering the main session context.

**Prompt for the `generalist` sub-agent:**
> Draft short, highly grounded, non-spammy GitHub issue replies to promote the 'pikiclaw' project (a Node.js CLI that bridges local Claude Code, Gemini CLI, and Codex to Telegram/Feishu for mobile control, long-running tasks, and MCP tools).
> 
> Keep them brief, problem-solving focused, and authentic. 
> Formula: "One sentence acknowledging the specific pain point" + "One sentence explaining our architectural solution (e.g., async watchdog, MCP bridge, Human Loop)" + "Direct call to action: `npx pikiclaw@latest`".
> 
> Use the language matching the original issue (Chinese, Japanese, or English).
>
> Provide only the drafted replies.

Review the drafts. Ensure they are NOT generic ads but provide real technical insight.

## 5. Post the Replies

Use the `gh` cli (via `run_shell_command`) to post the drafted comments:

```bash
gh issue comment <URL> --body "<Drafted Reply>"
```

## 6. Update the Registry

After successfully posting replies, ALWAYS append the new issue URLs to the registry to prevent future duplicates.

- **Action:** Append the new URLs to `.pikiclaw/skills/promote/replied_issues.txt`.
- **Note:** Do this using standard file writing/appending tools, or `echo "<URL>" >> .pikiclaw/skills/promote/replied_issues.txt` via shell.
