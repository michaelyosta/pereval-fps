export class SkillDefinition {
  constructor({ id, name, category, description, modifier, duration = 180, stackable = false }) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.description = description;
    this.modifier = { ...modifier };
    this.duration = duration;
    this.stackable = stackable;
  }
}

export class TemporarySkill {
  constructor(definition, remaining = definition.duration) {
    this.definition = definition;
    this.remaining = remaining;
    this.active = true;
  }

  tick(seconds) {
    this.remaining = Math.max(0, this.remaining - Math.max(0, seconds));
    if (this.remaining === 0) this.active = false;
  }
}

export class SkillRegistry {
  constructor(definitions = createDefaultSkills()) {
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  get(id) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error('Unknown skill: ' + id);
    return definition;
  }

  all() {
    return [...this.definitions.values()];
  }

  grant(id) {
    return new TemporarySkill(this.get(id));
  }
}

export function createDefaultSkills() {
  return [
    new SkillDefinition({
      id: 'steady-hands',
      name: 'Твёрдая рука',
      category: 'combat',
      description: 'Уменьшает разброс прицеливания.',
      modifier: { spreadMultiplier: 0.72 },
    }),
    new SkillDefinition({
      id: 'fast-reload',
      name: 'Быстрая перезарядка',
      category: 'combat',
      description: 'Сокращает время перезарядки.',
      modifier: { reloadMultiplier: 0.7 },
    }),
    new SkillDefinition({
      id: 'deep-breath',
      name: 'Глубокий вдох',
      category: 'survival',
      description: 'Снижает отдачу после попадания.',
      modifier: { recoilMultiplier: 0.75 },
    }),
    new SkillDefinition({
      id: 'field-medic',
      name: 'Полевой медик',
      category: 'survival',
      description: 'Увеличивает эффективность лечения.',
      modifier: { healingMultiplier: 1.35 },
    }),
    new SkillDefinition({
      id: 'hardcase',
      name: 'Жёсткий корпус',
      category: 'survival',
      description: 'Даёт небольшой запас здоровья.',
      modifier: { maxHealthBonus: 15 },
    }),
    new SkillDefinition({
      id: 'quiet-step',
      name: 'Тихий шаг',
      category: 'exploration',
      description: 'Уменьшает шум движения.',
      modifier: { movementNoiseMultiplier: 0.55 },
    }),
    new SkillDefinition({
      id: 'scavenger',
      name: 'Собиратель',
      category: 'exploration',
      description: 'Повышает шанс дополнительного ресурса.',
      modifier: { lootMultiplier: 1.2 },
    }),
    new SkillDefinition({
      id: 'route-memory',
      name: 'Память маршрута',
      category: 'exploration',
      description: 'Раскрывает больше соседних узлов карты.',
      modifier: { mapReveal: 2 },
    }),
    new SkillDefinition({
      id: 'anomaly-sense',
      name: 'Чутьё аномалии',
      category: 'anomalous',
      description: 'Раньше предупреждает об аномальной активности.',
      modifier: { anomalyWarning: 1 },
    }),
    new SkillDefinition({
      id: 'low-profile',
      name: 'Низкий профиль',
      category: 'anomalous',
      description: 'Снижает шанс обнаружения преследователем.',
      modifier: { watcherDetectionMultiplier: 0.65 },
    }),
    new SkillDefinition({
      id: 'signal-reader',
      name: 'Чтение сигнала',
      category: 'anomalous',
      description: 'Даёт более точные направления шума.',
      modifier: { noiseDirection: 1 },
    }),
    new SkillDefinition({
      id: 'last-stand',
      name: 'Последний шанс',
      category: 'survival',
      description: 'Один раз смягчает смертельный удар.',
      modifier: { deathGuard: 1 },
    }),
  ];
}
