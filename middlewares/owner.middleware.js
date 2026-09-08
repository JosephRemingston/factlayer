import { DEFAULT_OWNER } from "../utils/constants.js";

// A workspace name is the only identity in this prototype: it separates one tester's documents from
// another's. It is not authentication and grants no privileges; anyone who knows a name can open it.
const normalizeOwner = (value) => {
  const owner = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
  return /^[a-z0-9][a-z0-9 ._-]*$/.test(owner) ? owner : null;
};

const resolveOwner = (req, res, next) => {
  req.owner = normalizeOwner(req.get("x-factlayer-user") || req.query.workspace) || DEFAULT_OWNER;
  next();
};

export { resolveOwner, normalizeOwner };
