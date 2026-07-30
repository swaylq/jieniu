import { avatarGradient, avatarInitial } from "~/lib/brand";

/**
 * 用户默认头像 —— 全 App 统一（侧栏账号块、我的组合、设置）。
 *
 * 为什么不是原来那块琥珀方片：① 琥珀是**唯一强调色**，一屏只该服务一个焦点，头像天天挂在
 * 侧栏底部却和徽标抢同一个色（见 DESIGN.md 琥珀铁律）；② DESIGN.md 规定头像走 `rounded-full`，
 * 方片是漂移。现在改为「由邮箱稳定散列取色的深色渐变圆盘 + 发丝环 + 轻投影」——同一用户永远
 * 同一色，可辨识；色板全是深调，白字在每色上都 ≥5.5:1（AA）。
 *
 * 渐变走 inline style：色值来自散列，Tailwind 无法静态提取任意色的 class。
 */
export function UserAvatar({
  seed,
  className = "h-8 w-8 text-[13px]",
}: {
  /** 取色与首字母的种子：邮箱（无邮箱时传 null，落到「解」+ 默认色）。 */
  seed: string | null | undefined;
  /** 尺寸与字号；形状（圆 / 环 / 投影）由组件锁定，调用方别覆盖。 */
  className?: string;
}) {
  const [from, to] = avatarGradient(seed ?? "解牛");
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,.35)] ring-1 ring-white/15 ${className}`}
      style={{
        backgroundImage: `linear-gradient(140deg, ${from}, ${to})`,
        textShadow: "0 1px 2px rgba(0,0,0,.28)",
      }}
    >
      {avatarInitial(seed)}
    </span>
  );
}
