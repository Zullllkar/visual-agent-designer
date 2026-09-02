/**
 * Google Fonts API
 * --------------------------------------------------------------
 * 获取 Google Fonts 列表，供设计系统使用。
 * 支持代理、缓存（24h）。
 */

import { NextResponse } from "next/server";

interface GoogleFontItem {
  family: string;
  category: string;
  variants: string[];
}

interface FontsCache {
  fonts: GoogleFontItem[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let fontsCache: FontsCache | null = null;

export async function GET() {
  const apiKey = process.env.GOOGLE_FONTS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_FONTS_API_KEY not configured", fonts: [] },
      { status: 200 }
    );
  }

  if (fontsCache && Date.now() - fontsCache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ fonts: fontsCache.fonts, cached: true });
  }

  try {
    const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity`;
    const res = await fetch(url);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Google Fonts API error: ${res.status}`, fonts: fontsCache?.fonts ?? [] },
        { status: 200 }
      );
    }

    const data = await res.json();
    const fonts: GoogleFontItem[] = (data.items ?? []).slice(0, 200).map((item: any) => ({
      family: item.family as string,
      category: item.category as string,
      variants: (item.variants ?? []) as string[],
    }));

    fontsCache = { fonts, fetchedAt: Date.now() };
    return NextResponse.json({ fonts, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: `fetch failed: ${(e as Error).message}`, fonts: fontsCache?.fonts ?? [] },
      { status: 200 }
    );
  }
}
