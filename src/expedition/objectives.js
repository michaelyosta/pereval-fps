export class ObjectiveDefinition {
  constructor({ id, title, type, steps, critical = true }) {
    this.id = id;
    this.title = title;
    this.type = type;
    this.critical = critical;
    this.steps = steps.map((step) => (step instanceof ObjectiveStep ? step : new ObjectiveStep(step)));
  }
}

export class ObjectiveStep {
  constructor({ id, label, nodeId, interaction = 'interact', noise = 0, threat = 0 }) {
    this.id = id;
    this.label = label;
    this.nodeId = nodeId;
    this.interaction = interaction;
    this.noise = noise;
    this.threat = threat;
    this.completed = false;
  }
}

export class ObjectiveInstance {
  constructor(definition) {
    this.definition =
      definition instanceof ObjectiveDefinition ? definition : new ObjectiveDefinition(definition);
    this.currentStep = 0;
    this.active = false;
    this.completed = false;
  }

  get steps() {
    return this.definition.steps;
  }

  get id() {
    return this.definition.id;
  }

  get title() {
    return this.definition.title;
  }

  current() {
    return this.steps[this.currentStep] ?? null;
  }
}

export class ObjectiveMarker {
  constructor({ objectiveId, stepId, nodeId, position = null, label = '' }) {
    this.objectiveId = objectiveId;
    this.stepId = stepId;
    this.nodeId = nodeId;
    this.position = position ? { ...position } : null;
    this.label = label;
    this.visible = true;
  }
}

export class ObjectiveDirector {
  constructor(objective, world = null) {
    this.world = world;
    const definition =
      objective instanceof ObjectiveDefinition ? objective : new ObjectiveDefinition(objective);
    this.instance = new ObjectiveInstance(definition);
    this.markers = this.instance.steps.map(
      (step) =>
        new ObjectiveMarker({
          objectiveId: this.instance.id,
          stepId: step.id,
          nodeId: step.nodeId,
          position: this.resolvePosition(step.nodeId),
          label: step.label,
        }),
    );
  }

  resolvePosition(nodeId) {
    const node = this.world?.graph?.getNode?.(nodeId);
    const point = node?.definition?.objectivePoints?.[0];
    return node && point ? node.worldPoint(point) : (node?.position ?? null);
  }

  start() {
    this.instance.active = true;
    return this.instance;
  }

  completeStep({ stepId = null, nodeId = null, force = false } = {}) {
    if (!this.instance.active) this.start();
    const step = this.instance.current();
    if (!step || (stepId && step.id !== stepId) || (!force && nodeId && step.nodeId !== nodeId)) return false;
    step.completed = true;
    this.instance.currentStep += 1;
    if (this.instance.currentStep >= this.instance.steps.length) {
      this.instance.completed = true;
      this.instance.active = false;
    }
    const marker = this.markers.find((item) => item.stepId === step.id);
    if (marker) marker.visible = false;
    return true;
  }

  isComplete() {
    return this.instance.completed;
  }

  snapshot() {
    return {
      id: this.instance.id,
      title: this.instance.title,
      type: this.instance.definition.type,
      active: this.instance.active,
      completed: this.instance.completed,
      currentStep: this.instance.currentStep,
      steps: this.instance.steps.map((step) => ({ ...step })),
      markers: this.markers.map((marker) => ({ ...marker })),
    };
  }
}
