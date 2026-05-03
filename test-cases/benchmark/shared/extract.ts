#!/usr/bin/env tsx
// Extracts a fenced code block from a model response string.
export function extractCodeBlock(response: string, lang?: string): string {
  // Try fenced block with specified lang first, then any lang, then raw
  const fenced = lang
    ? response.match(new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```', 'i'))
    : response.match(/```\w*\s*\n([\s\S]*?)\n```/);
  if (fenced?.[1]) return fenced[1].trim();
  // Fallback: any fenced block
  const any = response.match(/```[\s\S]*?\n([\s\S]*?)\n```/);
  if (any?.[1]) return any[1].trim();
  return response.trim();
}
