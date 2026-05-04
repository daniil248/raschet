// =============================================================================
// shared/catalogs/drups/piller.js — Piller (Германия) UNIBLOCK UBT+
// =============================================================================
// v0.60.217 (split). High-speed flywheel с магнитными подшипниками + MAN/MTU.

export const PILLER_DRUPS = [
  {
    vendor: 'Piller', model: 'UNIBLOCK UBT+ (300 kVA)',
    nameplateKva: 300, nameplateKw: 240,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'high-speed-magnetic', autonomySec: 8,
    engineModel: 'MAN D2862 LE451', dieselKw: 260, sfcLkWh: 0.220,
    efficiency: 0.967,
    physical: { lengthMm: 5800, widthMm: 1700, heightMm: 2200, weightKg: 5500 },
    notes: 'High-speed flywheel (магнитные подшипники). Compact для офисных серверных и mid-sized DC.',
  },
  {
    vendor: 'Piller', model: 'UNIBLOCK UBT+ (1670 kVA)',
    nameplateKva: 1670, nameplateKw: 1340,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'high-speed-magnetic', autonomySec: 12,
    engineModel: 'MTU 16V4000G14', dieselKw: 1450, sfcLkWh: 0.203,
    efficiency: 0.972,
    physical: { lengthMm: 9800, widthMm: 2400, heightMm: 2700, weightKg: 21500 },
    notes: 'Standard mid-large block. ISO/IEC 8528-13 DCC class. Используется в Hyperscale ЦОД.',
  },
  {
    vendor: 'Piller', model: 'UNIBLOCK UBT+ (3000 kVA)',
    nameplateKva: 3000, nameplateKw: 2400,
    voltage: 400, phase: 3, freq: 50,
    flywheelType: 'high-speed-magnetic', autonomySec: 16,
    engineModel: 'MTU 20V4000G94', dieselKw: 2550, sfcLkWh: 0.197,
    efficiency: 0.973,
    physical: { lengthMm: 12200, widthMm: 2700, heightMm: 3100, weightKg: 36000 },
    notes: 'Largest standard block. Параллель до 8. КПД 97.3% — лучший в классе. Tier IV.',
  },
];
