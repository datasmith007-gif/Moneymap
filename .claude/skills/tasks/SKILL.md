---
name: tasks
description: 'Turn a finished brainstorm into an approved task list in the Notion Todo List database, and move those tasks forward as work happens. Use when the user says "break this down into tasks", "what tasks do we need for this", "write these to Notion", "create the tasks", or — later — "mark that task in progress", "that task is done", "move the parser task forward", "add a note to that task". Two flows: Plan (propose tasks, get approval, create them) and Advance (resolve which task is meant, update its status, append notes to its page).'
license: MIT
metadata:
  author: Moneymap
  version: "1.0.0"
---

# Tasks → Notion

Bridges brainstorming and tracking. **Plan** turns a discussion into rows in the Todo List database; **Advance** moves an existing row forward and records notes on it.

This skill tracks *what needs doing*. The `worklog` skill records *what was done* in a session. They are complements — never duplicate a session summary into task notes, or vice versa.

## Configuration

Change only these lines to point the skill elsewhere.

- **Tasks data source**: `collection://39a65a49-8a97-8020-9891-000b91c99dd0`
- **Tasks DB URL**: https://app.notion.com/p/39a65a498a978044882cfe45080e7443
- **Milestones data source**: `collection://b12c78e5-673a-461f-9392-73e0a92cb5c7`

Schema of the tasks data source — use these exact property names:

| Property | Type | Notes |
|---|---|---|
| `Task name` | title | Imperative, ≤80 chars |
| `Status` | status | `Not started` · `In progress` · `Done` |
| `Milestone` | relation | JSON array of Milestones **page URLs** |
| `Owner` | multi_select | `Prathmesh` · `Raja` |
| `Assignee` | person | Leave unset unless asked |
| `date:Due date:start` | date | ISO date; leave unset unless asked |
| `userDefined:URL` | url | Spec or PR link, optional |

This skill uses the Notion MCP server (`notion` in `.mcp.json`). If Notion tools are unavailable, say so and stop — never keep a task list only in chat and imply it was saved.

## Routing

- User is wrapping up a discussion and wants it turned into work → **Flow A — Plan**.
- User refers to work already tracked ("mark X done", "add a note to X") → **Flow B — Advance**.

If it's genuinely unclear, ask. Do not create a duplicate row for a task that already exists.

---

## Flow A — Plan

### 1. Confirm the brainstorm is actually finished

Only run this flow when the user signals they're done exploring. If the discussion still has open forks, say which fork is unresolved and ask — task lists built on undecided foundations get rewritten.

### 2. Propose the tasks in chat — do not write anything yet

Lead with the count: *"This is 9 tasks."* Then a numbered list. For each task give:

- **Title** — imperative and specific (`Add balance reconciliation check to HDFC parser`, not `Parser work`)
- **Done when** — one observable criterion. If you cannot write one, the task is too vague to create.
- **Milestone** — which M0–M5 row it belongs to, if any
- **Depends on** — task numbers it can't start before, if any

Sizing rules:

- One task ≈ one focused work session. Independently completable and independently verifiable.
- No task whose only output is "think about X" — that's brainstorming, not a task. Fold it into the decision it feeds.
- **More than ~15 tasks means the chunk is too big.** Say so, propose splitting into phases, and offer to write only phase 1. A backlog nobody can hold in their head is a backlog nobody picks from.
- Prefer fewer, meatier tasks over many trivial ones. Ceremony per task is not free.

### 3. Wait for explicit approval

Never write on implied consent. "Looks good", "yes", "go ahead" is approval; silence or a follow-up question is not. If the user edits the list, re-state the corrected version and confirm the new count before writing.

### 4. Resolve milestone URLs

If any task names a milestone, look up its page URL first:

```sql
SELECT url, "Milestone" FROM "collection://b12c78e5-673a-461f-9392-73e0a92cb5c7"
```

Match on the milestone label (`M1 — Statement parsing`). The relation takes **page URLs**, as a JSON array.

### 5. Create the rows — one batched call

Use `notion-create-pages` **once**, with `parent: {"type": "data_source_id", "data_source_id": "39a65a49-8a97-8020-9891-000b91c99dd0"}` and all tasks in the `pages` array. Do not loop one call per task.

Every task is created with `Status: "Not started"` — no exceptions, even if work has already begun. Use Flow B immediately afterwards to advance it, so the transition is recorded.

Page body for each task:

```
## Context

<1–3 sentences: why this task exists, from the brainstorm. The part that
would otherwise be lost when the conversation scrolls away.>

## Done when

- <the observable criterion from step 2>

## Notes
```

Leave `## Notes` present and empty. It is the anchor Flow B appends under — creating it now avoids a fragile search later.

### 6. Confirm

Report the count, the milestones they landed under, and the [Todo List](https://app.notion.com/p/39a65a498a978044882cfe45080e7443) link. Don't paste the full list back — the user just approved it.

---

## Flow B — Advance

### 1. Resolve which task is meant — before touching anything

Query the open tasks:

```sql
SELECT url, "Task name", "Status" FROM "collection://39a65a49-8a97-8020-9891-000b91c99dd0"
WHERE "Status" != 'Done'
```

Match the user's words against `Task name`. Then:

- **Exactly one plausible match** → proceed, and name the task you matched in your reply so a wrong match is caught immediately.
- **Several plausible** → list them and ask. Do not guess.
- **None** → say so and offer to create it rather than silently doing nothing.

Never resolve a task by list position ("the third one") from an earlier message — the ordering is not stable across sessions. Always match on content.

### 2. Determine the transition

| User says | Transition |
|---|---|
| "starting on X", "picking up X" | → `In progress` |
| "X is done", "finished X" | → `Done` |
| "move X forward" | Advance one step from its **current** status: `Not started` → `In progress`, `In progress` → `Done` |
| "note on X: …" | No status change; notes only |

"Move forward" is ambiguous by nature, so always state the transition you're applying (`Not started → In progress`) rather than just confirming you updated it. If the jump would skip a step (`Not started` → `Done`), do it, but say that's what happened.

### 3. Apply the status change

`notion-update-page` with `command: "update_properties"` and `{"Status": "<new value>"}`.

### 4. Append notes

Get the timestamp at runtime — do not assume. PowerShell: `Get-Date -Format 'yyyy-MM-dd HH:mm'`.

Notes on a single task read as a log, so they run **oldest → newest**. Fetch the page first and anchor on the last thing in the Notes section:

- **No notes yet** — `old_str`: `## Notes`, `new_str`:
  ```
  ## Notes

  - **YYYY-MM-DD HH:MM** — <the note>
  ```
- **Notes already exist** — `old_str` is the **last existing note line**, `new_str` is that same line followed by the new bullet.

Use `command: "update_content"` in both cases. Never `replace_content` — it would put the rest of the page at risk.

If the page has no `## Notes` heading (created outside this skill), use `command: "insert_content"` with `position: {"type": "end"}` and the heading plus the bullet.

### 5. Confirm

One line: task name, `old → new` status, and the task's page URL. If notes were added without a status change, say that explicitly so it's clear nothing moved.

---

## Guardrails

- **Approval gates creation, not updates.** Flow A never writes without explicit sign-off. Flow B acts on a task the user just named — but only that task.
- **Never rename an existing task's title.** Resolution depends on it, and a renamed task becomes unfindable by the words the user remembers. If scope changed, add a note saying so.
- **Never delete or archive rows.** `Done` is the terminal state. If the user wants a task dropped, add a note explaining why and ask before changing anything else.
- **One task, one row.** Before creating, check whether an open task already covers it.
- **Never write secrets or raw financial data** into a title, body, or note — same rule as `worklog`. Tasks and notes describe *structure and intent*: no account numbers, balances, statement contents, credentials, or `.env` values. If a task concerns real statement fixtures, describe it abstractly.
- **Notes are for decisions and blockers**, not progress narration. "Chose keyword rules over regex — see planner §2.5" is worth a note; "did some work on this" is not.
- The full Notion-flavored Markdown spec is the MCP resource `notion://docs/enhanced-markdown-spec` — read it via the MCP resource interface if you need block syntax beyond headings and bullets.
