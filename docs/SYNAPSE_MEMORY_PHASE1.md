# Synapse Memory Phase 1

## Current Agent Skills

Synapse does not currently use a separate `SKILL.md` file. Its skills are defined in code:

- Tool routing prompt and tool schemas: `lib/synapse-runtime.ts`
- LangGraph nodes: `load_context -> decide_tools -> execute_tools -> generate_answer -> persist_turn`
- Tool implementations: retrieval, document reading, document creation, sandbox file listing, URL download, Docker sandbox terminal
- UI labels and plan cards: `app/agent/page.tsx`

This means skills are currently application-native capabilities, not external plugin documents.

## Current Self-Knowledge

Synapse self-knowledge is injected through system prompts in `lib/synapse-runtime.ts`.

The current prompt tells the model:

- Synapse has a persistent per-user server workspace.
- Uploaded files, downloaded files, extracted archives, converted Markdown, generated documents, and sandbox outputs can persist across conversations.
- Terminal commands run only after user confirmation inside a restricted Docker sandbox mounted at `/workspace`.

There is no standalone self-knowledge file yet. A future phase can move this into a versioned agent profile document.

## Previous Memory State

Before Phase 1, memory was only a compact conversation summary stored in:

- `agent_conversations.metadata.memorySummary`
- `agent_conversations.metadata.memoryUpdatedAt`
- `agent_conversations.metadata.memorySource`

That summary is useful as a short-term compression fallback, but it is not inspectable, categorized, searchable, editable, or evented.

## New Tables

Run:

```sql
-- Supabase SQL editor
\i supabase/migration_synapse_memory_phase1.sql
```

The migration adds:

- `memories`: generic layered memory, L0-L5
- `memory_embeddings`: reserved embedding table, JSONB vector placeholder for now
- `memory_links`: relation graph between memories
- `user_learning_profiles`: learning-specific memory
- `project_memories`: project/research state memory
- `memory_events`: create/update/delete/link audit log
- `memory_settings`: user-level memory privacy and write controls

Phase 1 intentionally uses text retrieval and structured filters. Vector retrieval will be added later.

## New Core Services

`lib/memory-service.ts` provides:

- `MemoryManager`: create, update, soft/hard delete, text search, context formatting, linking, settings
- `MemoryExtractor`: conservative heuristic candidate extraction
- `MemoryWriter`: writes extracted candidates through `MemoryManager`
- `LearningMemoryService`: upsert/list learning profiles
- `ProjectMemoryService`: upsert/list project memories

The extractor is intentionally conservative. It only creates active memories for explicit "记住/remember" requests; inferred preferences and research context start as `candidate`.

## New APIs

- `GET /api/memory`
- `POST /api/memory`
- `GET /api/memory/[id]`
- `PATCH /api/memory/[id]`
- `DELETE /api/memory/[id]?hard=true`
- `POST /api/memory/context`
- `GET /api/memory/learning`
- `POST /api/memory/learning`
- `GET /api/memory/projects`
- `POST /api/memory/projects`
- `GET /api/memory/settings`
- `PATCH /api/memory/settings`

All routes require the existing Bearer Supabase token and rely on RLS.

## Phase 2 Agent Integration

Implemented in `lib/synapse-runtime.ts`:

- `load_context` retrieves relevant long-term memories with `MemoryManager.getMemoryContext()`.
- Tool routing receives both conversation-summary memory and structured memory context.
- Answer generation receives structured memory as user/task context, not as external factual evidence.
- `persist_turn` runs `MemoryWriter` after the assistant answer.
- Explicit "记住/remember" requests become active memories; inferred preferences and research/project context are written as candidates.
- Assistant message metadata stores `usedMemories` and `memoryWrite`.
- SSE emits `load_memory` and `write_memory` progress events.

## Remaining Next Phase

1. Render `usedMemories` and `memoryWrite` in the right-side agent status panel.
2. Add a minimal `/memory` management page for view/edit/delete/disable.
3. Add vector embeddings and semantic retrieval.
4. Add user confirmation or undo UI for candidate memories.
5. Add learning/project-specific extraction prompts instead of only heuristic extraction.
