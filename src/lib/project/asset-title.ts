/**
 * 生成图的可读名称：UI / 下载用短名，磁盘文件名仍走 ASCII 安全化。
 */

export type AssetTitleInput = {
  id?: string;
  title?: string;
  prompt?: string;
  role?: string;
  familyTitle?: string;
  copyPlan?: Array<{ role?: string; text?: string }>;
};

const ROLE_LABEL: Record<string, string> = {
  hero: "主视觉",
  illustration: "插画",
  "product-shot": "产品图",
  background: "背景",
  icon: "图标",
  avatar: "头像",
  decoration: "装饰",
};

const ZH_SCREEN =
  /[\u4e00-\u9fff]{2,12}(?:首页|详情页|定价页|方案页|结算页|登录页|看板|封面|主视觉|海报|立绘|界面)/;

export function looksLikeGeneratedAssetId(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (/[\u4e00-\u9fff]/.test(t) || /\s/.test(t)) return false;
  if (/pending[:\-]/i.test(t)) return true;
  return /^[A-Za-z0-9._:-]{8,}$/.test(t);
}

export function deriveAssetTitle(input: AssetTitleInput): string {
  const stored = input.title?.trim();
  if (stored && !looksLikeGeneratedAssetId(stored)) return clipTitle(stored);

  const family = input.familyTitle?.trim();
  if (family && !looksLikeGeneratedAssetId(family)) return clipTitle(family);

  const headline = input.copyPlan?.find((item) => item.role === "headline")?.text?.trim();
  if (headline && !looksLikeGeneratedAssetId(headline)) return clipTitle(headline);

  const fromPrompt = titleFromPrompt(input.prompt ?? "");
  if (fromPrompt) return fromPrompt;

  return ROLE_LABEL[input.role ?? ""] ?? "视觉稿";
}

export function displayAssetTitle(input: AssetTitleInput): string {
  return deriveAssetTitle(input);
}

export function assignAssetTitles(items: AssetTitleInput[]): string[] {
  const bases = items.map((item) => deriveAssetTitle(item));
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
  const seen = new Map<string, number>();
  return bases.map((base) => {
    if ((counts.get(base) ?? 0) <= 1) return base;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base} ${n}`;
  });
}

export function toDownloadAssetFilename(input: AssetTitleInput): string {
  const stem =
    displayAssetTitle(input)
      .replace(/[\\/:*?"<>|]+/g, "")
      .trim() || "视觉稿";
  return `${stem}.png`;
}

function titleFromPrompt(prompt: string): string | null {
  const raw = prompt.replace(/\s+/g, " ").trim();
  if (!raw || looksLikeGeneratedAssetId(raw)) return null;

  const cjkStart = raw.search(/[\u4e00-\u9fff]/);
  const cjkSlice = cjkStart >= 0 ? raw.slice(cjkStart) : "";
  const zhScreen = cjkSlice.match(ZH_SCREEN);
  if (zhScreen) return clipTitle(zhScreen[0]);
  const zhPhrase = cjkSlice.match(/[\u4e00-\u9fff]{2,12}/);
  if (zhPhrase) return clipTitle(zhPhrase[0]);

  const mockupOf = raw.match(
    /\b(?:mockup|image|shot|illustration|poster|cover)\s+of\s+(?:an?\s+)?([^,，.。]+)/i,
  );
  if (mockupOf?.[1]) {
    return clipTitle(sentenceName(stripArticles(mockupOf[1])));
  }

  const phrase = raw.split(/[,，。.!！]/)[0]?.trim() ?? "";
  const compact = phrase
    .replace(/^(?:a\s+)?(?:high-fidelity|photorealistic)\s+(?:ui\s+)?/i, "")
    .replace(/\b(cool|warm|overcast|dark|light|minimal|editorial)\b/gi, "")
    .replace(/\b(image|photo|shot|visual|mockup)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length >= 2 && !looksLikeGeneratedAssetId(compact)) {
    return clipTitle(sentenceName(stripArticles(compact)));
  }
  return null;
}

function stripArticles(value: string): string {
  return value.replace(/^(?:an?\s+)/i, "").trim();
}

function sentenceName(value: string): string {
  const t = stripArticles(value).replace(/\s+/g, " ").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function clipTitle(value: string): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length > 48 ? `${one.slice(0, 47)}…` : one;
}
