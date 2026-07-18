import { sparklineCoords } from "~/lib/spark";

/**
 * 迷你走势图（纯展示，服务端可渲染，无外部依赖）。灵感：Robinhood 极简走势图。
 * 按区间首尾着色（红涨绿跌，随暗色翻转）；面积浅填 + 非缩放描边 +
 * 起点基准虚线 + 末端发光点（HTML 叠加，规避 SVG 非等比缩放把圆压扁）。
 * 红绿仅用于真实价格涨跌，符合颜色铁律。
 */
export function Sparkline({
  values,
  ariaLabel = "走势",
}: {
  values: number[];
  ariaLabel?: string;
}) {
  const W = 260;
  const H = 56;
  const PAD = 4;
  const coords = sparklineCoords(values, W, H, PAD);
  if (coords.length < 2) return null;

  const up = values[values.length - 1]! >= values[0]!;
  const line = coords
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const stroke = up ? "stroke-up" : "stroke-down";
  const fill = up ? "fill-up" : "fill-down";
  const dot = up ? "bg-up ring-up/20" : "bg-down ring-down/20";
  const last = coords[coords.length - 1]!;
  const baseY = coords[0]!.y;

  return (
    <div className="relative mt-3 h-14 w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <polygon points={area} className={fill} opacity={0.1} />
        <line
          x1={0}
          y1={baseY}
          x2={W}
          y2={baseY}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          className="text-muted"
          opacity={0.45}
        />
        <polyline
          points={line}
          fill="none"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
          className={stroke}
        />
      </svg>
      <span
        className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ${dot}`}
        style={{ left: `${(last.x / W) * 100}%`, top: `${(last.y / H) * 100}%` }}
        aria-hidden
      />
    </div>
  );
}
