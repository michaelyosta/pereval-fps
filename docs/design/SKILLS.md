# Temporary skills

SkillRegistry contains 12 temporary skills across combat, survival, exploration, and anomalous categories. Each skill has an explicit modifier and duration. TemporarySkill.tick() expires it; CampaignState never serializes it.

The current set includes steady hands, fast reload, deep breath, field medic, hardcase, quiet step, scavenger, route memory, anomaly sense, low profile, signal reader, and last stand. The generator selects a deterministic reward subset for each run.
