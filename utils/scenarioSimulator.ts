export type ScenarioType = "job_loss" | "salary_increase" | "home_purchase" | "baby" | "custom";

export interface ScenarioParams {
  type: ScenarioType;
  label: string;
  monthlyIncomeChange: number;   // positive = increase, negative = decrease
  monthlyExpenseChange: number;  // positive = increase, negative = decrease
  oneTimeCost: number;           // immediate one-time cost (positive = expense)
  durationMonths: number;        // how long the income/expense change lasts
}

export interface ScenarioPoint {
  date: Date;
  baseline: number;
  scenario: number;
}

export interface SimulationResult {
  points: ScenarioPoint[];
  netImpact: number;          // scenario minus baseline at end of projection
  breakEvenMonths: number | null; // months until scenario value catches up to baseline
  lowestPoint: number;        // lowest scenario net worth during period
}

export interface SavedScenario {
  id: string;
  label: string;
  type: ScenarioType;
  params: ScenarioParams;
  netImpact: number;
  createdAt: string;
}

// ─── Preset Templates ─────────────────────────────────────────────────────────

export function getPresets(monthlyIncome: number, monthlyExpenses: number): ScenarioParams[] {
  return [
    {
      type: "job_loss",
      label: "Job Loss",
      monthlyIncomeChange: -Math.abs(monthlyIncome),
      monthlyExpenseChange: 0,
      oneTimeCost: 0,
      durationMonths: 6,
    },
    {
      type: "salary_increase",
      label: "Raise / Promotion",
      monthlyIncomeChange: Math.round(monthlyIncome * 0.2),
      monthlyExpenseChange: 0,
      oneTimeCost: 0,
      durationMonths: 60,
    },
    {
      type: "home_purchase",
      label: "Buy a Home",
      monthlyIncomeChange: 0,
      monthlyExpenseChange: Math.round(monthlyExpenses * 0.3),
      oneTimeCost: 50000,
      durationMonths: 360,
    },
    {
      type: "baby",
      label: "New Baby",
      monthlyIncomeChange: -Math.round(monthlyIncome * 0.25),
      monthlyExpenseChange: 2500,
      oneTimeCost: 5000,
      durationMonths: 18,
    },
    {
      type: "custom",
      label: "Custom",
      monthlyIncomeChange: 0,
      monthlyExpenseChange: 0,
      oneTimeCost: 0,
      durationMonths: 12,
    },
  ];
}

export const SCENARIO_ICONS: Record<ScenarioType, string> = {
  job_loss: "briefcase-outline",
  salary_increase: "trending-up-outline",
  home_purchase: "home-outline",
  baby: "heart-outline",
  custom: "create-outline",
};

// ─── Simulation Engine ────────────────────────────────────────────────────────

const PROJECTION_MONTHS = 36;

export function runSimulation(
  currentNetWorth: number,
  monthlySavings: number,
  params: ScenarioParams,
): SimulationResult {
  const months = Math.max(PROJECTION_MONTHS, params.durationMonths + 12);
  const now = new Date();
  const points: ScenarioPoint[] = [];

  let baseline = currentNetWorth;
  let scenario = currentNetWorth - params.oneTimeCost;
  let lowestPoint = scenario;
  let breakEvenMonths: number | null = null;

  for (let i = 0; i <= months; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    points.push({ date, baseline, scenario });

    if (i > 0 && breakEvenMonths === null && scenario >= baseline) {
      breakEvenMonths = i;
    }
    lowestPoint = Math.min(lowestPoint, scenario);

    baseline += monthlySavings;
    const inScenario = i < params.durationMonths;
    const scenarioSavings = monthlySavings
      + (inScenario ? params.monthlyIncomeChange - params.monthlyExpenseChange : 0);
    scenario += scenarioSavings;
  }

  return {
    points,
    netImpact: scenario - baseline,
    breakEvenMonths,
    lowestPoint,
  };
}
