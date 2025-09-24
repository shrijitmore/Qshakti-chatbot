# Q-shakti Backend

This folder contains the Node/Express backend that powers the Q-shakti demo. It exposes endpoints to:

- Ingest your textual/JSON documents into an in-memory vector store
- Answer questions against the retrieved context (RAG)
- Optionally return a chart (PNG or a Chart.js JSON spec rendered on the client)

The UI at `http://localhost:3001` is served from `backend/public/` and calls these endpoints.

---

## Getting Started

- Requirements
  - Node 18+
  - npm

- Install
  ```bash
  npm install
  ```

- Configure
  - Copy `.env.example` to `.env`
  - Set `GOOGLE_API_KEY` if you want to use Gemini. If left blank, the backend will fall back to a simple heuristic answer. The system also handles Gemini quota/rate-limit by returning a deterministic fallback summary.

- Run (dev)
  ```bash
  npm run dev
  ```
  The server listens on `http://localhost:3001`.

- Open the demo UI
  - Navigate to `http://localhost:3001`

---

## Project Structure (backend)

- `src/index.ts` – Express app setup, static hosting of `public/`, route mounting.
- `src/routes/ingest.ts` – Ingestion endpoint.
- `src/routes/query.ts` – Main query endpoint (RAG + 2-agent decision for charting).
- `src/services/llm.ts` – Gemini client wrapper with graceful fallback.
- `src/services/chart.ts` – Chart image generation using chartjs-node-canvas.
- `src/services/*` – Other services (embeddings, vector store).
- `src/utils/jsonToText.ts` – Flattens JSON into key:value lines for embeddings.
- `public/index.html` – Minimal test UI.

---

## Environment Variables

- `PORT` (default `3001`)
- `GOOGLE_API_KEY` (optional). If omitted, the backend returns a heuristic answer; if present, the 2-agent flow uses Gemini (`gemini-1.5-flash`). Quota/rate limits are caught and a fallback text answer is returned.

---

## API

### Health
- `GET /health`
  - Returns `{ status: "ok" }` when the server is up.

### Ingest
- `POST /ingest`
- Body (JSON):
  ```json
  {
    "namespace": "inprocess-inspection",
    "chunkSize": 800,            // optional (50–4000)
    "chunkOverlap": 100,         // optional (0–400)
    "documents": [
      {
        "id": "doc-1",          // optional (string). If omitted, a random suffix is used
        "text": "plain text..."  // EITHER 'text' OR 'json' IS REQUIRED
      },
      {
        "id": "doc-2",
        "json": { "k": "v" }   // can be nested JSON
      }
    ]
  }
  ```

- Notes
  - Each `documents[i]` MUST include either `text` or `json`. If neither is provided, the request is rejected by validation.
  - `id` must be a string. If omitted, the backend generates a unique ID for each chunk.
  - JSON is flattened with `jsonToText()` into key:value lines (dot paths for nested objects). Arrays are summarized as a short preview line and object items are descended into. Scalar array items are not emitted individually in the current version.
  - The request body must be valid JSON (no comments, no HTTP transcript in the body). Set `Content-Type: application/json`.

- Response
  ```json
  { "ok": true, "chunksAdded": 123, "namespace": "inprocess-inspection" }
  ```

### Query
- `POST /query`
- Body (JSON):
  ```json
  {
    "namespace": "inprocess-inspection",
    "prompt": "Summarize accepted vs rejected by plant with a short summary.",
    "topK": 10,
    "chart": {                   // optional. If provided, indicates output preferences only
      "output": "png",          // "png" or "json" (Chart.js spec)
      "width": 900,
      "height": 500
    }
  }
  ```

- Behavior
  - RAG: embeds the prompt, retrieves `topK` most similar chunks from the namespace, and builds a `context` string from their texts.
  - 2-agent flow (AUTO mode):
    - Agent A decides whether a chart is needed and (optionally) a type (`bar|line|pie|doughnut`).
    - Agent B composes the final text answer. If LLM is unavailable (no key or quota), a deterministic fallback summary is returned.
  - Prompt-level suppression: if the prompt includes explicit “no chart” phrases (e.g., “without graph”, “no chart”), charting is suppressed in AUTO mode.
  - Forcing charts: only possible by explicitly sending `"chartRequested": true` (the current UI does not do this).
  - Server-side guards for charting:
    - Must retrieve at least 2 chunks
    - Context must contain at least 2 numeric values
    - Multiple groups detected (e.g., at least two distinct plants)

- Chart Type Inference
  - If Agent A does not specify a `chartType`, the server infers from the prompt:
    - Mentions "pie" → pie; "doughnut/donut" → doughnut; "line"/"trend" → line; otherwise bar.

- Response
  ```json
  {
    "ok": true,
    "answer": "...text answer...",
    "chart": { "type": "pie", "width": 900, "height": 500 } | null,
    "imagePngBase64": "..." | null
  }
  ```
  - If `chart.output` was `json`, the response includes a Chart.js spec under `chart.spec` and the frontend renders it.

---

## Frontend (public/index.html)

- The demo page lets you:
  - Choose namespace and TopK
  - Enter a prompt
  - Choose output (PNG or JSON)
- The page always sends a `chart` block with only output preferences; the backend decides whether to render a chart based on the prompt and guards.
- To rely fully on AUTO logic, phrase the prompt naturally, e.g., "with pie chart". To suppress, say "without graph" or "no chart".

---

## Prompt Tips

- Ask for a specific visualization type when you know it:
  - "Pie chart of accepted by plant"
  - "Line chart of actual_readings over time" (requires date/time in your data)
- If you want text only, say: "without graph" or "text only".
- To ensure multi-group charts, ingest data for 2+ distinct plants.

---

## Troubleshooting

- "Invalid input: expected string, received number" on `/ingest`
  - `id` must be a string in this version. Wrap your numeric ID as a string or omit `id`.

- "Each document must include either 'text' or 'json'"
  - Add `text` or `json` to each document element. Raw unwrapped records are not auto-accepted in this version.

- "not valid JSON"
  - Ensure the request body is only JSON. Do not paste `POST /ingest` lines, headers, or `// comments`. Set `Content-Type: application/json`.

- No chart returned
  - Verify there are at least two distinct plants in the retrieved context
  - Increase `TopK` (e.g., 10–12) so the retriever brings multiple relevant chunks
  - Ensure your data contains numeric fields (e.g., `accepted`, `rejected`, or `actual_readings`). Arrays of scalars are summarized; individual scalar entries are not emitted in the current version.

- Gemini 429 (quota exceeded)
  - The server returns a deterministic fallback text summary and keeps AUTO chart off unless you force it via `chartRequested: true` (not used by the current UI).

---

## Example Requests

- Ingest
```json
{
  "namespace": "inprocess-inspection",
  "documents": [
    { "id": "rec-1", "json": { "created_by_id": { "plant_id": { "plant_id": "1001", "plant_name": "AMMUNITION FACTORY KHADKI" } }, "actual_readings": [{ "accepted": "12", "rejected": "3" }] } },
    { "id": "rec-2", "json": { "created_by_id": { "plant_id": { "plant_id": "1002", "plant_name": "Pune Plant" } }, "actual_readings": ["9","11","10"] } }
  ]
}
```

- Query (PNG)
```json
{
  "namespace": "inprocess-inspection",
  "prompt": "Summarize accepted vs rejected by plant with a pie chart.",
  "topK": 10,
  "chart": { "output": "png", "width": 900, "height": 500 }
}
```

- Query (JSON spec rendered on the page)
```json
{
  "namespace": "inprocess-inspection",
  "prompt": "Pie chart of accepted by plant.",
  "topK": 10,
  "chart": { "output": "json", "width": 900, "height": 500 }
}
```

---

## Known Limitations

- In-memory only (both vector store and any derived state), so data resets on server restart.
- Per-chunk retrieval is a sample; whole-population analytics (over 25k+ rows) is best implemented via a dedicated aggregation path. If you want this, we can add a simple SQLite-backed aggregation or JSONL-based aggregator.
- `jsonToText()` currently summarizes arrays but does not emit a line per scalar array element.

---

## License
Internal demo code for Q-shakti. Use at your own discretion.
