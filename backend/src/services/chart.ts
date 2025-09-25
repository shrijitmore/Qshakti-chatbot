import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { llm } from "./llm";

export type ChartArgs = {
  prompt: string;
  type?: "bar" | "line" | "pie" | "doughnut";
  width?: number;
  height?: number;
  output?: "png" | "json";
};

export async function buildChart(args: ChartArgs): Promise<{ imageBase64?: string; meta: any }> {
  const { prompt, type = "bar", width = 900, height = 500 } = args;

  let config: any;
  try {
    const llmAnswer = await llm.ask({ prompt });
    const match = llmAnswer.match(/\{[\s\S]*\}/);
    let jsonStr = match ? match[0] : llmAnswer;
    // Pre-process the string to make it more robust against common LLM errors
    jsonStr = jsonStr.replace(/'/g, '"').replace(/,(\s*[\}\]])/g, '$1');
    config = JSON.parse(jsonStr);
    // Ensure the type from args overrides the LLM's decision if specified
    config.type = type;
  } catch (e) {
    console.error("Error parsing LLM response for chart config:", e);
    // Fallback to a very simple chart on error
    config = {
      type: 'bar',
      data: {
        labels: ['Error'],
        datasets: [{ label: 'Could not generate chart', data: [1] }]
      },
      options: { responsive: false }
    };
  }

  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: "white" });

  if (args.output === "json") {
    return { meta: { type, width, height, spec: config } };
  }

  const image = await chartJSNodeCanvas.renderToBuffer(config);
  const base64 = image.toString("base64");
  return { imageBase64: base64, meta: { type, width, height } };
}
