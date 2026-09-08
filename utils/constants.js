// How long a provider is parked after reporting a rate limit, when it suggests no delay itself.
export const PROVIDER_COOLDOWN_MS = 45000;
export const DEFAULT_OWNER = "demo";
// Large enough that a typical PDF page (about 3,000 characters) is a single chunk; only very long pages split.
export const MAX_CHUNK_CHARACTERS = 8000;
// Chunks shorter than this with no digits are boilerplate (cover pages, separators) and skip extraction.
export const MIN_EXTRACTION_CHARACTERS = 200;
export const FACT_SIMILARITY_THRESHOLD = 0.78;
// Pairs at or above this similarity whose subject/predicate strings differ are sent to the LLM adjudicator.
export const FACT_ADJUDICATION_SIMILARITY = 0.82;
export const FACT_ADJUDICATION_BATCH_SIZE = 20;
export const MAX_ADJUDICATION_PAIRS_PER_DOCUMENT = 400;
export const MATCH_CONFIDENCE_THRESHOLD = 0.6;
export const FACT_COMPATIBILITY_THRESHOLD = 0.75;
export const FACT_MATCH_TOP_K = 20;
export const FACT_VALUE_TOLERANCE = 0.01;
export const FACT_PERCENTAGE_TOLERANCE = 0.01;
// Page-sized chunks are ~2,000 tokens each, so batches are capped by estimated tokens rather than
// by count: 64 page-chunks in one request would be ~128k tokens and blow the provider's per-minute cap.
export const EMBEDDING_BATCH_SIZE = 64;
export const EMBEDDING_BATCH_TOKEN_BUDGET = 40000;
// Process-wide ceiling on embedding tokens per minute, kept under the provider limit for headroom.
export const EMBEDDING_TOKENS_PER_MINUTE = 200000;
export const PINECONE_DELETE_BATCH_SIZE = 1000;
// A processing lease is considered abandoned when its heartbeat is older than this.
export const PROCESSING_LEASE_MS = 120000;
export const PROCESSING_HEARTBEAT_MS = 30000;
