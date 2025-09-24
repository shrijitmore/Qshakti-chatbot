"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkText = chunkText;
function chunkText(text, chunkSize = 800, chunkOverlap = 100) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        const end = Math.min(text.length, i + chunkSize);
        const chunk = text.slice(i, end);
        chunks.push(chunk);
        if (end === text.length)
            break;
        i = end - chunkOverlap;
        if (i < 0)
            i = 0;
    }
    return chunks;
}
