# CHANGELOG

# 23.06.2026 (v0.7.0)

- Global Category / SubCategory header filters are now multi-select (checkbox dropdowns)

# 23.06.2026 (v0.6.0)

- Save individual chat responses (★ Save) — kept permanently in a dropdown, even after the chat is cleared

# 22.06.2026 (v0.5.0)

- Global Category / SubCategory filters in the header — apply across all tabs and the chat data
- Categories chart can switch between Category and Subcategory grouping; charts respond to all table filters
- Payments "Text" column fills remaining width instead of growing without limit
- Docker: container build + run with restart-always; dev server listens on the LAN

# 22.06.2026 (v0.4.0)

- Import CSVs directly from a GitHub folder (public, or private via a Personal Access Token)
- Refresh button re-pulls the latest data from the saved GitHub source

# 15.06.2026 (v0.3.0)

- Consistent UI/Data naming
- Demo Data Load

# 14.06.2026 (v0.2.0)

- Global Date Range selector (6/12/24mo/all) in the header filters every tab
- Importer:
  - Drag in CSV files anywhere to import data (auto-reload)
  - Validates headers of CSVs (enforce known headers, ignore rest)
- Chat
  - Data is compressed to save tokens
  - Render responses as markdown
  - Choose which data is sent as context
  - Data is cached to save costs
  - Show live cost (token spend) preview
  - Conversation history saved
- Technical
  - All local data prefixed with `/fintool/`

# 13.06.2026 (v0.1.0)

- Save prompt history for re-use
- Model selection (Haiku/Sonnet/Opus) and API key saved (localStorage)
