# Save system

SaveSystem serializes version 1 campaign data: completed runs, permanent unlocks, stash, and best time. It does not serialize an active run or temporary skills.

Loading is defensive: malformed JSON returns a fresh CampaignState, newer unsupported versions are rejected safely, and version 0 fields (runs/unlocks) migrate into the current schema. The browser storage adapter is optional, so tests can supply an in-memory adapter.

`export()` returns a versioned JSON string, `import()` validates/migrates and persists it, and `reset()` removes the campaign key and returns a fresh state. Active run inventory, loot, and temporary skills are intentionally excluded from campaign serialization; successful extraction grants the permanent `field-clearance` unlock and updates best time.
