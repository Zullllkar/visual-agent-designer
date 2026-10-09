/**
 * 桌面冷启动闪屏：选框自绘 + 慢速蚂蚁线，等待 sidecar 时保持动画。
 */

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splashDataUrl(message, chrome) {
  const background = chrome?.background ?? "#edeef1";
  const ink = chrome?.ink ?? "#141416";
  const accent = chrome?.accent ?? "#141416";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vibeboard</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      background: ${background};
      color: ${ink};
      font: 15px/1.45 "Segoe UI", system-ui, sans-serif;
      -webkit-app-region: drag;
      user-select: none;
    }
    .stage {
      display: grid;
      justify-items: center;
      gap: 1.25rem;
      padding: 2rem;
      text-align: center;
    }
    .logo {
      position: relative;
      width: 96px;
      height: 96px;
      display: grid;
      place-items: center;
      animation: enter 1100ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .halo {
      position: absolute;
      inset: -18px;
      border-radius: 36px;
      background: radial-gradient(circle at 50% 42%, rgba(201,107,92,0.26), transparent 66%);
      animation: halo 5.4s ease-in-out 0.4s infinite;
      pointer-events: none;
    }
    .mark {
      position: relative;
      width: 56px;
      height: 56px;
      color: ${ink};
    }
    .frame {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 100;
      stroke-dashoffset: 100;
      animation: draw 1080ms cubic-bezier(0.22, 1, 0.36, 1) 0.12s forwards;
    }
    .ants {
      fill: none;
      stroke: ${accent};
      stroke-width: 1.45;
      stroke-linecap: round;
      stroke-dasharray: 7 12;
      opacity: 0;
      animation: antsIn 420ms ease 980ms forwards, ants 11s linear 980ms infinite;
    }
    .handle {
      transform-box: fill-box;
      transform-origin: center;
      opacity: 0;
      animation: handleIn 640ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .h-tl { animation-delay: 0.58s; }
    .h-tr { animation-delay: 0.68s; }
    .h-bl { animation-delay: 0.78s; }
    .h-br { animation-delay: 0.88s; }
    .tile {
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      animation: tileIn 720ms cubic-bezier(0.16, 1, 0.3, 1) 0.72s forwards;
    }
    .copy {
      display: grid;
      gap: 0.4rem;
      animation: enter 1000ms cubic-bezier(0.16, 1, 0.3, 1) 0.22s both;
    }
    .title {
      font-size: 1.05rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }
    .msg {
      min-height: 1.4em;
      font-size: 13px;
      color: color-mix(in srgb, ${ink} 72%, ${background});
    }
    .bar {
      width: 168px;
      height: 1px;
      overflow: hidden;
      border-radius: 999px;
      background: color-mix(in srgb, ${ink} 12%, transparent);
      animation: enter 900ms cubic-bezier(0.16, 1, 0.3, 1) 0.38s both;
    }
    .bar i {
      display: block;
      width: 100%;
      height: 100%;
      background: linear-gradient(
        90deg,
        transparent 0%,
        color-mix(in srgb, ${accent} 35%, transparent) 28%,
        ${accent} 50%,
        color-mix(in srgb, ${accent} 35%, transparent) 72%,
        transparent 100%
      );
      animation: shimmer 2.4s cubic-bezier(0.45, 0, 0.55, 1) 0.6s infinite;
    }
    @keyframes enter {
      from { opacity: 0; transform: translateY(10px); filter: blur(8px); }
      to { opacity: 1; transform: none; filter: blur(0); }
    }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes antsIn { to { opacity: 0.9; } }
    @keyframes ants { to { stroke-dashoffset: -190; } }
    @keyframes handleIn {
      from { opacity: 0; transform: scale(0.45); }
      to { opacity: 1; transform: none; }
    }
    @keyframes tileIn {
      from { opacity: 0; transform: scale(0.86); }
      to { opacity: 1; transform: none; }
    }
    @keyframes halo {
      0%, 100% { opacity: 0.28; }
      50% { opacity: 0.72; }
    }
    @keyframes shimmer {
      from { transform: translateX(-100%); }
      to { transform: translateX(100%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .logo, .halo, .copy, .bar, .bar i, .frame, .ants, .handle, .tile {
        animation: none !important;
      }
      .frame { stroke-dashoffset: 0; }
      .ants, .handle, .tile { opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="stage">
    <div class="logo" aria-hidden="true">
      <span class="halo"></span>
      <svg class="mark" viewBox="0 0 32 32" fill="none">
        <rect class="frame" pathLength="100" x="7" y="7" width="18" height="18" rx="2.2"/>
        <rect class="ants" pathLength="100" x="7" y="7" width="18" height="18" rx="2.2"/>
        <rect class="handle h-tl" x="5.15" y="5.15" width="3.7" height="3.7" rx="0.35" fill="currentColor"/>
        <rect class="handle h-tr" x="23.15" y="5.15" width="3.7" height="3.7" rx="0.35" fill="currentColor"/>
        <rect class="handle h-bl" x="5.15" y="23.15" width="3.7" height="3.7" rx="0.35" fill="currentColor"/>
        <rect class="handle h-br" x="23.15" y="23.15" width="3.7" height="3.7" rx="0.35" fill="currentColor"/>
        <rect class="tile" x="13.6" y="14.6" width="8.4" height="7" rx="1.1" fill="currentColor"/>
      </svg>
    </div>
    <div class="copy">
      <div class="title">Vibeboard</div>
      <div class="msg" id="splash-msg">${escapeHtml(message)}</div>
    </div>
    <div class="bar" aria-hidden="true"><i></i></div>
  </div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

module.exports = { splashDataUrl, escapeHtml };
