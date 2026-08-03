# Weapons

The data-driven WeaponRegistry currently contains four distinct families:

- pistol: quiet, fast-switch sidearm;
- rifle: automatic medium-range weapon;
- shotgun: eight-pellet close-range weapon;
- OBLOMOK-7: anomalous rifle with high damage and long range.

WeaponState owns ammo, reserve, cooldown, reload timing, instability/overheat, and fire results. The runtime combat adapter consumes the same definitions: automatic/semi-automatic trigger behavior, weapon movement multipliers, recoil/spread skill modifiers, shotgun pellet rays, range falloff, and shot noise are data-driven. It is independent from the legacy arena path so weapon unit tests can run without Three.js.
