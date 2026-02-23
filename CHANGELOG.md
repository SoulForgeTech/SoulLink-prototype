# SoulLink Changelog

## v0.5.0 — 2025-02-23

### New Features
- **Knowledge Base Multi-File Support**
  - Support up to 10 independent documents per user (previously limited to 1)
  - Each document can be uploaded and deleted individually
  - Document list UI with per-item delete buttons
  - Search character results auto-append to knowledge base (no longer overwrite)
  - Lazy migration for existing users (old single-file schema auto-converts)

### Bug Fixes
- **Grok Immersion Rules Lost on Style/Name Change**
  - `update_system_prompt()` now appends Grok-specific immersion rules (previously only `update_workspace_model()` did)

- **Companion Name Auto-Rename Removed**
  - Switching companion subtype no longer changes the user's custom companion name
  - User's chosen name is always preserved

- **Default Persona Missing After Clearing Custom Persona**
  - Added `_generate_subtype_default_persona()` to generate proper persona with character type info when personality test was skipped
  - Fixes blank persona for users who skipped personality test

- **Knowledge Base Delete Returning 500**
  - Root cause: server's `anythingllm_api.py` was outdated, missing `remove_document_from_workspace` method
  - Made `clear_lore` robust: AnythingLLM delete is non-blocking, MongoDB cleanup always runs

- **Custom Persona Overriding Companion Name in System Prompt**
  - Extracted persona text no longer contains identity declarations ("you are XXX")
  - Template `{{companion_name}}` stays as user's display name
  - `custom_persona_name` stored separately for display purposes only

- **Persona Extraction UX**
  - Show estimated wait times: "Searching (~10s)..." and "Extracting (~5s)..."
  - Block modal close during extraction process
  - Added cancel button to persona preview

### Backend Changes
- `app_new.py`: Rewritten `import-lore` (multi-file, `$push`), `clear-lore` (single/batch delete, `$pull`), `custom-status` (returns docs array)
- `workspace_manager.py`: Grok rules in `update_system_prompt()`, `_generate_subtype_default_persona()`, companion name override logic
- `character_parser.py`: Extraction prompt updated — persona text no longer includes identity statements
- `models.py`: New user default `custom_lore_docs: []`
- `admin_panel.html`: Added custom character & KB endpoints, personality test endpoints

### Frontend Changes
- `index.html`: Document list UI (`.lore-doc-item`), multi-file JS functions, extraction UX improvements, i18n updates

### Database Schema
- `settings.custom_lore_docs: [{id, doc_name, doc_location, original_filename, imported_at, status}]` replaces old flat fields
- Lazy migration auto-converts old schema on first access

---

## v0.4.x — Previous versions
- Custom character persona extraction (Gemini AI)
- Character search (Gemini + Google Search grounding)
- Knowledge base (AnythingLLM RAG)
- Personality test system
- Multi-model support (Gemini, GPT-4o, Grok)
- Memory system (intimacy, facts)
- Conversation management
- Google OAuth + Email auth
