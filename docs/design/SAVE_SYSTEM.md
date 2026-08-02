# Save system

SaveSystem serializes version 1 campaign data: completed runs, permanent unlocks, stash, and best time. It does not serialize an active run or temporary skills.

Loading is defensive: malformed JSON returns a fresh CampaignState, newer unsupported versions are rejected safely, and version 0 fields (runs/unlocks) migrate into the current schema. The browser storage adapter is optional, so tests can supply an in-memory adapter.
