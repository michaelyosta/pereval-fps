export class InteractionPrompt {
  constructor({ id, label, action = 'E', distance = 0, progress = 0, available = true } = {}) {
    this.id = id;
    this.label = label;
    this.action = action;
    this.distance = distance;
    this.progress = progress;
    this.available = available;
  }
}

export class InteractionResult {
  constructor({ ok = false, id = null, type = null, reason = null, value = null } = {}) {
    this.ok = ok;
    this.id = id;
    this.type = type;
    this.reason = reason;
    this.value = value;
  }
}

export class Interactable {
  constructor({
    id,
    type,
    position,
    label,
    radius = 2.2,
    duration = 0,
    available = () => true,
    canInteract = () => true,
    onInteract = () => true,
    onCancel = () => {},
  } = {}) {
    this.id = id;
    this.type = type;
    this.position = { ...position };
    this.label = label ?? type ?? id;
    this.radius = radius;
    this.duration = Math.max(0, duration);
    this.available = available;
    this.canInteract = canInteract;
    this.onInteract = onInteract;
    this.onCancel = onCancel;
  }

  prompt(playerPosition, context = {}) {
    const distance = Math.hypot(this.position.x - playerPosition.x, this.position.z - playerPosition.z);
    const available = this.available(context) && distance <= this.radius;
    return new InteractionPrompt({
      id: this.id,
      label: this.label,
      distance,
      available,
      progress: context.activeInteraction?.id === this.id ? context.activeInteraction.progress : 0,
    });
  }
}

export class InteractionSystem {
  constructor({ lineOfSight = () => true } = {}) {
    this.lineOfSight = lineOfSight;
    this.interactables = new Map();
    this.active = null;
  }

  register(interactable) {
    const value = interactable instanceof Interactable ? interactable : new Interactable(interactable);
    this.interactables.set(value.id, value);
    return value;
  }

  registerMany(interactables = []) {
    for (const interactable of interactables) this.register(interactable);
    return this;
  }

  unregister(id) {
    if (this.active?.id === id) this.cancel({ reason: 'unregistered' });
    return this.interactables.delete(id);
  }

  clear() {
    this.cancel({ reason: 'cleared' });
    this.interactables.clear();
  }

  nearest(playerPosition, context = {}) {
    let best = null;
    let bestDistance = Infinity;
    for (const interactable of this.interactables.values()) {
      const prompt = interactable.prompt(playerPosition, { ...context, activeInteraction: this.active });
      if (!prompt.available || prompt.distance >= bestDistance) continue;
      if (!this.lineOfSight(playerPosition, interactable, context)) continue;
      best = interactable;
      bestDistance = prompt.distance;
    }
    return best;
  }

  prompt(playerPosition, context = {}) {
    const interactable = this.nearest(playerPosition, context);
    return interactable?.prompt(playerPosition, { ...context, activeInteraction: this.active }) ?? null;
  }

  interact(playerPosition, context = {}) {
    if (this.active) return new InteractionResult({ reason: 'busy' });
    const interactable = this.nearest(playerPosition, context);
    if (!interactable) return new InteractionResult({ reason: 'nothing-nearby' });
    if (!interactable.canInteract(context))
      return new InteractionResult({ id: interactable.id, type: interactable.type, reason: 'unavailable' });
    if (interactable.duration > 0) {
      this.active = { id: interactable.id, progress: 0, duration: interactable.duration, context };
      return new InteractionResult({ id: interactable.id, type: interactable.type, value: 'started' });
    }
    return this.complete(interactable, context);
  }

  tick(seconds, playerPosition, context = {}) {
    if (!this.active || !Number.isFinite(seconds) || seconds <= 0) return null;
    const interactable = this.interactables.get(this.active.id);
    if (!interactable) return this.cancel({ reason: 'missing' });
    const distance = Math.hypot(
      interactable.position.x - playerPosition.x,
      interactable.position.z - playerPosition.z,
    );
    if (
      distance > interactable.radius ||
      context.moving ||
      context.damaged ||
      !this.lineOfSight(playerPosition, interactable, context)
    )
      return this.cancel({ reason: 'cancelled' });
    this.active.progress = Math.min(interactable.duration, this.active.progress + seconds);
    if (this.active.progress < interactable.duration)
      return new InteractionResult({ id: interactable.id, type: interactable.type, value: 'progress' });
    return this.complete(interactable, context);
  }

  complete(interactable, context = {}) {
    const value = interactable.onInteract(context);
    this.active = null;
    return new InteractionResult({
      ok: value !== false,
      id: interactable.id,
      type: interactable.type,
      value,
      reason: value === false ? 'rejected' : null,
    });
  }

  cancel({ reason = 'cancelled' } = {}) {
    const active = this.active;
    if (active) this.interactables.get(active.id)?.onCancel({ reason });
    this.active = null;
    return new InteractionResult({
      id: active?.id ?? null,
      type: this.interactables.get(active?.id)?.type ?? null,
      reason,
    });
  }
}
