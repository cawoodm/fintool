# CHANGELOG

# 15.06.2026 (v0.3.0)

- Bugfix data/exampledata confusion
- Consistent filenames

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
