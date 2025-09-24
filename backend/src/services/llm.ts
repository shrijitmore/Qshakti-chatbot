import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GOOGLE_API_KEY;
const hasKey = typeof apiKey === "string" && apiKey.length > 0;

let client: GoogleGenerativeAI | null = null;
function getClient() {
  if (!client) client = new GoogleGenerativeAI(apiKey || "");
  return client;
}

export const llm = {
  async ask({ prompt }: { prompt: string }): Promise<string> {
    if (!hasKey) {
      // Fallback: echo with minimal formatting
      return `LLM unavailable. Heuristic answer based on prompt and context.\n\n${prompt.slice(0, 500)}`;
    }
    const genAI = getClient();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: { temperature: 0.2 },
    } as any);
    // SDK response accessor
    const text = (result as any).response?.text?.() ?? (result as any).response?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ?? "";
  },
};
