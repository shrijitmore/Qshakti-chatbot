import { Router } from "express";
import { z } from "zod";
import { embeddings } from "../services/embeddings";
import { vectorStore } from "../services/inMemoryVectorStore";
import { llm } from "../services/llm";
import { buildChart } from "../services/chart";
import { schemaMapper } from "../utils/schemaMapper";

export const queryRouter = Router();

const QuerySchema = z.object({
  namespace: z.string().optional(),
  prompt: z.string().min(1),
  topK: z.number().int().min(1).max(50).optional().default(5),
  chartRequested: z.boolean().optional(),
  chart: z
    .object({
      type: z.enum(["bar", "line", "pie", "doughnut"]).optional(),
      output: z.enum(["png", "json"]).optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
    })
    .optional(),
});

function shouldChartFromContext(context: string): boolean {
  const nums = context.match(/[-+]?\b\d+(?:\.\d+)?\b/g);
  return (nums?.length ?? 0) >= 2;
}

function promptRequestsChart(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return /(chart|graph|plot|visuali[sz]e|visuali[sz]ation|pie|bar|line|doughnut|donut)/.test(p);
}

function inferChartTypeFromPrompt(prompt: string): "bar" | "line" | "pie" | "doughnut" {
  const p = prompt.toLowerCase();
  if (/(^|\b)(pie)\b/.test(p)) return "pie";
  if (/(^|\b)(doughnut|donut)\b/.test(p)) return "doughnut";
  if (/(^|\b)(line|trend)\b/.test(p)) return "line";
  if (/(^|\b)(bar|column|compare|comparison)\b/.test(p)) return "bar";
  return "bar";
}

function parseContextToKeyValue(context: string): Record<string, any> {
  const data: Record<string, any> = {};
  const lines = context.split(/\n/g).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(?:--- (.+?) ---|([^:]+):\s*(.*))$/);
    if (match) {
      if (match[1]) {
        // Section header
      } else if (match[2]) {
        const key = match[2].trim().replace(/\s+/g, '_').toLowerCase();
        const value = match[3].trim();
        const numValue = parseFloat(value);
        data[key] = isNaN(numValue) ? value : numValue;
      }
    }
  }
  return data;
}

function buildFallbackSummary(context: string, prompt: string): string {
  const data = parseContextToKeyValue(context);
  const keys = Object.keys(data);
  if (keys.length === 0) return "I couldn't find any structured data to answer your question.";
  const summaryLines = keys.map(key => `- ${key}: ${data[key]}`);
  return summaryLines.join('\n');
}

function promptDisablesChart(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const patterns = [/without\s+graph/, /without\s+chart/, /no\s+chart/, /text\s+only/];
  return patterns.some((re) => re.test(p));
}

queryRouter.post("/", async (req, res) => {
  try {
    const { namespace, prompt, topK, chart, chartRequested } = QuerySchema.parse(req.body);

    const qVec = (await embeddings.embedMany([prompt]))[0];
    const ns = namespace ?? "default";
    // Use higher topK to ensure all relevant records are included
    const effectiveTopK = Math.min(topK || 20, 50);
    const results = await vectorStore.query({ namespace: ns, embedding: qVec, topK: effectiveTopK });
    const context = results.map((r) => r.text).join("\n\n");

    const answerPrompt = `You are an expert data analyst. Your task is to analyze the provided JSON data to answer the user's question and provide key insights.

--- DATA CONTEXT (JSON) ---
${context}

--- USER'S QUESTION ---
${prompt}

--- INSTRUCTIONS ---
1.  **Analyze the JSON data** to find the information needed to answer the question. You must traverse the nested objects to find relevant details.
2.  **Provide a brief summary** of your findings in natural language. Do not just restate the data.
3.  **Offer key insights** based on the data. What are the important takeaways? What trends or anomalies do you see?
4.  **Format your response** using Markdown for readability (e.g., headings, bold text, lists).
5.  **Always use foreign key relationships if present. If multiple tables are referenced, attempt joins before returning separate queries.

--- YOUR ANALYSIS ---
`;
    let answer: string;
    try {
      answer = await llm.ask({ prompt: answerPrompt });
    } catch (e) {
      let errorMessage = "I was unable to get a response from the AI.";
      if (e instanceof Error && e.message) {
        if (e.message.includes("resource_exhausted")) {
          errorMessage = "Error: The AI service is overloaded. Please try again.";
        } else {
          errorMessage = `Error from AI service: ${e.message}`;
        }
      }
      answer = `${errorMessage}\n\nHere is a summary of the data I found:\n${buildFallbackSummary(context, prompt)}`;
    }

    let chartMeta: any = null;
    let imagePngBase64: string | null = null;
    const disables = promptDisablesChart(prompt);
    const wantsChart = !disables && (chartRequested || promptRequestsChart(prompt));

    if (wantsChart && shouldChartFromContext(answer)) {
      const cfg = {
        type: chart?.type ?? inferChartTypeFromPrompt(prompt),
        output: chart?.output ?? "png",
        width: chart?.width ?? 900,
        height: chart?.height ?? 500,
      } as const;

      const chartPrompt = `You are an expert chart-generating AI. Create a Chart.js JSON configuration based on the provided text summary and the original user request.

--- USER'S REQUEST ---
${prompt}

--- DATA SUMMARY ---
${answer}

--- INSTRUCTIONS ---
- Create a chart that visualizes the data in the summary to answer the user's request.
- **CRITICAL:** Your response must be a single, valid JSON object using double quotes.
- Always use foreign key relationships if present. If multiple tables are referenced, attempt joins before returning separate queries

Respond with ONLY the Chart.js JSON configuration.`;

      const c = await buildChart({ prompt: chartPrompt, ...cfg });
      chartMeta = c.meta;
      imagePngBase64 = c.imageBase64 ?? null;
    }

    res.json({ ok: true, answer, chart: chartMeta, imagePngBase64 });
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ ok: false, error: err.message ?? "Query failed" });
  }
});
