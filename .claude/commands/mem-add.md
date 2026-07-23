---
description: Record a new memory in the project memory store (manual memory — only when I run this).
argument-hint: "<the fact to remember>"
---

Record a memory capturing: $ARGUMENTS

Operate on the project's native memory store — the `memory/` directory with its `MEMORY.md` index. Steps:

1. Read `MEMORY.md` and scan existing memories. If one already covers this fact, **update that file** instead of creating a duplicate.
2. Otherwise create one memory file holding this single fact, with frontmatter:
   ```
   ---
   name: <short-kebab-case-slug>
   description: <one-line summary — used for recall>
   metadata:
     type: user | feedback | project | reference
   ---
   ```
   For `feedback` or `project`, follow the fact with **Why:** and **How to apply:** lines. Convert relative dates to absolute. Link related memories with `[[their-name]]`.
3. Add a one-line pointer to `MEMORY.md`: `- [Title](file.md) — hook`.

Confirm what you recorded (name · type · path). Do not record anything the repo already documents or that only matters to this conversation.
