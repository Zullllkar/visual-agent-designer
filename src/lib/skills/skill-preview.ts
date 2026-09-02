export function splitSkillDocument(raw: string): { yaml: string; markdown: string } {
  const match = String(raw ?? "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  if (!match) return { yaml: "", markdown: String(raw ?? "").trim() };
  return { yaml: match[1].replace(/\s+$/, ""), markdown: match[2].trim() };
}

type YamlSegment = { key: string; className?: string; text: string };

export function yamlPreviewSegments(text: string): YamlSegment[] {
  const segments: YamlSegment[] = [];
  let offset = 0;
  for (const line of String(text ?? "").split("\n")) {
    const comment = line.match(/^(\s*)(#.*)$/);
    if (comment) {
      if (comment[1]) {
        segments.push({ key: `${offset}-i`, text: comment[1] });
      }
      segments.push({ key: `${offset}-c`, className: "is-comment", text: comment[2] });
    } else {
      const colon = line.indexOf(":");
      const key = colon > 0 ? line.slice(0, colon) : "";
      const keyed =
        colon > 0 &&
        (/^\s*-?\s*[\w./-]+\s*$/.test(key) || /^\s*[\u4e00-\u9fff\w./-]+\s*$/.test(key));
      if (keyed) {
        segments.push({ key: `${offset}-k`, className: "is-key", text: key });
        segments.push({ key: `${offset}-n`, text: ":" });
        segments.push({
          key: `${offset}-v`,
          className: "is-val",
          text: line.slice(colon + 1),
        });
      } else {
        segments.push({ key: `${offset}-l`, text: line });
      }
    }
    segments.push({ key: `${offset}-br`, text: "\n" });
    offset += line.length + 1;
  }
  if (segments.at(-1)?.text === "\n") segments.pop();
  return segments;
}

export function skillDocumentTitle(raw: string, fallback: string): string {
  const heading = splitSkillDocument(raw).markdown.match(/^#\s+(.+)$/m);
  const title = heading?.[1]?.trim();
  if (title) return title;
  return fallback.trim() || "未命名 Skill";
}

export function skillCardTitle(input: {
  description: string;
  bodyPreview?: string;
  name: string;
}): string {
  const heading = String(input.bodyPreview ?? "")
    .match(/^#\s+(.+)$/m)?.[1]
    ?.trim();
  if (heading) return heading;
  const first = input.description.split(/[。.\n]/)[0]?.trim() ?? "";
  if (first.length > 0 && first.length <= 18) return first;
  if (first.length > 18) return `${first.slice(0, 17)}…`;
  return input.name;
}
