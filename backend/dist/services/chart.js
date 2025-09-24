"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildChart = buildChart;
const chartjs_node_canvas_1 = require("chartjs-node-canvas");
async function buildChart(args) {
    const type = args.type ?? "bar";
    const width = args.width ?? 900;
    const height = args.height ?? 500;
    const chartJSNodeCanvas = new chartjs_node_canvas_1.ChartJSNodeCanvas({ width, height, backgroundColour: "white" });
    const rowsMap = new Map();
    let currentPlant = "";
    const lines = args.context.split(/\n|,|;|\|/g).map((s) => s.trim()).filter(Boolean);
    const ensureRow = (plant) => {
        if (!rowsMap.has(plant))
            rowsMap.set(plant, { plant });
        return rowsMap.get(plant);
    };
    for (const line of lines) {
        // detect plant name/id
        const mName = line.match(/plant[_\s]?name\s*:\s*([^\n]+)/i);
        const mId = line.match(/plant[_\s]?id\s*:\s*([^\n]+)/i);
        if (mName) {
            currentPlant = mName[1].trim();
            ensureRow(currentPlant);
            continue;
        }
        if (mId) {
            if (!currentPlant)
                currentPlant = mId[1].trim();
            ensureRow(currentPlant);
            continue;
        }
        // metrics
        const mAcc = line.match(/accepted\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (mAcc && currentPlant) {
            const r = ensureRow(currentPlant);
            r.accepted = Number(mAcc[1]);
            continue;
        }
        const mRej = line.match(/rejected\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (mRej && currentPlant) {
            const r = ensureRow(currentPlant);
            r.rejected = Number(mRej[1]);
            continue;
        }
        const mRead = line.match(/actual[_\s]?readings?\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (mRead && currentPlant) {
            const r = ensureRow(currentPlant);
            r.actual_readings = Number(mRead[1]);
            continue;
        }
    }
    let rows = Array.from(rowsMap.values());
    // Fallback: pick only meaningful numeric pairs if rows empty
    if (rows.length === 0) {
        const pairs = [];
        for (const line of lines) {
            const m = line.match(/([^:]+):\s*(-?\d+(?:\.\d+)?)/);
            if (!m)
                continue;
            const key = m[1].trim().toLowerCase();
            if (["accepted", "rejected", "actual_readings", "reading", "count"].some((k) => key.includes(k))) {
                pairs.push({ label: m[1].trim(), value: Number(m[2]) });
            }
        }
        if (pairs.length === 0) {
            pairs.push({ label: "A", value: 10 });
            pairs.push({ label: "B", value: 15 });
            pairs.push({ label: "C", value: 8 });
        }
        const labels = pairs.map((p) => p.label);
        const data = pairs.map((p) => p.value);
        const config = {
            type,
            data: { labels, datasets: [{ label: args.prompt.slice(0, 60), data, backgroundColor: "rgba(54,162,235,0.5)", borderColor: "rgba(54,162,235,1)", borderWidth: 1 }] },
            options: { responsive: false, plugins: { legend: { display: true } } },
        };
        if (args.output === "json")
            return { meta: { type, width, height, spec: config } };
        const image = await chartJSNodeCanvas.renderToBuffer(config);
        return { imageBase64: image.toString("base64"), meta: { type, width, height } };
    }
    // Helpers
    const promptLower = args.prompt.toLowerCase();
    const has = (k) => rows.some((r) => typeof r[k] === "number");
    const labels = rows.map((r) => r.plant || "(unknown)");
    const color = (i, a = 0.6) => `hsla(${(i * 53) % 360},70%,60%,${a})`;
    let config;
    if (type === "pie" || type === "doughnut") {
        // Choose metric: if prompt mentions rejected only -> rejected; mentions readings -> actual_readings; if mentions both accepted/rejected -> total
        let metric = "accepted";
        const mentionsAccepted = /accepted/.test(promptLower);
        const mentionsRejected = /rejected/.test(promptLower);
        if (mentionsRejected && !mentionsAccepted)
            metric = "rejected";
        else if (/actual[_\s]?readings?/.test(promptLower))
            metric = "actual_readings";
        let dataVals;
        if (mentionsAccepted && mentionsRejected) {
            dataVals = rows.map((r) => (r.accepted ?? 0) + (r.rejected ?? 0));
        }
        else {
            dataVals = rows.map((r) => (r[metric] ?? 0));
        }
        config = {
            type,
            data: {
                labels,
                datasets: [
                    {
                        label: mentionsAccepted && mentionsRejected ? "total" : String(metric),
                        data: dataVals,
                        backgroundColor: labels.map((_, i) => color(i, 0.6)),
                        borderColor: labels.map((_, i) => color(i, 1)),
                        borderWidth: 1,
                    },
                ],
            },
            options: { responsive: false, plugins: { legend: { display: true } } },
        };
    }
    else {
        // bar/line: multi-dataset when possible
        const datasets = [];
        if (has("accepted"))
            datasets.push({ label: "accepted", data: rows.map((r) => r.accepted ?? 0), backgroundColor: "rgba(54,162,235,0.5)", borderColor: "rgba(54,162,235,1)", borderWidth: 1 });
        if (has("rejected"))
            datasets.push({ label: "rejected", data: rows.map((r) => r.rejected ?? 0), backgroundColor: "rgba(255,99,132,0.5)", borderColor: "rgba(255,99,132,1)", borderWidth: 1 });
        if (has("actual_readings"))
            datasets.push({ label: "actual_readings", data: rows.map((r) => r.actual_readings ?? 0), backgroundColor: "rgba(75,192,192,0.5)", borderColor: "rgba(75,192,192,1)", borderWidth: 1 });
        if (datasets.length === 0)
            datasets.push({ label: "value", data: rows.map(() => 0), backgroundColor: "rgba(180,180,180,0.5)", borderColor: "rgba(180,180,180,1)", borderWidth: 1 });
        config = { type, data: { labels, datasets }, options: { responsive: false, plugins: { legend: { display: true } } } };
    }
    if (args.output === "json") {
        return { meta: { type, width, height, spec: config } };
    }
    const image = await chartJSNodeCanvas.renderToBuffer(config);
    const base64 = image.toString("base64");
    return { imageBase64: base64, meta: { type, width, height } };
}
