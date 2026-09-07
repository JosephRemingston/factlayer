import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFact } from "../services/normalization.service.js";
import { normalizeCurrency, normalizeNumber, normalizePercentage } from "../utils/normalizeUnits.js";
import { normalizeDatePeriod } from "../utils/normalizeDates.js";

const makeFact = (overrides = {}) => normalizeFact({
  subject: "Company",
  predicate: "total revenue",
  object: null,
  value: "$120M",
  valueType: "number",
  unit: null,
  currency: null,
  period: "FY2024",
  scope: "North America",
  sourceText: "Revenue was $120M in FY2024.",
  ...overrides,
});

test("equivalent currency magnitudes normalize identically", () => {
  const facts = [
    makeFact({ value: "$120M" }),
    makeFact({ value: "120 million USD" }),
    makeFact({ value: "USD 120,000,000" }),
  ];
  assert.deepEqual(facts.map((fact) => [fact.normalizedValue, fact.normalizedCurrency, fact.normalizedPredicate]), [
    [120000000, "USD", "revenue"],
    [120000000, "USD", "revenue"],
    [120000000, "USD", "revenue"],
  ]);
});

test("normalizes unit magnitudes and preserves raw values", () => {
  assert.equal(normalizeNumber("1.2 thousand").value, 1200);
  assert.equal(normalizeNumber("1.5M").value, 1500000);
  assert.equal(normalizeNumber(1.5, "million").value, 1500000);
  const fact = makeFact({ value: "1.5M", unit: "USD", currency: "USD" });
  assert.equal(fact.rawValue, "1.5M");
  assert.equal(fact.value, "1.5M");
  assert.equal(fact.normalizedValue, 1500000);
});

test("normalizes currencies and percentages without erasing context", () => {
  assert.equal(normalizeCurrency("US dollars"), "USD");
  assert.equal(normalizeCurrency("$", "Canadian dollars"), "CAD");
  assert.equal(normalizePercentage("25%"), 0.25);
  assert.equal(normalizePercentage("twenty-five percent"), 0.25);
  assert.equal(normalizePercentage(0.25), 0.25);
  assert.equal(normalizePercentage(0.25, null, "", "percentage"), 0.25);
  const growth = makeFact({ predicate: "growth", value: "25%", unit: "%", period: null });
  assert.equal(growth.normalizedValue, 0.25);
  assert.equal(growth.normalizedPercentage, 0.25);
  assert.equal(growth.normalizedPredicate, "growth");
});

test("normalizes fiscal years, quarters, dates, and scopes", () => {
  const fiscalYear = normalizeDatePeriod("fiscal year 2024");
  const quarter = normalizeDatePeriod("Q1 FY2024");
  assert.equal(fiscalYear.periodType, "fiscalYear");
  assert.equal(fiscalYear.periodLabel, "FY2024");
  assert.equal(quarter.periodType, "fiscalQuarter");
  assert.equal(quarter.periodStart.toISOString(), "2024-01-01T00:00:00.000Z");
  assert.equal(quarter.periodEnd.toISOString(), "2024-03-31T00:00:00.000Z");
  const fact = makeFact({ period: "2024 fiscal year", scope: "worldwide" });
  assert.equal(fact.periodType, "fiscalYear");
  assert.equal(fact.periodLabel, "FY2024");
  assert.equal(fact.periodStart.toISOString(), "2024-01-01T00:00:00.000Z");
  assert.equal(fact.periodEnd.toISOString(), "2024-12-31T00:00:00.000Z");
  assert.equal(fact.normalizedScope, "global");
});

test("normalization is idempotent", () => {
  const once = makeFact();
  const twice = normalizeFact(once);
  assert.equal(twice.rawValue, "$120M");
  assert.equal(twice.normalizedValue, once.normalizedValue);
  assert.equal(twice.normalizedCurrency, once.normalizedCurrency);
  assert.equal(twice.periodLabel, once.periodLabel);
});