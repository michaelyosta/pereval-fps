# Threat director

ThreatDirector has monitor, escalating, crisis, and recovery phases. Objective steps and extraction add pressure; recovery lowers threat and temporarily blocks new encounters.

A spawn request must have a candidate outside the minimum player distance, outside direct line of sight, and outside the player's current node. Active enemies and a finite encounter budget cap the system, so repeated noise cannot create an unbounded encounter loop.

The director is seeded independently from the run layout (<run-seed>:threat). Spawn selection is therefore reproducible while still allowing combat micro-events to use a separate stream.
