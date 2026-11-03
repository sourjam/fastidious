import type { FastingStage } from "./types";

// Health-related copy from the design handoff lives only here.
export const FASTING_STAGES: readonly FastingStage[] = [
  {
    thresholdHours: 0,
    name: "Fed",
    shortName: "Fed",
    description: "Digesting your last meal. Blood sugar and insulin are elevated.",
  },
  {
    thresholdHours: 4,
    name: "Post-absorptive",
    shortName: "Settle",
    description: "Blood sugar settles and the body starts drawing on stored glycogen.",
  },
  {
    thresholdHours: 12,
    name: "Fat burning",
    shortName: "Burn",
    description: "Glycogen is running low and fat becomes the main fuel source.",
  },
  {
    thresholdHours: 18,
    name: "Ketosis",
    shortName: "Keto",
    description: "The liver is producing ketones from fat at a meaningful rate.",
  },
  {
    thresholdHours: 24,
    name: "Autophagy",
    shortName: "Auto",
    description: "Cellular cleanup processes are thought to ramp up around here.",
  },
  {
    thresholdHours: 48,
    name: "Deep ketosis",
    shortName: "Deep",
    description: "Ketone levels keep climbing. Hunger often eases.",
  },
  {
    thresholdHours: 72,
    name: "Extended",
    shortName: "Ext",
    description: "Fasts this long are best done with medical guidance.",
  },
];
