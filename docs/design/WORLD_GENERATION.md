# World generation

Generation is deterministic by RunSeed and named GenerationContext streams. The expedition foundation contains 18 authored LevelModuleDefinition records, including a checkpoint, hub, industrial and interior modules, objectives, danger, horror, reward, and extraction spaces.

WorldGenerator builds a 10–16 node WorldGraph: a start, hub, authored main route, objective module, return route, extraction, an optional branch, a danger/reward detour, and a shortcut. It does not generate an arbitrary wall maze.

Every module carries size, bounds, connectors, spawn/loot/enemy/objective/cover points, audio zones, light zones, difficulty, weight, and tags. Module instances are positioned in separate authored lanes. Connector metadata remains explicit for later Three.js door and transition assembly.

WorldValidator checks connectivity, objective and extraction reachability, route length, branching, connector validity, connector-aware route transitions, bounds overlap, point bounds, resources, and density. `ConnectorAwarePlanner` produces weighted routes with the paired connector ids and world-space transition points for the main route, objective, and alternative extraction. Failed attempts use a derived seed and stop after a bounded attempt count. GeneratedWorld and WorldAssembler keep logical generation independent from renderable objects; SpatialIndex provides nearby queries for later collision, raycast, noise, and enemy systems.
