// Utility to convert nested JSON into readable key: value lines for embeddings
// - Flattens nested objects into dot.paths
// - Keeps only scalar values (string | number | boolean | null | date-like strings)
// - For arrays, includes up to a few elements inline
// - Skips empty objects/arrays

function isScalar(v: any): boolean {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

function isDateLikeString(s: string): boolean {
  if (typeof s !== "string") return false;
  // Basic ISO-ish date detection
  return /\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+\-]\d{2}:?\d{2})?)?/.test(s);
}

export function jsonToText(input: unknown, options?: { maxArrayItems?: number }): string {
  const lines: string[] = [];
  const maxArrayItems = options?.maxArrayItems ?? 5;

  function visit(value: any, path: string[]) {
    if (value === undefined) return;

    if (isScalar(value)) {
      lines.push(`${path.join(".")}: ${String(value)}`);
      return;
    }

    if (typeof value === "string" && isDateLikeString(value)) {
      lines.push(`${path.join(".")}: ${value}`);
      return;
    }

    if (Array.isArray(value)) {
      const arr = value.slice(0, maxArrayItems);
      const preview = arr
        .map((v) => (isScalar(v) ? String(v) : typeof v))
        .join(", ");
      if (arr.length > 0) {
        lines.push(`${path.join(".")}[0..${arr.length - 1}]: ${preview}`);
      }
      // Also descend into object items for additional detail
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v && typeof v === "object" && !isScalar(v)) {
          visit(v, [...path, String(i)]);
        }
      }
      return;
    }

    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length === 0) return;
      for (const k of keys) {
        visit(value[k], [...path, k]);
      }
      return;
    }
  }

  visit(input, []);

  // De-duplicate and join
  const dedup = Array.from(new Set(lines));
  return dedup.join("\n");
}
