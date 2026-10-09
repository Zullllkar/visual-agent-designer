import type { CanvasNode, CanvasPage } from "./schema";

/**
 * SVG Canvas Renderer
 * --------------------------------------------------------------
 * 第一阶段渲染器；输入 CanvasPage，输出 <svg/>。
 * Konva 渲染器在下一轮接入，会复用同一份 schema。
 *
 * 注意 fontFamily 需要包含中文字体名称：浏览器里 Tailwind/系统字体能 fallback，
 * 但当 SVG 被 resvg 服务端 rasterize 时，必须显式列出中文字体（PingFang SC /
 * Microsoft YaHei / Noto Sans SC），否则中文字符会被渲染成方框。
 */
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Hiragino Sans GB', sans-serif";
const SERIF_STACK =
  "Georgia, Cambria, 'Times New Roman', 'Songti SC', 'STSong', 'SimSun', 'Songti TC', serif";

export function CanvasSvg({
  page,
  scale = 1,
  selectedNodeId,
  onNodeSelect,
}: {
  page: CanvasPage;
  scale?: number;
  selectedNodeId?: string;
  onNodeSelect?: (node: CanvasNode) => void;
}) {
  return (
    <svg
      width={page.width * scale}
      height={page.height * scale}
      viewBox={`0 0 ${page.width} ${page.height}`}
      role="img"
      aria-label={page.name}
      style={{ display: "block" }}
    >
      <rect
        x={0}
        y={0}
        width={page.width}
        height={page.height}
        fill={page.background ?? "#FFFFFF"}
      />
      {page.nodes.map((node) => (
        <NodeRenderer
          key={node.id}
          node={node}
          selected={selectedNodeId === node.id}
          onSelect={onNodeSelect}
        />
      ))}
    </svg>
  );
}

function NodeRenderer({
  node,
  selected,
  onSelect,
}: {
  node: CanvasNode;
  selected: boolean;
  onSelect?: (node: CanvasNode) => void;
}) {
  const content = renderNodeContent(node);
  return (
    <g
      data-node-id={node.id}
      onClick={
        onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect(node);
            }
          : undefined
      }
      style={{ cursor: onSelect ? "pointer" : "default" }}
    >
      {onSelect ? (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill="transparent"
          pointerEvents="all"
        />
      ) : null}
      {content}
      {selected ? (
        <rect
          x={node.x - 2}
          y={node.y - 2}
          width={node.width + 4}
          height={node.height + 4}
          fill="none"
          stroke="#141416"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          pointerEvents="none"
        />
      ) : null}
    </g>
  );
}

function renderNodeContent(node: CanvasNode) {
  switch (node.type) {
    case "frame":
      return (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill={node.fill ?? "transparent"}
          rx={node.radius ?? 0}
          ry={node.radius ?? 0}
        />
      );
    case "text":
      return renderTextBlock({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        content: node.content,
        fontSize: node.fontSize ?? 14,
        fontWeight: node.fontWeight ?? 400,
        color: node.color ?? "#111827",
        align: node.align,
        fontFamily: (node.fontSize ?? 14) >= 16 ? SERIF_STACK : FONT_STACK,
      });
    case "image":
      return (
        <g>
          {node.radius ? (
            <defs>
              <clipPath id={`clip-${node.id}`}>
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={node.radius}
                  ry={node.radius}
                />
              </clipPath>
            </defs>
          ) : null}
          <image
            href={node.src}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            preserveAspectRatio="xMidYMid slice"
            clipPath={node.radius ? `url(#clip-${node.id})` : undefined}
          />
        </g>
      );
    case "button":
      return (
        <g>
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill={node.fill ?? "#0F1E36"}
            rx={node.radius ?? 8}
            ry={node.radius ?? 8}
          />
          <text
            x={node.x + node.width / 2}
            y={node.y + node.height / 2 + 5}
            fill={node.color ?? "#ffffff"}
            fontSize={15}
            fontWeight={600}
            textAnchor="middle"
            fontFamily={FONT_STACK}
          >
            {node.label}
          </text>
        </g>
      );
    case "card":
      return (
        <g>
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill={node.fill ?? "#ffffff"}
            rx={node.radius ?? 12}
            ry={node.radius ?? 12}
            stroke="#E1E8ED"
            strokeWidth={1}
          />
          {node.title ? (
            renderTextBlock({
              x: node.x + 16,
              y: node.y + 14,
              width: node.width - 32,
              height: 26,
              content: node.title,
              fontSize: 15,
              fontWeight: 600,
              color: "#09090B",
              fontFamily: SERIF_STACK,
            })
          ) : null}
          {node.body ? (
            renderTextBlock({
              x: node.x + 16,
              y: node.y + 40,
              width: node.width - 32,
              height: Math.max(24, node.height - 56),
              content: node.body,
              fontSize: 12,
              color: "#6B7280",
            })
          ) : null}
        </g>
      );
  }
}

function renderTextBlock({
  x,
  y,
  width,
  height,
  content,
  fontSize,
  fontWeight = 400,
  color,
  align = "left",
  fontFamily,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontSize: number;
  fontWeight?: number;
  color: string;
  align?: "left" | "center" | "right";
  fontFamily?: string;
}) {
  const lineHeight = Math.round(fontSize * 1.25);
  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  const lines = wrapText(content, width, fontSize, maxLines);
  const textX =
    align === "center" ? x + width / 2 : align === "right" ? x + width : x;
  const anchor =
    align === "center" ? "middle" : align === "right" ? "end" : "start";

  return (
    <text
      x={textX}
      y={y + fontSize}
      fill={color}
      fontSize={fontSize}
      fontWeight={fontWeight}
      textAnchor={anchor}
      fontFamily={fontFamily ?? FONT_STACK}
    >
      {lines.map((line, index) => (
        <tspan key={`${line}-${index}`} x={textX} dy={index === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function wrapText(
  content: string,
  width: number,
  fontSize: number,
  maxLines: number
): string[] {
  const maxChars = Math.max(1, Math.floor(width / Math.max(fontSize * 0.56, 6)));
  const units = Array.from(content);
  const lines: string[] = [];
  let current = "";

  for (const unit of units) {
    if ((current + unit).length > maxChars) {
      lines.push(current);
      current = unit;
      if (lines.length === maxLines) break;
    } else {
      current += unit;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length > 0 && units.join("").length > lines.join("").length) {
    lines[lines.length - 1] = truncateLine(lines[lines.length - 1], maxChars);
  }
  return lines.length > 0 ? lines : [""];
}

function truncateLine(line: string, maxChars: number) {
  if (maxChars <= 1) return "…";
  return `${line.slice(0, Math.max(0, maxChars - 1))}…`;
}
