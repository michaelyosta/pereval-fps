# Threat director

ThreatDirector has monitor, escalating, crisis, and recovery phases. Objective steps and extraction add pressure; recovery lowers threat and temporarily blocks new encounters.

A spawn request must have a candidate outside the minimum player distance, outside direct line of sight, outside the player's current node, and reachable through the connector-aware planner. Active enemies and a finite encounter budget cap the system, so repeated noise cannot create an unbounded encounter loop. EncounterDirector reserves the initial groups, listens to pressure signals, and turns a safe dormant group into a runtime request. The main thread passes that request to the Three.js bot factory; killed expedition bots are removed permanently from the current run instead of respawning.

Objective, noise, event, and extraction signals feed the director with a reason string visible in its snapshot. The director is seeded independently from the run layout (`<run-seed>:threat`). Spawn selection is therefore reproducible while still allowing combat micro-events to use a separate stream.
