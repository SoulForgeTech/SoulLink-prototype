# SoulLink Changelog

## v0.6.0 — 2026-02-23

### New Features
- **AI Image Generation in Chat**
  - AI companion can autonomously send images (selfies, scenes, etc.) via `[IMAGE: description]` markers
  - Uses xAI `grok-imagine-image` API ($0.02/image), 20 images/day per user limit
  - System prompt templates (`system_prompt_template.txt`, `system_prompt_template_custom.txt`) include `[IMAGE:]` usage instructions
  - Backend detects `[IMAGE:]` markers, strips from reply, generates image, returns to frontend

- **Character Appearance Consistency**
  - Auto-extracts visual appearance from persona via Gemini (art style, hair, eyes, clothing, etc.)
  - Appearance cached in `user.settings.image_appearance` for consistent image generation
  - Appearance prepended to every image prompt: `Character appearance: {appearance}. Scene: {prompt}`
  - Custom persona import (`character_parser.py`) now extracts `appearance` field alongside personality
  - Confirm-persona endpoint saves appearance; clear-persona clears it
  - Default fallback appearance (anime style) for users without custom persona

- **Image Persistence via Cloudinary**
  - Generated images uploaded to Cloudinary (free tier: 25 credits ≈ 25 GB storage + bandwidth)
  - Permanent URLs stored in MongoDB message attachments (`attachments[].url`)
  - Images survive page refresh — frontend loads from Cloudinary URL in chat history
  - Folder structure: `soullink/chat_images/{user_id}/{timestamp}`

- **Inline Image Display & Viewer**
  - Generated images rendered inline in chat bubbles (max-width 280px, rounded corners)
  - Click-to-zoom fullscreen image viewer overlay
  - History messages with Cloudinary URL show real images; without URL show placeholder

### Backend Changes
- **`image_gen.py`** (NEW): Core image generation module
  - `extract_image_markers()` — regex extraction of `[IMAGE:]` tags (first only)
  - `_extract_appearance_from_persona()` — Gemini-based appearance extraction
  - `get_appearance_prefix()` — lazy cache lookup/extraction/fallback
  - `generate_image()` — xAI API call with 60s timeout
  - `upload_to_cloudinary()` — base64 → Cloudinary upload with permanent URL
  - `process_image_markers()` — top-level orchestrator: extract → limit check → appearance → generate → upload
  - `DEFAULT_APPEARANCE` — generic anime fallback for users without persona
- **`app_new.py`**: Image processing in chat endpoint (before RENAME detection), image attachments with URL in message save, images in response JSON
- **`character_parser.py`**: Extraction prompts (ZH/EN) now output `appearance` field; search prompts request detailed appearance
- **`.env`**: Added `XAI_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

### Frontend Changes
- **`index.html`**: CSS for `.generated-images`, `.generated-image`, `.image-viewer-overlay`; `addMessageToUI` 5th param `generatedImages`; `openImageViewer`/`closeImageViewer`; history attachments render real image from URL; confirm-persona passes appearance

### Database Schema
- `users.settings.image_appearance`: Cached appearance description string
- `image_gen_usage`: Collection tracking per-user daily image generation count
- `conversations.messages[].attachments[].url`: Cloudinary permanent URL for generated images
- `conversations.messages[].attachments[].isGenerated`: Boolean flag for AI-generated image attachments

---

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
