"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const embeddings_1 = require("../services/embeddings");
const adaptiveVectorStore_1 = require("../services/adaptiveVectorStore");
const llm_1 = require("../services/llm");
const chart_1 = require("../services/chart");
exports.queryRouter = (0, express_1.Router)();
const QuerySchema = zod_1.z.object({
    namespace: zod_1.z.string().optional(),
    prompt: zod_1.z.string().min(1),
    topK: zod_1.z.number().int().min(1).max(50).optional().default(5),
    // Client override for charting: true -> force attempt; false -> suppress; undefined -> AI decides
    chartRequested: zod_1.z.boolean().optional(),
    // Optional chart config; a chart will only be generated if requested by client
    chart: zod_1.z
        .object({
        type: zod_1.z.enum(["bar", "line", "pie", "doughnut"]).optional(),
        output: zod_1.z.enum(["png", "json"]).optional(),
        width: zod_1.z.number().int().optional(),
        height: zod_1.z.number().int().optional(),
    })
        .optional(),
});
// Minimal server-side validator: require at least two numeric values in context
function shouldChartFromContext(context) {
    // Count numeric tokens (integers or decimals)
    const nums = context.match(/[-+]?\b\d+(?:\.\d+)?\b/g);
    return (nums?.length ?? 0) >= 2;
}
// Detect whether the prompt explicitly asks to draw a chart
function promptRequestsChart(prompt) {
    const p = prompt.toLowerCase();
    return /(chart|graph|plot|visuali[sz]e|visuali[sz]ation|pie|bar|line|doughnut|donut)/.test(p);
}
// Infer a chart type from the user's prompt when Agent A did not specify
function inferChartTypeFromPrompt(prompt) {
    const p = prompt.toLowerCase();
    if (/(^|\b)(pie)\b/.test(p))
        return "pie";
    if (/(^|\b)(doughnut|donut)\b/.test(p))
        return "doughnut";
    if (/(^|\b)(line|trend)\b/.test(p))
        return "line";
    if (/(^|\b)(bar|column|compare|comparison)\b/.test(p))
        return "bar";
    return "bar";
}
function parseRowsFromContext(context) {
    const rowsMap = new Map();
    let current = "";
    const ensure = (k) => {
        if (!rowsMap.has(k))
            rowsMap.set(k, { plant: k });
        return rowsMap.get(k);
    };
    const lines = context.split(/\n|,|;|\|/g).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
        const mName = line.match(/plant[_\s]?name\s*:\s*([^\n]+)/i);
        const mId = line.match(/plant[_\s]?id\s*:\s*([^\n]+)/i);
        if (mName) {
            current = mName[1].trim();
            ensure(current);
            continue;
        }
        if (mId) {
            if (!current)
                current = mId[1].trim();
            ensure(current);
            continue;
        }
        const mA = line.match(/accepted\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (mA && current) {
            const r = ensure(current);
            r.accepted = Number(mA[1]);
            continue;
        }
        const mR = line.match(/rejected\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (mR && current) {
            const r = ensure(current);
            r.rejected = Number(mR[1]);
            continue;
        }
        const mX = line.match(/actual[_\s]?readings?\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (mX && current) {
            const r = ensure(current);
            r.actual_readings = Number(mX[1]);
            continue;
        }
    }
    return Array.from(rowsMap.values());
}
function buildFallbackSummary(rows, prompt) {
    if (rows.length === 0)
        return "Insufficient context. I need data with per-plant accepted/rejected/actual_readings.";
    const lines = [];
    for (const r of rows) {
        const parts = [];
        if (typeof r.accepted === "number")
            parts.push(`accepted=${r.accepted}`);
        if (typeof r.rejected === "number")
            parts.push(`rejected=${r.rejected}`);
        if (typeof r.actual_readings === "number")
            parts.push(`actual_readings=${r.actual_readings}`);
        lines.push(`- ${r.plant}: ${parts.join(", ")}`);
    }
    return `Summary by plant (fallback):\n${lines.join("\n")}`;
}
// Detect user explicitly asking NOT to plot
function promptDisablesChart(prompt) {
    const p = prompt.toLowerCase();
    const patterns = [
        /withou?t\s+graph/, // matches 'without graph' and common typo 'withou graph'
        /withou?t\s+chart/,
        /w\/?o\s+(graph|chart|viz|visual(ization)?)/, // 'w/o graph', 'w/o chart'
        /no\s+(graph|chart|plot(ting)?|viz|visual(ization)?|image|png)/,
        /(don't|do not|dont)\s+(plot|draw|graph|chart)/,
        /text\s+only/,
        /only\s+text/,
        /no\s+figure/,
    ];
    return patterns.some((re) => re.test(p));
}
// Detect whether there are at least two distinct entity groups (e.g., plants) in the context
function hasMultipleGroups(context) {
    const names = new Set();
    // Try common keys emitted by jsonToText and our examples
    const plantNameRe = /plant[_\s]?name\s*[:\s]+([^\n]+)/gi;
    const plantIdRe = /plant[_\s]?id\s*[:\s]+([^\n]+)/gi;
    let m;
    while ((m = plantNameRe.exec(context))) {
        names.add(m[1].trim().toLowerCase());
    }
    while ((m = plantIdRe.exec(context))) {
        names.add(m[1].trim().toLowerCase());
    }
    return names.size >= 2;
}
exports.queryRouter.post("/", async (req, res) => {
    try {
        const { namespace, prompt, topK, chart, chartRequested } = QuerySchema.parse(req.body);
        // RAG retrieve
        const qVec = (await embeddings_1.embeddings.embedMany([prompt]))[0];
        const ns = namespace ?? "default";
        const results = await adaptiveVectorStore_1.adaptiveVectorStore.query({ namespace: ns, embedding: qVec, topK });
        const context = results.map((r) => r.text).join("\n\n");
        // Agent A: Decision maker (AUTO mode)
        const decisionPrompt = `You are Agent A (Decision). Decide if the user's prompt requires a chart/graph based on the prompt and context.
Return STRICT JSON: {"needChart": boolean, "chartType": "bar"|"line"|"pie"|"doughnut"|null, "reason": string}
Rules:
- If the user explicitly asks for a plot/chart/graph/visualization OR numeric comparisons are central, needChart=true.
- Otherwise needChart=false.
- If needChart=true and user specified a type (pie/line/bar/doughnut), set chartType accordingly; else default chartType="bar".
- reason should be short and reference the context sufficiency.

CONTEXT:\n${context}\n\nUSER PROMPT:\n${prompt}`;
        let llmNeedChart = false;
        let llmChartType = null;
        try {
            const decisionRaw = await llm_1.llm.ask({ prompt: decisionPrompt });
            try {
                const match = decisionRaw.match(/\{[\s\S]*\}/);
                const jsonStr = match ? match[0] : decisionRaw;
                const parsed = JSON.parse(jsonStr);
                if (typeof parsed?.needChart === "boolean") {
                    llmNeedChart = parsed.needChart;
                }
                if (parsed?.chartType && ["bar", "line", "pie", "doughnut"].includes(parsed.chartType)) {
                    llmChartType = parsed.chartType;
                }
            }
            catch { /* ignore, default false */ }
        }
        catch (e) {
            // LLM unavailable (e.g., quota). Keep AUTO off by default.
            llmNeedChart = promptRequestsChart(prompt) && !promptDisablesChart(prompt);
        }
        // Agent B: Enhanced QC Data Analyzer
        const answerPrompt = `You are an expert Quality Control Data Analyst. Analyze the provided QC inspection data and provide comprehensive, accurate insights.

ANALYSIS GUIDELINES:
- Provide precise numerical analysis when dealing with defect rates, acceptance rates, measurements
- Identify patterns, trends, and anomalies in the data
- Compare performance across plants, machines, operators, items, or time periods
- Highlight critical quality issues and their potential impact
- Suggest root causes for quality problems when patterns are evident
- Use statistical thinking for data interpretation
- Be specific about sample sizes and confidence in your analysis

VISUALIZATION: ${llmNeedChart ? 'Include insights about what the chart shows' : 'Focus on textual analysis only'}

CONTEXT DATA:\n${context}

USER QUESTION: ${prompt}

Provide a detailed, actionable analysis:`;
        let answer;
        try {
            answer = await llm_1.llm.ask({ prompt: answerPrompt });
        }
        catch (e) {
            // Fallback: build a deterministic summary from context
            const rows = parseRowsFromContext(context);
            answer = buildFallbackSummary(rows, prompt);
        }
        // Only build a chart if client requested it (chartRequested or chart present),
        // we have at least 2 retrieved chunks, AND the context looks chartable (>=2 numeric values)
        // AND there are multiple groups
        let chartMeta = null;
        let imagePngBase64 = null;
        const disables = promptDisablesChart(prompt);
        const wantsChart = (
        // Explicit force only when chartRequested===true
        chartRequested === true ? true :
            // If prompt disables, suppress in AUTO mode
            (disables ? false : (chartRequested === undefined && llmNeedChart)));
        if (wantsChart && results.length >= 2 && shouldChartFromContext(context) && hasMultipleGroups(context)) {
            const cfg = {
                type: chart?.type ?? (llmChartType ?? inferChartTypeFromPrompt(prompt)),
                output: chart?.output ?? "png",
                width: chart?.width ?? 900,
                height: chart?.height ?? 500,
            };
            const c = await (0, chart_1.buildChart)({ prompt, context, ...cfg });
            chartMeta = c.meta;
            imagePngBase64 = c.imageBase64 ?? null;
        }
        res.json({ ok: true, answer, chart: chartMeta, imagePngBase64 });
    }
    catch (err) {
        console.error(err);
        res.status(400).json({ ok: false, error: err.message ?? "Query failed" });
    }
});
