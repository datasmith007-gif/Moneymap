---
name: worklog
description: 'Summarise the work done in the current coding session or PR and log it to the Moneymap Worklog page in Notion, under a collapsible toggle named for today''s date. Use when the user says "log the worklog", "update the worklog", "record this session in Notion", "add a worklog entry", or asks to write up what was done in this session/PR to Notion. One toggle per calendar day; each run adds one session entry inside that day.'
license: MIT
metadata:
  author: Moneymap
  version: "1.0.0"
---

# Worklog → Notion

Writes a concise summary of the current session / PR into the **Moneymap Worklog** Notion page. Each calendar day is one collapsible toggle (`<details>`); each run of this skill adds one **session entry** inside that day's toggle. Newest day at the top; within a day, newest session at the top.

## Configuration

Both values are fixed to the Moneymap Worklog page. To point the skill at a different page, change these two lines only.

- **Page ID**: `3a065a49-8a97-8134-8a65-db6605ecd213`
- **Page URL**: https://app.notion.com/p/3a065a498a9781348a65db6605ecd213

This skill uses the Notion MCP server (`notion` in `.mcp.json`). If Notion tools are unavailable, tell the user to connect the Notion MCP server and stop.

## Workflow

### 1. Gather what happened this session

Prefer facts over recollection. Collect, in order:

1. **Today's date**, at runtime — do not assume. PowerShell: `Get-Date -Format 'yyyy-MM-dd'`. Also grab the time: `Get-Date -Format 'HH:mm'`.
2. **Branch**: `git rev-parse --abbrev-ref HEAD`.
3. **Commits on this branch** since it left `main`: `git log main..HEAD --oneline` (fall back to `git log -n 20 --oneline` if there is no `main..HEAD` range).
4. **Diff shape**: `git diff --stat main...HEAD` for committed work, plus `git status --short` and `git diff --stat` for anything uncommitted.
5. **PR**, if the repo has `gh`: `gh pr view --json number,title,url 2>/dev/null`. Include the PR number + link if one exists.
6. **The session itself** — what you and the user actually did this turn/session that git may not show (decisions made, files created, problems solved). This is the part git can't reconstruct; lead with it.

Synthesise, don't dump. A worklog entry is a short human-readable summary, not a raw git log. Group related commits into one bullet. This summary carries no financial/tax consequence, so a written prose summary is appropriate here — unlike money figures, it does not need deterministic logic.

### 2. Build the session entry

Use this exact shape (Notion-flavored Markdown). Keep it to a lead line + 3–8 bullets:

```
**HH:MM · `<branch>`**<PR-suffix>

<one-sentence summary of the session>

- <what changed> (`<path/or/area>`)
- <what changed>
- <notable decision or follow-up>
```

- `<PR-suffix>` is ` · PR [#123](url)` when a PR exists, otherwise omit it.
- Reference files/areas in backticks, not full markdown links (the worklog lives in Notion, not the repo).
- Do **not** use `---` dividers inside an entry — the divider is reserved as an anchor (see §4).

### 3. Fetch the page

Call `notion-fetch` with the configured Page ID and read the current content. Decide which case you're in:

- Content contains `<summary>YYYY-MM-DD</summary>` for **today** → an entry already exists for today → **§4a (append into existing day)**.
- It does not → **§4b (new day)**.

Match against the *actual* fetched text (whitespace/format may differ slightly from the templates below); adapt your `old_str` to what the page really contains.

### 4. Write the entry

Both cases use `notion-update-page` with `command: "update_content"` (a targeted search-and-replace). Never use `replace_content` — it would risk the rest of the page.

**4a — Same day already logged.** The date summary line is unique per day, so use it as the anchor and insert the new session directly after it (newest session first within the day):

- `old_str`: `<summary>YYYY-MM-DD</summary>`
- `new_str`:
  ```
  <summary>YYYY-MM-DD</summary>

  **HH:MM · `<branch>`**<PR-suffix>

  <summary sentence>

  - <bullets…>
  ```

**4b — First entry today.** Insert a whole new day toggle immediately after the intro divider so the newest day sits on top. The intro `---` is the only bare divider on the page, so it is a safe anchor:

- `old_str`: `---`
- `new_str`:
  ```
  ---

  <details>
  <summary>YYYY-MM-DD</summary>

  **HH:MM · `<branch>`**<PR-suffix>

  <summary sentence>

  - <bullets…>

  </details>
  ```

The children between `<summary>` and `</details>` are contained by the toggle — no manual indentation needed for the `<details>` form.

### 5. Confirm

Report back to the user: which case fired (new day vs appended), a one-line recap of what you logged, and the page link: [Moneymap Worklog](https://app.notion.com/p/3a065a498a9781348a65db6605ecd213). Do not paste the full entry back unless asked.

## Guardrails

- **Never log secrets or raw financial data.** This is a work summary — describe *what changed structurally*, never paste account numbers, balances, statement contents, credentials, or `.env` values. If the session touched real financial fixtures, describe the change abstractly.
- **One session entry per run.** Don't rewrite or delete earlier entries; only insert. If the user explicitly asks to fix a past entry, use a scoped `update_content` on just that text.
- If `git` shows no changes and the session did nothing substantive, say so and ask the user whether to log anyway rather than writing an empty entry.
- The full Notion-flavored Markdown spec is the MCP resource `notion://docs/enhanced-markdown-spec` — read it via the MCP resource interface if you need block syntax beyond toggles.
