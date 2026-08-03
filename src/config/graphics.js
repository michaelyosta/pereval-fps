export const QUALITY_PRESETS = {
  Low: { pixelRatio: 0.85, shadows: false, bloom: 0.22, grain: 0.018 },
  Medium: { pixelRatio: 1, shadows: true, bloom: 0.35, grain: 0.028 },
  High: { pixelRatio: 1.35, shadows: true, bloom: 0.48, grain: 0.04 },
  Ultra: { pixelRatio: 1.75, shadows: true, bloom: 0.58, grain: 0.05 },
};

export function getQualityPreset(name) {
  return QUALITY_PRESETS[name] ? name : 'High';
}
