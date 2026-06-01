<!-- English version: MCP.en.md -->
# HOTOVO přes MCP - rychlý návod pro agenta

Jsi připojen k aplikaci **HOTOVO** (správa úkolů) přes MCP. **Začni voláním `get_state`.**

## Pojmy
- **Projekt** (list): `id`, `name`, `color`.
- **Úkol**: `id`, `list_id`, `parent_id` (podúkol), `title`, `description`,
  `status` = `pending|completed`, `priority` = `low|medium|high|urgent`,
  `due_date`, `recurrence` = `daily|weekly|monthly|none`, `tags` = pole řetězců.
- `due_date`: `YYYY-MM-DD` (celý den) nebo ISO 8601 s časovou zónou.
  **Úkol s `due_date` se automaticky propíše do Google Kalendáře.**

## Nástroje
| nástroj | argumenty | co dělá |
|---|---|---|
| `get_state` | - | snapshot: projekty + úkoly + počty (zavolej první) |
| `list_projects` | - | seznam projektů |
| `create_project` | `name`*, `color?` | nový projekt |
| `list_tasks` | `list_id?`, `status?`, `priority?`, `due_date?` | filtrovaný výpis |
| `create_task` | `title`*, `list_id`*, `parent_id?`, `description?`, `priority?`, `due_date?`, `recurrence?`, `tags?` | nový úkol/podúkol |
| `update_task` | `id`* + pole ke změně | úprava (i přejmenování, termín, projekt) |
| `complete_task` | `id`* | označí splněný |
| `delete_task` | `id`*, `confirm?` | smaže úkol |

## Pravidla
- **Nejdřív `get_state`** - ať znáš `id` projektů a úkolů.
- **Podúkol**: `parent_id` musí být úkol ve **stejném projektu**.
- **Dokončení rodiče** dokončí i podúkoly; dokončení **všech** podúkolů dokončí rodiče.
- **Opakovaný úkol** se po dokončení sám posune na další termín (nevytváří duplikát).
- **Mazání úkolu, který má podúkoly** → `delete_task` s `confirm: true` (jinak chyba).
- Při chybě dostaneš text `Chyba: <popis>` - oprav vstup a zkus znovu.

## Příklad
1. `get_state` → najdi projekt „Osobni" a jeho `id`.
2. `create_task { "title": "Zubař", "list_id": "<Osobni.id>", "due_date": "2026-06-10", "priority": "high", "tags": ["zdraví"] }`
   → vznikne úkol a zároveň událost v Google Kalendáři na 10. 6.
3. Hotovo? `complete_task { "id": "<task.id>" }`.
