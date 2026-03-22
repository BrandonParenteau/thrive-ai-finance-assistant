// ─── TFSA Annual Contribution Limits ──────────────────────────────────────────

export const TFSA_ANNUAL_LIMITS: Record<number, number> = {
  2009: 5000, 2010: 5000, 2011: 5000, 2012: 5000, 2013: 5500,
  2014: 5500, 2015: 10000, 2016: 5500, 2017: 5500, 2018: 5500,
  2019: 6000, 2020: 6000, 2021: 6000, 2022: 6000, 2023: 6500,
  2024: 7000, 2025: 7000, 2026: 7000,
};

/** Cumulative TFSA room for someone born in birthYear, from the year they turned 18 (or 2009) up to currentYear */
export function tfsaCumulativeRoom(birthYear: number, currentYear = new Date().getFullYear()): number {
  const eligible = Math.max(birthYear + 18, 2009);
  let total = 0;
  for (let yr = eligible; yr <= currentYear; yr++) {
    total += TFSA_ANNUAL_LIMITS[yr] ?? 7000;
  }
  return total;
}

// ─── RRSP ─────────────────────────────────────────────────────────────────────

export const RRSP_MAX_BY_YEAR: Record<number, number> = {
  2020: 27830, 2021: 27830, 2022: 29210, 2023: 30780,
  2024: 31560, 2025: 32490, 2026: 33810,
};

/** New RRSP room earned this year = 18% of prior-year income, capped at annual max */
export function rrspNewRoom(priorYearIncome: number, year = new Date().getFullYear()): number {
  const max = RRSP_MAX_BY_YEAR[year] ?? 32490;
  return Math.min(priorYearIncome * 0.18, max);
}

// ─── FHSA ─────────────────────────────────────────────────────────────────────

export const FHSA_ANNUAL_LIMIT = 8000;
export const FHSA_LIFETIME_LIMIT = 40000;
export const FHSA_FIRST_YEAR = 2023; // FHSA launched April 2023

/** Total FHSA room earned from year opened to current year, capped at lifetime limit */
export function fhsaCumulativeRoom(yearOpened: number, currentYear = new Date().getFullYear()): number {
  const from = Math.max(yearOpened, FHSA_FIRST_YEAR);
  const years = currentYear - from + 1;
  return Math.min(Math.max(years, 0) * FHSA_ANNUAL_LIMIT, FHSA_LIFETIME_LIMIT);
}

// ─── Canadian Provinces ───────────────────────────────────────────────────────

export const PROVINCES: { code: string; name: string }[] = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland & Labrador" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
];

// ─── Tax Brackets (2025) ──────────────────────────────────────────────────────

type Bracket = [number, number]; // [rate, upTo]

const FEDERAL_BRACKETS: Bracket[] = [
  [0.15, 57375], [0.205, 114750], [0.26, 158519], [0.29, 220000], [0.33, Infinity],
];

const PROVINCIAL_BRACKETS: Record<string, Bracket[]> = {
  AB: [[0.10, 148269], [0.12, 177922], [0.13, 237230], [0.14, 355845], [0.15, Infinity]],
  BC: [[0.0506, 45654], [0.077, 91310], [0.105, 104835], [0.1229, 127299], [0.147, 172602], [0.168, 240716], [0.205, Infinity]],
  MB: [[0.108, 36842], [0.1275, 79625], [0.174, Infinity]],
  NB: [[0.094, 47715], [0.14, 95431], [0.16, 176756], [0.195, Infinity]],
  NL: [[0.087, 43198], [0.145, 86395], [0.158, 154244], [0.178, 215943], [0.198, 275870], [0.208, 551739], [0.213, Infinity]],
  NS: [[0.0879, 29590], [0.1495, 59180], [0.1667, 93000], [0.175, 150000], [0.21, Infinity]],
  NT: [[0.059, 50597], [0.086, 101198], [0.122, 164525], [0.1405, Infinity]],
  NU: [[0.04, 53268], [0.07, 106537], [0.09, 173205], [0.115, Infinity]],
  ON: [[0.0505, 51446], [0.0915, 102894], [0.1116, 150000], [0.1216, 220000], [0.1316, Infinity]],
  PE: [[0.096, 32656], [0.1337, 64313], [0.167, 105000], [0.18, 140000], [0.187, Infinity]],
  QC: [[0.14, 51780], [0.19, 103545], [0.24, 126000], [0.2575, Infinity]],
  SK: [[0.105, 49720], [0.125, 142058], [0.145, Infinity]],
  YT: [[0.064, 55867], [0.09, 111733], [0.109, 154906], [0.128, 500000], [0.15, Infinity]],
};

function calcBracketTax(income: number, brackets: Bracket[]): number {
  let tax = 0;
  let prev = 0;
  for (const [rate, limit] of brackets) {
    if (income <= prev) break;
    tax += (Math.min(income, limit) - prev) * rate;
    prev = limit;
  }
  return tax;
}

function marginalRate(income: number, brackets: Bracket[]): number {
  let prev = 0;
  let rate = brackets[0][0];
  for (const [r, limit] of brackets) {
    if (income > prev) rate = r;
    prev = limit;
  }
  return rate;
}

export interface TaxEstimate {
  federalTax: number;
  provincialTax: number;
  totalTax: number;
  marginalFederal: number;
  marginalProvincial: number;
  marginalCombined: number;
  effectiveRate: number;
}

export function estimateTax(income: number, province: string): TaxEstimate {
  const provBrackets = PROVINCIAL_BRACKETS[province] ?? PROVINCIAL_BRACKETS.ON;
  const federalTax = calcBracketTax(income, FEDERAL_BRACKETS);
  const provincialTax = calcBracketTax(income, provBrackets);
  const totalTax = federalTax + provincialTax;
  const marginalFederal = marginalRate(income, FEDERAL_BRACKETS);
  const marginalProvincial = marginalRate(income, provBrackets);
  return {
    federalTax,
    provincialTax,
    totalTax,
    marginalFederal,
    marginalProvincial,
    marginalCombined: marginalFederal + marginalProvincial,
    effectiveRate: income > 0 ? totalTax / income : 0,
  };
}

// ─── Tax Profile ──────────────────────────────────────────────────────────────

export interface TaxProfile {
  province: string;
  birthYear: number;
  rrspAvailableRoom: number;    // From their NOA — most recent unused room
  fhsaYearOpened: number | null; // null if no FHSA
}

export const DEFAULT_TAX_PROFILE: TaxProfile = {
  province: "ON",
  birthYear: 1990,
  rrspAvailableRoom: 0,
  fhsaYearOpened: null,
};
