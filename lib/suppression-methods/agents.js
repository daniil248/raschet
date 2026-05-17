/* =========================================================================
   suppression-methods/agents.js — catalog of clean-agent / inert gas
   fire suppression agents (АГПТ ГОТВ).

   Properties sourced from NFPA 2001 (2018), ISO 14520, SP 485.1311500.2020,
   SP RK 2.02-102-2022, and manufacturer datasheets (DuPont, 3M, Siex).

     type          — 'halocarbon' or 'inert'
     molarMass     — g/mol
     rho20         — gaseous density at 20°C 1 atm, kg/m³
     s20           — specific volume at 20°C, m³/kg
     Cmin_A        — minimum extinguishing concentration, fire class A, vol %
     Cmin_B        — minimum extinguishing concentration, fire class B, vol %
     Cmax          — NOAEL (no observed adverse effect level), vol %
     dischargeS    — normative discharge time, s
     fillRatioMax  — halocarbon: kg/L; inert: MPa
   ========================================================================= */

export const AGENTS = {
  'HFC-227ea': {
    label: 'HFC-227ea (FM-200)',
    type: 'halocarbon',
    molarMass: 170.03, rho20: 7.18, s20: 0.1373,
    Cmin_A: 7.0, Cmin_B: 8.7, Cmax: 10.5,
    dischargeS: 10, fillRatioMax: 1.15,
    notes: 'ODP=0, GWP=3220.',
  },
  'FK-5-1-12': {
    label: 'FK-5-1-12 (Novec 1230)',
    type: 'halocarbon',
    molarMass: 316.04, rho20: 13.60, s20: 0.0719,
    Cmin_A: 4.2, Cmin_B: 5.3, Cmax: 10.0,
    dischargeS: 10, fillRatioMax: 1.20,
    notes: 'GWP=1, ODP=0.',
  },
  'HFC-125': {
    label: 'HFC-125',
    type: 'halocarbon',
    molarMass: 120.02, rho20: 5.93, s20: 0.1672,
    Cmin_A: 8.0, Cmin_B: 9.4, Cmax: 11.5,
    dischargeS: 10, fillRatioMax: 1.00,
    notes: 'GWP=3500, ODP=0.',
  },
  'HFC-23': {
    label: 'HFC-23',
    type: 'halocarbon',
    molarMass: 70.01, rho20: 3.07, s20: 0.3258,
    Cmin_A: 12.0, Cmin_B: 12.0, Cmax: 30.0,
    dischargeS: 10, fillRatioMax: 0.86,
    notes: 'For low-temperature protected volumes.',
  },
  'CO2': {
    label: 'CO2',
    type: 'inert',
    molarMass: 44.01, rho20: 1.81, s20: 0.5521,
    Cmin_A: 34.0, Cmin_B: 34.0, Cmax: 0,
    dischargeS: 60, fillRatioMax: 0.75,
    notes: 'Lethal at extinguishing concentrations — unoccupied areas only.',
  },
  'IG-541': {
    label: 'IG-541 (Inergen: N2 52% / Ar 40% / CO2 8%)',
    type: 'inert',
    molarMass: 34.08, rho20: 1.40, s20: 0.7140,
    Cmin_A: 39.9, Cmin_B: 39.9, Cmax: 52.0,
    dischargeS: 60, fillRatioMax: 30.0,
    notes: 'Cylinders 80/140 L, 200/300 bar.',
  },
  'IG-55': {
    label: 'IG-55 (Argonite: N2 50% / Ar 50%)',
    type: 'inert',
    molarMass: 33.95, rho20: 1.41, s20: 0.7090,
    Cmin_A: 40.0, Cmin_B: 40.0, Cmax: 52.0,
    dischargeS: 60, fillRatioMax: 30.0,
    notes: '',
  },
  'IG-100': {
    label: 'IG-100 (N2)',
    type: 'inert',
    molarMass: 28.01, rho20: 1.165, s20: 0.8584,
    Cmin_A: 40.3, Cmin_B: 40.3, Cmax: 52.0,
    dischargeS: 60, fillRatioMax: 30.0,
    notes: '',
  },
  'IG-01': {
    label: 'IG-01 (Ar)',
    type: 'inert',
    molarMass: 39.95, rho20: 1.663, s20: 0.6015,
    Cmin_A: 41.9, Cmin_B: 41.9, Cmax: 52.0,
    dischargeS: 60, fillRatioMax: 30.0,
    notes: '',
  },
  'SF6': {
    label: 'SF6',
    type: 'inert',
    molarMass: 146.06, rho20: 6.17, s20: 0.1620,
    Cmin_A: 10.0, Cmin_B: 10.0, Cmax: 30.0,
    dischargeS: 60, fillRatioMax: 1.25,
    notes: 'GWP=23500 — banned in most jurisdictions.',
  },
};

export const CYLINDERS = {
  halocarbon: [
    { V: 40,  label: '40 L'  },
    { V: 70,  label: '70 L'  },
    { V: 100, label: '100 L' },
    { V: 120, label: '120 L' },
    { V: 140, label: '140 L' },
    { V: 180, label: '180 L' },
  ],
  inert: [
    { V: 80,  P: 200, label: '80 L / 200 bar'  },
    { V: 80,  P: 300, label: '80 L / 300 bar'  },
    { V: 140, P: 200, label: '140 L / 200 bar' },
    { V: 140, P: 300, label: '140 L / 300 bar' },
  ],
};

export function Cnorm(agent, fireClass /* 'A'|'B'|'C' */, safetyFactor = 1.2) {
  const a = AGENTS[agent];
  if (!a) throw new Error('Unknown agent: ' + agent);
  const Cmin = fireClass === 'A' ? a.Cmin_A : a.Cmin_B;
  return +(Cmin * safetyFactor).toFixed(2);
}
