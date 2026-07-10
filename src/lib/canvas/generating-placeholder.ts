/**
 * 生图进行中占位图
 * @author：wangjunhua
 */

export const GENERATING_PLACEHOLDER_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ebe9df"/>
          <stop offset="100%" stop-color="#d6d2c4"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="160" cy="108" r="28" fill="none" stroke="#1b365d" stroke-width="3" stroke-dasharray="8 10" opacity="0.55">
        <animateTransform attributeName="transform" type="rotate" from="0 160 108" to="360 160 108" dur="1.2s" repeatCount="indefinite"/>
      </circle>
      <text x="160" y="168" text-anchor="middle" fill="#1b365d" font-size="13" font-family="ui-sans-serif,system-ui,sans-serif" opacity="0.7">生成中…</text>
    </svg>`
  );
