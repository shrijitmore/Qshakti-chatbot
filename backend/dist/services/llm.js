"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.llm = void 0;
const generative_ai_1 = require("@google/generative-ai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const apiKey = process.env.GOOGLE_API_KEY;
const hasKey = typeof apiKey === "string" && apiKey.length > 0;
let client = null;
function getClient() {
    if (!client)
        client = new generative_ai_1.GoogleGenerativeAI(apiKey || "");
    return client;
}
exports.llm = {
    async ask({ prompt }) {
        if (!hasKey) {
            // Fallback: echo with minimal formatting
            return `LLM unavailable. Heuristic answer based on prompt and context.\n\n${prompt.slice(0, 500)}`;
        }
        const genAI = getClient();
        const model = genAI.getGenerativeModel({ model: process.env.GENERATION_MODEL || "gemini-1.5-flash" });
        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [{ text: prompt }],
                },
            ],
            generationConfig: { temperature: 0.2 },
        });
        // SDK response accessor
        const text = result.response?.text?.() ?? result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        return text ?? "";
    },
};
