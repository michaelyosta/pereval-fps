# Weapons

The data-driven WeaponRegistry currently contains four distinct families:

- pistol: quiet, fast-switch sidearm;
- rifle: automatic medium-range weapon;
- shotgun: eight-pellet close-range weapon;
- OBLOMOK-7: anomalous rifle with high damage and long range.

WeaponState owns ammo, reserve, cooldown, reload timing, and fire results. It is independent from the legacy arena combat adapter so weapon unit tests can run without Three.js.
