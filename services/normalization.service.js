import { normalizeCurrency, normalizeNumber, normalizePercentage, normalizeUnit } from "../utils/normalizeUnits.js";
import { normalizeDatePeriod } from "../utils/normalizeDates.js";

const predicateAliases = [
  [/^(sales revenue|total revenue|net sales)$/i, "revenue"],
  [/^(gross profit)$/i, "gross_profit"],
  [/^(net income|net earnings)$/i, "net_income"],
  [/^(operating income)$/i, "operating_income"],
  [/^(growth rate|growth)$/i, "growth"],
];

const normalizeText = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeSubject = (subject) => {
  const normalized = normalizeText(subject);
  if (["the company", "company", "the group"].includes(normalized)) return "company";
  return normalized.replace(/\b(incorporated|inc|corp|corporation|ltd|limited|plc)\b/g, "").replace(/\s+/g, " ").trim();
};

const normalizePredicate = (predicate) => {
  const normalized = normalizeText(predicate);
  const alias = predicateAliases.find(([pattern]) => pattern.test(normalized));
  return alias ? alias[1] : normalized.replace(/\s+/g, "_");
};

const normalizeScope = (scope) => {
  const normalized = normalizeText(scope);
  const aliases = {
    worldwide: "global",
    international: "global",
    "north america": "north_america",
    "united states": "us",
    "u s": "us",
    consolidated: "consolidated",
  };
  return aliases[normalized] || normalized || null;
};

const normalizeFact = (fact) => {
  const rawValue = fact.rawValue ?? fact.value;
  const rawUnit = fact.rawUnit ?? fact.unit;
  const rawCurrency = fact.rawCurrency ?? fact.currency;
  const rawPeriod = fact.rawPeriod ?? fact.period;
  const rawScope = fact.rawScope ?? fact.scope;
  const normalizedSubject = normalizeSubject(fact.rawSubject ?? fact.subject);
  const normalizedPredicate = normalizePredicate(fact.rawPredicate ?? fact.predicate);
  const normalizedCurrency = normalizeCurrency(rawCurrency, `${rawValue} ${rawUnit} ${fact.sourceText || ""}`);
  const numeric = normalizeNumber(rawValue, rawUnit);
  const normalizedPercentage = normalizePercentage(rawValue, rawUnit, normalizedPredicate, fact.valueType);
  const normalizedPeriod = normalizeDatePeriod(rawPeriod);

  return {
    ...fact,
    rawSubject: fact.rawSubject ?? fact.subject,
    rawPredicate: fact.rawPredicate ?? fact.predicate,
    rawValue,
    rawUnit,
    rawCurrency,
    rawPeriod,
    rawScope,
    normalizedSubject,
    normalizedPredicate,
    normalizedObject: typeof fact.object === "string" ? normalizeText(fact.object) : fact.object ?? null,
    normalizedValue: normalizedPercentage === null ? numeric?.value ?? null : normalizedPercentage,
    normalizedPercentage,
    normalizedUnit: normalizeUnit(rawUnit, rawValue),
    normalizedCurrency,
    normalizedScope: normalizeScope(rawScope),
    periodType: normalizedPeriod.periodType,
    periodStart: normalizedPeriod.periodStart ?? fact.periodStart ?? null,
    periodEnd: normalizedPeriod.periodEnd ?? fact.periodEnd ?? null,
    normalizedPeriodStart: normalizedPeriod.periodStart,
    normalizedPeriodEnd: normalizedPeriod.periodEnd,
    periodLabel: normalizedPeriod.periodLabel,
  };
};

export { normalizeFact, normalizePredicate, normalizeScope, normalizeSubject };