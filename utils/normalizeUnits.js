const magnitudeMap = {
  k: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  "000": 1e3,
  m: 1e6,
  mn: 1e6,
  mm: 1e6,
  million: 1e6,
  millions: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  billions: 1e9,
  t: 1e12,
  tn: 1e12,
  trillion: 1e12,
  trillions: 1e12,
};

const currencyAliases = {
  "$": "USD",
  "us$": "USD",
  usd: "USD",
  "us dollar": "USD",
  "us dollars": "USD",
  "u.s. dollar": "USD",
  "u.s. dollars": "USD",
  "€": "EUR",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  "£": "GBP",
  gbp: "GBP",
  "pound sterling": "GBP",
  "pounds sterling": "GBP",
  "¥": "JPY",
  jpy: "JPY",
  yen: "JPY",
  inr: "INR",
  "₹": "INR",
  rupee: "INR",
  rupees: "INR",
  cad: "CAD",
  "canadian dollar": "CAD",
  aud: "AUD",
  "australian dollar": "AUD",
};

const numberWords = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const parseNumberWords = (value) => {
  const words = String(value).toLowerCase().replace(/-/g, " ").split(/\s+/);
  if (!words.length || words.some((word) => numberWords[word] === undefined)) return null;
  return words.reduce((total, word) => total + numberWords[word], 0);
};

const normalizeCurrency = (value, context = "") => {
  const text = `${value || ""} ${context || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  const orderedAliases = Object.keys(currencyAliases).sort((left, right) => right.length - left.length);
  for (const alias of orderedAliases) {
    if (text.includes(alias)) return currencyAliases[alias];
  }
  return null;
};

const findMagnitude = (value) => {
  const text = String(value || "").toLowerCase();
  const aliases = Object.keys(magnitudeMap).sort((left, right) => right.length - left.length);
  const alias = aliases.find((candidate) => new RegExp(`(?:^|\\s|[0-9])${candidate}(?:$|\\s|[,.])`, "i").test(text));
  return alias ? { label: alias, multiplier: magnitudeMap[alias] } : { label: null, multiplier: 1 };
};

const normalizeNumber = (value, unit = "") => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const magnitude = findMagnitude(unit);
    return { value: value * magnitude.multiplier, magnitude: magnitude.label };
  }

  const text = String(value).trim();
  const numericMatch = text.replace(/,/g, "").match(/[-+]?\d*\.?\d+/);
  const parsed = numericMatch ? Number(numericMatch[0]) : parseNumberWords(text.replace(/\b(percent|percentage)\b/gi, "").trim());
  if (!Number.isFinite(parsed)) return null;
  const magnitude = findMagnitude(`${text} ${unit}`);
  return { value: parsed * magnitude.multiplier, magnitude: magnitude.label };
};

const normalizePercentage = (value, unit = "", predicate = "", valueType = "") => {
  const rawText = `${value ?? ""} ${unit ?? ""}`.toLowerCase();
  const isPercentage = /%|percent|percentage/.test(rawText)
    || /growth|margin|rate|share|比例|ratio/.test(String(predicate).toLowerCase())
    || String(valueType).toLowerCase() === "percentage"
    || (!predicate && typeof value === "number" && value >= 0 && value <= 1);
  if (!isPercentage) return null;
  const parsed = normalizeNumber(value, unit);
  if (!parsed) return null;
  return parsed.value > 1 ? parsed.value / 100 : parsed.value;
};

const normalizeUnit = (unit, value = "") => {
  const text = `${unit || ""} ${value || ""}`.toLowerCase();
  if (/%|percent|percentage/.test(text)) return "percent";
  if (normalizeCurrency(unit, value)) return "currency";
  const magnitude = findMagnitude(unit);
  if (magnitude.label) return null;
  return String(unit || "").trim().toLowerCase() || null;
};

export { normalizeCurrency, normalizeNumber, normalizePercentage, normalizeUnit };