import { avatarGradient, avatarInitial } from "~/lib/brand";
import { type ResolvedAvatar } from "~/lib/avatar";
import { AvatarImage } from "./avatar-image";

/**
 * 用户头像 —— 全 App 统一（侧栏账号块、我的组合、设置）。
 *
 * 三档，优先级由 `resolveAvatar` 在服务端判定好后经 `avatar` 传进来：
 * ① 上传的照片 ② 用户自选的渐变色 + 显示字 ③ 按邮箱稳定散列的默认渐变盘（`avatar` 缺省时的行为）。
 *
 * 为什么默认不是原来那块琥珀方片：① 琥珀是**唯一强调色**，一屏只该服务一个焦点，头像天天挂在
 * 侧栏底部却和徽标抢同一个色（见 DESIGN.md 琥珀铁律）；② DESIGN.md 规定头像走 `rounded-full`，
 * 方片是漂移。所以是「深色渐变圆盘 + 发丝环 + 轻投影」——色板全是深调，白字在每色上都 ≥5.5:1（AA）。
 *
 * 渐变走 inline style：色值来自散列或用户选择，Tailwind 无法静态提取任意色的 class。
 */
export function UserAvatar({
  seed,
  avatar,
  className = "h-8 w-8 text-[13px]",
}: {
  /** 没有 `avatar` 时的取色与首字母种子：邮箱（无邮箱时传 null，落到「解」+ 默认色）。 */
  seed?: string | null;
  /** 服务端判定好的头像。缺省 = 老行为（纯散列），保证任何未改造的调用点照旧工作。 */
  avatar?: ResolvedAvatar | null;
  /** 尺寸与字号；形状（圆 / 环 / 投影）由组件锁定，调用方别覆盖。 */
  className?: string;
}) {
  const resolved: ResolvedAvatar = avatar ?? glyphFromSeed(seed);

  if (resolved.kind === "image") {
    return (
      <AvatarImage
        src={resolved.src}
        className={className}
        fallback={<Glyph glyph={glyphFromSeed(seed)} className={className} />}
      />
    );
  }
  return <Glyph glyph={resolved} className={className} />;
}

type GlyphAvatar = Extract<ResolvedAvatar, { kind: "glyph" }>;

function glyphFromSeed(seed: string | null | undefined): GlyphAvatar {
  const [from, to] = avatarGradient(seed ?? "解牛");
  return { kind: "glyph", from, to, text: avatarInitial(seed) };
}

function Glyph({
  glyph,
  className,
}: {
  glyph: GlyphAvatar;
  className: string;
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,.35)] ring-1 ring-white/15 ${className}`}
      style={{
        backgroundImage: `linear-gradient(140deg, ${glyph.from}, ${glyph.to})`,
        textShadow: "0 1px 2px rgba(0,0,0,.28)",
      }}
    >
      {/* 两个字要在 32px 的圆里放得下：按 em 缩，随调用方给的字号一起走，不写死 px。 */}
      <span style={[...glyph.text].length > 1 ? { fontSize: "0.76em" } : undefined}>
        {glyph.text}
      </span>
    </span>
  );
}
