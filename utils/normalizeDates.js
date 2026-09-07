const dateFromParts = (year, month, day) => new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

const endOfMonth = (year, month) => new Date(Date.UTC(Number(year), Number(month), 0));

const normalizeDatePeriod = (period) => {
  const text = String(period || "").trim();
  const lower = text.toLowerCase();
  if (!text) return { periodType: null, periodStart: null, periodEnd: null, periodLabel: null };

  let match = lower.match(/\bq([1-4])\s*(?:fy|fiscal year)?\s*(\d{4})\b|\b(\d{4})\s*q([1-4])\b/);
  if (match) {
    const quarter = Number(match[1] || match[4]);
    const year = Number(match[2] || match[3]);
    const startMonth = (quarter - 1) * 3 + 1;
    return {
      periodType: lower.includes("fy") || lower.includes("fiscal") ? "fiscalQuarter" : "quarter",
      periodStart: dateFromParts(year, startMonth, 1),
      periodEnd: endOfMonth(year, startMonth + 2),
      periodLabel: `Q${quarter} ${year}`,
    };
  }

  match = lower.match(/(?:fy|fiscal year)\s*(\d{4})|\b(\d{4})\s*fiscal year\b/);
  if (match) {
    const year = Number(match[1] || match[2]);
    return {
      periodType: "fiscalYear",
      periodStart: dateFromParts(year, 1, 1),
      periodEnd: dateFromParts(year, 12, 31),
      periodLabel: `FY${year}`,
    };
  }

  match = lower.match(/year ended .*?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const month = new Date(`${match[1]} 1, 2000`).getMonth() + 1;
    const end = dateFromParts(match[3], month, match[2]);
    return { periodType: "date", periodStart: dateFromParts(match[3], 1, 1), periodEnd: end, periodLabel: text };
  }

  match = lower.match(/\b(\d{4})\b/);
  if (match && lower.length <= 12) {
    const year = Number(match[1]);
    return { periodType: "year", periodStart: dateFromParts(year, 1, 1), periodEnd: dateFromParts(year, 12, 31), periodLabel: String(year) };
  }

  match = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (match) {
    const date = dateFromParts(match[3], match[2], match[1]);
    return { periodType: "date", periodStart: date, periodEnd: date, periodLabel: text };
  }

  return { periodType: "text", periodStart: null, periodEnd: null, periodLabel: text };
};

export { normalizeDatePeriod };