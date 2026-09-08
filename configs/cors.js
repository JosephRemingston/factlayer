// Browsers may call the API from localhost during development and from any Vercel deployment of the
// frontend, including preview URLs, which get a fresh subdomain per commit. Extra origins can be
// listed in ALLOWED_ORIGINS (comma separated); "*" disables the check entirely.
const STATIC_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https?:\/\/\[::1\](:\d+)?$/i,
  // any vercel.app deployment, including project-git-branch-team.vercel.app preview URLs
  /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i,
  // ngrok tunnels used while demoing a local backend
  /^https:\/\/([a-z0-9-]+\.)*ngrok(-free)?\.(app|io|dev)$/i,
];

const configuredOrigins = () => String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // same-origin, curl, or server-to-server
  const allowed = configuredOrigins();
  if (allowed.includes("*")) return true;
  if (allowed.includes(origin)) return true;
  return STATIC_PATTERNS.some((pattern) => pattern.test(origin));
};

const corsOptions = {
  origin: "*",
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-factlayer-user", "ngrok-skip-browser-warning" , "Access-Control-Allow-Origin"],
  exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
  maxAge: 86400,
};

export { corsOptions, isAllowedOrigin };
