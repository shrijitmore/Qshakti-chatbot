"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const embeddings_1 = require("../services/embeddings");
const inMemoryVectorStore_1 = require("../services/inMemoryVectorStore");
const llm_1 = require("../services/llm");
const chart_1 = require("../services/chart");
const schemaMapper_1 = require("../utils/schemaMapper");
exports.queryRouter = (0, express_1.Router)();
const QuerySchema = zod_1.z.object({
    namespace: zod_1.z.string().optional(),
    prompt: zod_1.z.string().min(1),
    topK: zod_1.z.number().int().min(1).max(50).optional().default(5),
    chartRequested: zod_1.z.boolean().optional(),
    chart: zod_1.z
        .object({
        type: zod_1.z.enum(["bar", "line", "pie", "doughnut"]).optional(),
        output: zod_1.z.enum(["png", "json"]).optional(),
        width: zod_1.z.number().int().optional(),
        height: zod_1.z.number().int().optional(),
    })
        .optional(),
});
function shouldChartFromContext(context) {
    const nums = context.match(/[-+]?\b\d+(?:\.\d+)?\b/g);
    return (nums?.length ?? 0) >= 2;
}
function promptRequestsChart(prompt) {
    const p = prompt.toLowerCase();
    return /(chart|graph|plot|visuali[sz]e|visuali[sz]ation|pie|bar|line|doughnut|donut)/.test(p);
}
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
function parseContextToKeyValue(context) {
    const data = {};
    const lines = context.split(/\n/g).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
        const match = line.match(/^(?:--- (.+?) ---|([^:]+):\s*(.*))$/);
        if (match) {
            if (match[1]) {
                // Section header
            }
            else if (match[2]) {
                const key = match[2].trim().replace(/\s+/g, '_').toLowerCase();
                const value = match[3].trim();
                const numValue = parseFloat(value);
                data[key] = isNaN(numValue) ? value : numValue;
            }
        }
    }
    return data;
}
function buildFallbackSummary(context, prompt) {
    const data = parseContextToKeyValue(context);
    const keys = Object.keys(data);
    if (keys.length === 0)
        return "I couldn't find any structured data to answer your question.";
    const summaryLines = keys.map(key => `- ${key}: ${data[key]}`);
    return summaryLines.join('\n');
}
function promptDisablesChart(prompt) {
    const p = prompt.toLowerCase();
    const patterns = [/without\s+graph/, /without\s+chart/, /no\s+chart/, /text\s+only/];
    return patterns.some((re) => re.test(p));
}
exports.queryRouter.post("/", async (req, res) => {
    try {
        const { namespace, prompt, topK, chart, chartRequested } = QuerySchema.parse(req.body);
        const qVec = (await embeddings_1.embeddings.embedMany([prompt]))[0];
        const ns = namespace ?? "default";
        // Use higher topK to ensure all relevant records are included
        const effectiveTopK = Math.min(topK || 20, 50);
        const results = await inMemoryVectorStore_1.vectorStore.query({ namespace: ns, embedding: qVec, topK: effectiveTopK });
        const context = results.map((r) => r.text).join("\n\n");
        const answerPrompt = `You are an expert data analyst specializing in PostgreSQL relational database analysis. Your task is to analyze the provided data context to answer the user's question with comprehensive insights and natural language explanations.

--- DATABASE CONTEXT ---
${context}

--- USER'S QUESTION ---
${prompt}

--- ANALYSIS INSTRUCTIONS ---
1. **Understand Relationships**: The data contains multiple related tables with foreign keys. Always identify and explain relationships between entities (users, plants, machines, operations, inspections).

2. **Natural Language Focus**: 
   - Refer to entities by their meaningful names, not IDs or table names
   - Example: "Inspector Arpit from Plant Ammunition Factory Khadki" instead of "user_id: 123 from plant_id: 1001"
   - Use relationship context to provide rich, connected insights

3. **Comprehensive Analysis**:
   - Identify patterns, trends, and anomalies in the data
   - Provide quantitative insights with numbers and percentages where available
   - Explain the business implications of your findings

4. **Structured Response**:
   - Start with a clear executive summary
   - Use markdown formatting (headers, bullet points, tables)
   - Include specific examples and evidence from the data
   - End with key takeaways and recommendations

5. **Cross-table Insights**: When data spans multiple tables, connect the information to tell a complete story about operations, quality, performance, etc.

--- YOUR ANALYSIS ---
`;
        let answer;
        try {
            answer = await llm_1.llm.ask({ prompt: answerPrompt });
        }
        catch (e) {
            let errorMessage = "I was unable to get a response from the AI.";
            if (e instanceof Error && e.message) {
                if (e.message.includes("resource_exhausted")) {
                    errorMessage = "Error: The AI service is overloaded. Please try again.";
                }
                else {
                    errorMessage = `Error from AI service: ${e.message}`;
                }
            }
            answer = `${errorMessage}\n\nHere is a summary of the data I found:\n${buildFallbackSummary(context, prompt)}`;
        }
        let chartMeta = null;
        let imagePngBase64 = null;
        const disables = promptDisablesChart(prompt);
        const wantsChart = !disables && (chartRequested || promptRequestsChart(prompt));
        if (wantsChart && shouldChartFromContext(answer)) {
            const cfg = {
                type: chart?.type ?? inferChartTypeFromPrompt(prompt),
                output: chart?.output ?? "png",
                width: chart?.width ?? 900,
                height: chart?.height ?? 500,
            };
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
            const c = await (0, chart_1.buildChart)({ prompt: chartPrompt, ...cfg });
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
// New endpoint for schema exploration and relationship queries
exports.queryRouter.post("/schema", async (req, res) => {
    try {
        const { action } = req.body;
        switch (action) {
            case 'documentation':
                const docs = schemaMapper_1.schemaMapper.generateSchemaDocumentation();
                res.json({
                    ok: true,
                    documentation: docs,
                    type: 'schema_documentation'
                });
                break;
            case 'relationships':
                const { tableName } = req.body;
                if (!tableName) {
                    return res.status(400).json({ ok: false, error: 'tableName required for relationships query' });
                }
                const related = schemaMapper_1.schemaMapper.getRelatedTables(tableName);
                res.json({
                    ok: true,
                    tableName,
                    relationships: related,
                    type: 'table_relationships'
                });
                break;
            case 'categories':
                const categories = {
                    inspection: schemaMapper_1.schemaMapper.getTablesByCategory('inspection'),
                    master: schemaMapper_1.schemaMapper.getTablesByCategory('master'),
                    user: schemaMapper_1.schemaMapper.getTablesByCategory('user'),
                    admin: schemaMapper_1.schemaMapper.getTablesByCategory('admin')
                };
                res.json({
                    ok: true,
                    categories,
                    type: 'table_categories'
                });
                break;
            default:
                res.status(400).json({ ok: false, error: 'Invalid action. Use: documentation, relationships, or categories' });
        }
    }
    catch (err) {
        console.error('Schema query error:', err);
        res.status(500).json({ ok: false, error: err.message ?? "Schema query failed" });
    }
});
