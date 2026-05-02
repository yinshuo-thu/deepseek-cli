// Hand-rolled YAML-subset frontmatter parser. Shared by agents/definitions and
// skills/loader. Supports:
//   key: value              (string)
//   key: 'quoted value'     (single or double quoted)
//   key:                    followed by indented YAML list
//     - item1
//     - item2
//
// Booleans/numbers are kept as strings; comments (lines starting with #) and
// blank lines are skipped. Keys may use [A-Za-z_][\w-]*.

export interface FrontmatterParsed {
  data: Record<string, string | string[]>;
  body: string;
}

export function parseFrontmatter(raw: string): FrontmatterParsed | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const head = m[1] ?? '';
  const body = (m[2] ?? '').trim();

  const data: Record<string, string | string[]> = {};
  const lines = head.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) { i++; continue; }
    const key = kv[1]!;
    const rest = (kv[2] ?? '').trim();
    if (rest === '') {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const ln = lines[j] ?? '';
        const li = ln.match(/^\s+-\s+(.+)$/);
        if (!li) break;
        items.push(unquote(li[1]!.trim()));
        j++;
      }
      data[key] = items;
      i = j;
    } else {
      data[key] = unquote(rest);
      i++;
    }
  }
  return { data, body };
}

export function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Parse a comma-separated string OR a list field, returning a string[]. */
export function asList(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v;
  if (!v.trim()) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
