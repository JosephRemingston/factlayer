# FactLayer

**A fact knowledge layer for PDFs.** Upload documents, and FactLayer extracts the facts inside them, keeps every fact tied to the exact page and sentence it came from, matches facts across documents, and explains whether they corroborate, contradict, or merely differ in context. Ask a question and get an answer with citations.

Built for the Superjoin engineering intern assignment. Backend in this repo; the React frontend lives in [`../factlayer_frontend`](../factlayer_frontend).

| | |
|---|---|
| **Stack** | Node.js 20 · Express 5 · MongoDB (Mongoose) · Pinecone (vectors + hosted embeddings) · AWS S3 · MiniMax-M3 · React (TanStack Start) |
| **Tests** | `npm test` — 53 unit tests covering chunking, grounding, normalization, comparison, adjudication, reconciliation, workspaces, provider failover, rate limits, CORS, PDF runtime portability |
| **Video demo** | _Add link here_ |
| **Live docs** | [API reference](API.md) · [System design](docs/system-design.svg) · [API design](docs/api-design.svg) |

---

## What it does

1. **Extracts grounded facts.** Each page goes to the model with a strict schema. Every returned fact must quote a span that actually exists on that page, or it is rejected and logged as evidence of the failure.
2. **Links facts across documents.** Facts are embedded by identity ("Delhivery | revenue | FY24 | consolidated"), matched across documents, and classified by deterministic rules: `corroborated`, `contradiction`, `contextual_difference`, or `uncertain`. Near-miss wording ("the company" vs "Delhivery", "revenue from operations" vs "revenue from services") is settled by an LLM adjudicator before the rules run.
3. **Answers with proof.** `POST /api/ask` returns a short answer where every claim carries a `[S#]` citation resolving to the document name, page number, and verbatim quote, and points out when sources disagree.
4. **Shows its work.** `GET /api/showcase` and the `/cases` page surface the best real example of each assignment case, including the extraction failures the pipeline caught and how it handled them.

---

## Workspaces

Anyone opening the app enters a name, and everything they upload lives under it. Close the tab, come back later, even from another browser, enter the same name and the documents, facts and relationships are exactly as they were. The name travels on every request as `x-factlayer-user`; documents, facts, relationships, extraction issues and Pinecone namespaces are all scoped by it, so one person's documents never appear in another's search, answers or cases.

It is deliberately not a login. There is no password, and anyone entering the same name opens that workspace; the sign-in screen says so. It exists so a reviewer can pick up where they left off, not to protect data. Requests with no name land in the `demo` workspace, which holds the sample documents.

---

## The four cases

The assignment asks for one example of each. FactLayer selects them automatically from whatever documents are loaded, so they are real, not hand-picked.

| # | Case | How FactLayer produces it | Where to see it |
|---|---|---|---|
| 1 | **Corroborated across documents, expressed differently** | Fact-identity embeddings find the pair, the adjudicator confirms the wording means the same metric, reconciliation finds values within 1 percent tolerance. | `/cases` → case 1, `GET /api/showcase` |
| 2 | **Genuine or likely contradiction** | Same subject, metric, and period; scope not contradicted; values differ beyond tolerance. Descriptive facts (a name, a status) contradict when their objects differ. | `/cases` → case 2 |
| 3 | **Apparent contradiction explained by context** | Same metric, but period, scope, unit, or currency differs. Classified `contextual_difference` with the difference named, never as a contradiction. | `/cases` → case 3 |
| 4 | **Extraction or reasoning failure, and its handling** | Every rejected candidate (evidence not on the page, missing value, bad confidence), every malformed JSON reply that had to be re-requested, and every skipped page is stored in `extractionissues` with the reason and the handling applied. | `/cases` → case 4, `extractionFailures` in `/api/showcase` |

Each case shows both facts with document, page, value, period, scope, the quoted evidence, and the system's reasoning: comparison signals, key similarities, key differences, and any adjudicator note.

---

## System design

![System design](docs/system-design.svg)

**One process.** The Express API stores the PDF in S3, records it in MongoDB, and starts processing in the same process from the uploaded bytes. The upload call returns immediately; the frontend polls `GET /api/documents/:id`, which reports stage, percentage, pages processed, facts so far, and an ETA.

**The pipeline**, per document:

| Stage | What happens | Why it is built this way |
|---|---|---|
| Parse and chunk | `pdf-parse` yields one record per page; a page is one chunk unless it exceeds 8,000 characters. Short pages with no digits are skipped. | Page-level chunks keep evidence page-accurate and cut model calls by two thirds versus paragraph chunks. |
| Embed chunks | Pinecone-hosted `llama-text-embed-v2`, 1024 dimensions. Batches are sized by estimated tokens, and a process-wide limiter holds total spend under the provider's per-minute cap. | No separate embedding vendor or quota. Page-sized chunks are large, so a fixed batch count would exceed the cap once two documents ran at once. |
| Primary entity | One model call on the opening pages identifies the organization the document is about. | Lets "the company", "we", and "the group" resolve to a real subject that can match across documents. |
| Extract facts | 12 pages in parallel in JSON mode with a fixed schema; a rate-limited provider hands the page to the other one and a call waits rather than dropping the page, malformed JSON is re-requested once. | Facts persist per page, so an interrupted run resumes instead of restarting. Two providers let the pool run wider without stalling. |
| Ground and validate | The quoted `sourceText` must exist on the page, ignoring punctuation, quote style, hyphenation, and number spacing. Facts need a value or an object. | Invented evidence never enters the store; rejections become case-4 evidence. |
| Normalize | Subjects, predicates, magnitudes (crore, million, bn), currencies, percentages, fiscal periods, and scopes get canonical forms while raw values are kept. | Comparison works on canonical fields; the UI still shows the original wording. |
| Match | Each fact's identity string is embedded and queried against other documents' facts, 8 queries in parallel; skipped entirely when no other document has facts. | Identity embeddings match "what is being measured", not sentence style. |
| Adjudicate | Pairs with similarity ≥ 0.82 whose subject or metric strings differ are sent to the model in batches of 20 with a yes/no question. | Cheap way to bridge wording differences without loosening the deterministic rules. |
| Reconcile and explain | Rules over period, scope, unit, currency, and value tolerance produce the classification, a reason, signals, and key similarities and differences. | Deterministic and inspectable; the model never decides the final label. |

**Reliability.** Each document carries a processing lease with a heartbeat, so two server instances never process the same document. Interrupted documents resume on startup from their last finished page. `POST /api/documents/:id/reprocess` resumes a failed document, or restarts it with `?reset=true`.

---

## Providers and limits

Every model call, whether extraction, entity detection, adjudication or answering, goes through one provider layer. MiniMax-M3 is preferred and Gemini 2.5 Flash is the fallback, either configurable. When a provider reports a rate limit it is parked for the delay it suggests and the same request continues on the other provider; because a call is one page or one batch, the switch resumes exactly where the first provider stopped. The preferred provider is used again as soon as its cooldown expires, and if both are parked the call waits for the first to free up. `GET /api/providers` shows the current state, and each fact records the model that produced it.

The endpoints that cost a model call are rate limited per workspace: 10 questions and 10 uploads per minute, with `Retry-After` and `X-RateLimit-*` headers on every response. One tester cannot exhaust the shared providers for everyone else.

---

## API design

![API design](docs/api-design.svg)

All `/api` requests carry the workspace name in the `x-factlayer-user` header.

| Endpoint | Purpose |
|---|---|
| `POST /api/documents/upload` | Upload 1 to 20 PDFs in the `document` field; each starts processing at once |
| `GET /api/documents` · `GET /api/documents/:id` | List documents, or one document with its `progress` object |
| `POST /api/documents/:id/reprocess` | Resume unfinished pages, or `?reset=true` to start over |
| `GET /api/facts/document/:id` · `GET /api/facts/:id` | Facts with evidence links |
| `GET /api/facts/search?q=` · `GET /api/search/chunks?q=` | Semantic search over facts or passages |
| `GET /api/relationships/document/:id` · `GET /api/relationships/:id` | Classified relationships with reasoning |
| `POST /api/ask` | Cited answer across all documents (rate limited) |
| `GET /api/providers` | Provider availability and cooldowns |
| `GET /api/showcase` | The four cases with evidence |
| `GET /api/documents/:id/pages` · `/chunks` · `GET /api/pages/:id` · `GET /api/chunks/:id` | Evidence text |
| `GET /health` | Liveness |

Every response uses `{ statusCode, message, data, success }`. Full request and response shapes, including the `progress` object and the answer citation format, are in [API.md](API.md).

---

## Data model

| Collection | Holds | Evidence fields |
|---|---|---|
| `documents` | Workspace owner, file metadata, status, stage, progress counters, primary entity, processing lease | `s3Key` |
| `pages` | Page number and text | `documentId` |
| `chunks` | Page-sized text, extraction status, fact count, vector id | `documentId`, `pageId`, `pageNumber` |
| `facts` | Raw and normalized subject, predicate, value, unit, currency, period, scope; confidence; identity string for matching | `documentId`, `pageId`, `chunkId`, `pageNumber`, `sourceText` |
| `relationships` | Pair of facts, classification, similarity and matching scores, comparison signals, reason, summary, key similarities and differences | Evidence entry for each fact |
| `extractionissues` | Type, message, the rejected candidate or malformed output preview, and the handling applied | `documentId`, `chunkId`, `pageNumber` |

MongoDB is the source of truth; Pinecone holds chunk vectors (namespace `chunks__<workspace>`) and fact-identity vectors (namespace `facts__<workspace>`) and is only used to find candidates that are then hydrated from MongoDB.

---

## Engineering decisions and trade-offs

- **In-process background work instead of a queue.** The project started with BullMQ and Redis. Removing them simplified running and debugging, and the per-document lease plus resumable stages preserved the two things the queue was providing: no double processing and recovery after a crash. A shared queue would return if the API needed to scale across machines.
- **Deterministic classification, model-assisted matching.** The model extracts and adjudicates wording; rules decide corroboration and contradiction. That keeps every label explainable and testable.
- **Evidence is mandatory.** A fact without a verbatim quote on its page is rejected rather than stored with lower confidence. This costs some recall (about 6 percent of candidates on the sample documents) and buys trust in everything that remains.
- **Page-level chunks.** Fewer model calls and exact page citations, at the cost of coarser passage search results.
- **Provider isolation.** Extraction, adjudication, and answering each go through one function in `services/extraction.service.js`; embeddings through one function per provider in `services/embedding.service.js`. Swapping MiniMax for Claude or Gemini, or Pinecone inference for another embedder, is a contained change.
- **Rate limits are a first-class concern.** Retries honour provider-suggested delays, per-minute windows, and burst limits; concurrency is configurable per stage; and a rate-limited provider hands work to the other rather than stalling. Two providers plus a wider pool cut extraction of a 100-page document from about 3.5 minutes to about 2.5. Pushing the pool to 20 was measurably worse: both free tiers were parked at once often enough that a page ran out of failover attempts, so a call now waits within a budget instead of giving up, and the pool sits at 12.

---

## Running locally

**Requirements:** Node.js 20+, MongoDB, an S3 bucket, a Pinecone API key (the index is created automatically), and a MiniMax API key.

```bash
cp .env.example .env   # fill in MONGO_URI, AWS_*, PINECONE_API_KEY, MINIMAX_API_KEY
npm install
npm start              # API + processing on http://localhost:3000
```

`npm run dev` runs the same with file watching. `npm test` runs the unit tests.

Frontend, in the sibling folder:

```bash
cd ../factlayer_frontend
npm install
npm run dev            # http://localhost:8080, API base configurable in the top-right setting
```

Enter a name to open a workspace, upload the three starter PDFs from `data/starter-datasets/delhivery/` in one go, watch the progress bars, and open **Cases** and **Ask**. Come back later with the same name and everything is still there.

**Environment variables** (see `.env.example`):

| Variable | Meaning |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `AWS_REGION`, `AWS_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Original PDF storage |
| `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `PINECONE_NAMESPACE`, `PINECONE_CLOUD`, `PINECONE_REGION` | Vector index; created with `EMBEDDING_DIMENSION` if missing |
| `EMBEDDING_PROVIDER` (`pinecone` or `minimax`), `PINECONE_EMBEDDING_MODEL`, `MINIMAX_EMBEDDING_MODEL`, `EMBEDDING_DIMENSION` | Embedding model and dimension; must match the index |
| `MINIMAX_API_KEY`, `MINIMAX_API_BASE`, `FACT_EXTRACTION_MODEL` | Primary LLM for extraction, adjudication, and answers |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `LLM_PROVIDER` | Fallback LLM used automatically while the primary is rate limited |
| `ASK_RATE_MAX`, `ASK_RATE_WINDOW_MS`, `UPLOAD_RATE_MAX`, `UPLOAD_RATE_WINDOW_MS` | Per-workspace limits on the model-backed endpoints |
| `PROCESSING_CONCURRENCY`, `EXTRACTION_CONCURRENCY`, `MATCHING_CONCURRENCY`, `EXTRACTION_REQUESTS_PER_MINUTE` | Parallelism per stage and optional pacing |

Keep `.env` out of git; it is ignored.

---

## Deploying

**Frontend on Vercel.** `vercel.json` in `../factlayer_frontend` builds with Nitro's Vercel preset and emits `.vercel/output`, which Vercel serves directly. Import the repository, set the project root to the frontend folder, and set one environment variable:

| Variable | Value |
|---|---|
| `VITE_API_BASE` | the public URL of your API, for example `https://factlayer.onrender.com` |

Anyone using the app can still point at a different API through the "Service" control in the header; the variable only sets the default.

**Backend needs a host that keeps a process alive.** Render, Railway, Fly.io, or a small VM all work: provide the environment variables listed above and expose `PORT`. A Docker or Node buildpack deployment needs no extra configuration.

Serverless platforms such as Vercel Functions or AWS Lambda are **not** suitable, for reasons that are structural rather than fixable with configuration:

| What the API does | What serverless does |
|---|---|
| Keeps processing a document for minutes after the upload response is sent | Freezes or kills the instance once the response is returned, so uploads would report success and never finish |
| Runs a single extraction for 3+ minutes on a 100-page PDF | Caps a function at 60 seconds (300 on paid plans) |
| Holds per-document leases, provider cooldowns, rate-limit counters and the embedding token budget in process memory | Starts a fresh instance per request, so every one of those resets and two instances can process the same document |
| Resumes unfinished documents on startup | Cold-starts constantly, which would re-trigger resume repeatedly |

Read-only endpoints would work there; ingestion would not. Moving to serverless would mean a real queue and a separate worker, which is what this project deliberately removed.

Two portability fixes make the API run on any container host, including ones without native build tooling: `utils/pdfPolyfills.js` supplies the browser globals pdfjs touches at load time when the optional `@napi-rs/canvas` binary is absent, and uploads fall back to the system temp directory when the project folder is read-only (`UPLOAD_DIR` overrides both defaults).

CORS is already configured for this split: `localhost`, any `*.vercel.app` deployment including per-commit preview URLs, and ngrok tunnels are accepted, and `ALLOWED_ORIGINS` adds your own domains (`*` disables the check). Look-alike hosts such as `vercel.app.evil.com` are refused.

---

## Testing

`npm test` runs 31 tests with Node's built-in runner and no external services:

- provider failover: switching on a rate limit, skipping a parked provider, recovering when both are limited, and not masking real errors
- rate limiter burst, refusal and per-workspace budgets
- workspace name rules and per-workspace vector namespaces
- identifier values (a company identity number) never compared as numbers
- chunking determinism and page metadata
- evidence grounding, including quote-style, hyphenation, and number-spacing tolerance, and rejection of altered evidence
- unit, currency, percentage, and period normalization, including idempotence
- candidate comparison, self and same-document rejection, value-type compatibility
- adjudicator overrides and descriptive-fact contradictions
- reconciliation outcomes for equal, contradictory, and context-differing facts

End-to-end behaviour was verified by uploading the three starter PDFs against live MongoDB, S3, Pinecone, and MiniMax: 2,812 facts and 790 relationships across the set, with all four cases present.

---

## Limitations and next steps

- **Facts without a stated period** are classified `uncertain` when values differ, because a change over time cannot be told from a contradiction. Inferring periods from nearby headings and document dates is the next improvement.
- **Adjudication is batched but still model-bound.** A per-document alias table for subsidiaries and segments would cut those calls.
- **Passage search returns whole pages** since chunks are page-sized; a secondary paragraph index would sharpen it.
- **Workspaces are names, not accounts.** No password, so they separate testers rather than protect data. Real use would need authentication, and CORS is open.
- **Rate limits still dominate speed.** Failover between two free tiers helps, but at 20 pages in parallel both providers are sometimes parked at once and calls wait. A paid key on either provider would remove that ceiling.
- **Single-process scaling.** Multiple API instances would need a shared queue again; the lease already prevents double processing.

---

## AI tools used

The code was written with Claude Code (Claude Fable 5.1) as a pair programmer for design, implementation, debugging against live services, and documentation. MiniMax-M3 performs fact extraction, adjudication, and answer writing at runtime. Pinecone-hosted `llama-text-embed-v2` produces embeddings.

---

## Project structure

```
index.js                      Express app; resumes interrupted documents on start
routes/ controllers/          documents, facts, relationships, evidence, ask, showcase
services/
  document.service.js         resumable pipeline, lease and heartbeat, progress
  pdf.service.js              page extraction
  chunk.service.js            page-level chunking
  extraction.service.js       MiniMax calls, grounding, validation, adjudication
  normalization.service.js    canonical subjects, predicates, values, periods, scopes
  embedding.service.js        Pinecone index, hosted embeddings, vector queries
  comparison.service.js       candidate matching and adjudication pass
  reconciliation.service.js   classification rules
  explanation.service.js      human-readable reasoning
  answer.service.js           cited answers
  showcase.service.js         the four cases
models/                       Mongoose schemas incl. ExtractionIssue
utils/                        retry with provider-aware backoff, concurrency pool, normalizers
tests/                        node --test suites
docs/                         system-design.svg, api-design.svg
data/starter-datasets/        sample PDFs
```
