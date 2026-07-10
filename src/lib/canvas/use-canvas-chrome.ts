"use client";

/**
 * 订阅 html.dark 切换，使画布 shape 在主题变化时重绘。
 * @author：wangjunhua
 */

import { useEffect, useState } from "react";
import {
  getCanvasChromePalette,
  type CanvasChromePalette,
} from "./canvas-chrome";

export function useCanvasChromePalette(): CanvasChromePalette {
  const [palette, setPalette] = useState(getCanvasChromePalette);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setPalette(getCanvasChromePalette());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return palette;
}
