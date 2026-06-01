<!-- Česká verze: MCP.md -->
# HOTOVO via MCP - quick guide for an agent

You are connected to **HOTOVO** (a task manager) over MCP. **Start by calling `get_state`.**

## Concepts
- **Project** (list): `id`, `name`, `color`.
- **Task**: `id`, `list_id`, `parent_id` (subtask), `title`, `description`,
  `status` = `pending|completed`, `priority` = `low|medium|high|urgent`,
  `due_date`, `recurrence` = `daily|weekly|monthly|none`, `tags` = array of strings.
- `due_date`: `YYYY-MM-DD` (all-day) or full ISO 8601 with a timezone.
  **A task with a `due_date` is automatically mirrored to Google Calendar.**

## Tools
| tool | arguments | what it does |
|---|---|---|
| `get_state` | - | snapshot: projects + tasks + counts (call this first) |
| `list_projects` | - | list projects |
| `create_project` | `name`*, `color?` | new project |
| `list_tasks` | `list_id?`, `status?`, `priority?`, `due_date?` | filtered list |
| `create_task` | `title`*, `list_id`*, `parent_id?`, `description?`, `priority?`, `due_date?`, `recurrence?`, `tags?` | new task/subtask |
| `update_task` | `id`* + fields to change | edit (rename, due date, move project…) |
| `complete_task` | `id`* | mark done |
| `delete_task` | `id`*, `confirm?` | delete a task |

## Rules
- **Call `get_state` first** - so you know the `id`s of projects and tasks.
- **Subtask**: `parent_id` must be a task in the **same project**.
- **Completing a parent** completes its subtasks; completing **all** subtasks completes the parent.
- A **recurring task** rolls forward to the next date when completed (no duplicate).
- **Deleting a task that has subtasks** → `delete_task` with `confirm: true` (otherwise it errors).
- On failure you get `Chyba: <message>` - fix the input and retry.

## Example
1. `get_state` → find the project "Osobni" and its `id`.
2. `create_task { "title": "Dentist", "list_id": "<Osobni.id>", "due_date": "2026-06-10", "priority": "high", "tags": ["health"] }`
   → creates the task and a Google Calendar event on June 10.
3. Done? `complete_task { "id": "<task.id>" }`.
