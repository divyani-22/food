// Public API of the pure engines (safe to import from server and client).
export {
  ETHYLENE_TABLE,
  analyzeEthyleneStorage,
  ethyleneProfile,
  canonicalProduceKey,
} from "./ethylene";
export type {
  EthyleneLevel,
  EthyleneSeverity,
  EthyleneAlertKind,
  EthyleneProfile,
  EthyleneItemInput,
  EthyleneAlert,
  StorageSpace,
} from "./ethylene";

export {
  HEALTH_DISCLAIMER,
  FSA_THRESHOLDS,
  evaluateHealthAlerts,
  findHardConflicts,
  describeDietaryConstraints,
  detectConditions,
  detectMedications,
} from "./healthRules";
export type {
  HealthAlert,
  HealthSeverity,
  HealthAppliesToKind,
  HealthInput,
  HealthIngredient,
  HealthNutriments,
  HealthMedicationInput,
} from "./healthRules";

export {
  MAX_RECIPE_MINUTES,
  INSPECTION_NOTE,
  RESCUE_SAFETY_NOTE,
  selectRescueItems,
  buildRescuePrompt,
  parseRescueRecipes,
  sanitizeRecipe,
  sanitizeRecipeDetailed,
  fallbackRescueRecipes,
  processRescueResponse,
  canonicalRescueItem,
} from "./rescue";
export type {
  RescueInputItem,
  RescueItem,
  RescueSelection,
  RescueOptions,
  RescueRecipe,
  ParsedRecipe,
  RescueContext,
  RescuePrompt,
  RescueResult,
  RescueDietType,
} from "./rescue";
