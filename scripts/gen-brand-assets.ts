/**
 * gen-brand-assets.ts —— 从 `src/lib/brand.ts` 的**同一份几何**生成全部静态品牌资产。
 *
 * 为什么要脚本：favicon / PWA 图标 / OG 图以前是手写的一份路径，改 UI 徽标时会悄悄分叉
 * （线上侧栏一个形、浏览器 tab 另一个形）。徽标几何只许改 `src/lib/brand.ts`，然后跑这个脚本。
 *
 * 用法：npx tsx scripts/gen-brand-assets.ts
 * 产出：public/icon.svg · icon-512.png · icon-192.png · icon-maskable-512.png ·
 *       apple-icon.png(180) · favicon.ico(48) · og.png(1200x630)
 *
 * 光栅化走系统 Chrome headless 截图（零依赖，不装 sharp/resvg）；favicon.ico 由 sips 转。
 * 注意：Chrome 截完图不一定自己退出 —— 所以是「后台起 → 轮询产物 → kill」这个套路。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { brandMarkSvg } from "../src/lib/brand";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PUB = join(import.meta.dirname, "..", "public");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 把一段 HTML 渲染成 PNG。Chrome 常不自退，故轮询产物文件再 kill。 */
async function shoot(html: string, out: string, w: number, h: number) {
  const dir = mkdtempSync(join(tmpdir(), "brand-"));
  const page = join(dir, "page.html");
  writeFileSync(page, html);
  rmSync(out, { force: true });
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${join(dir, "profile")}`,
      // 页面底色必须**透明**：徽标底板是 rx=116 的圆角矩形，圆角外那几个像素会露出页面底色。
      // 默认是不透明白 → favicon / PWA 图标带一圈白角，而站内 SVG 是透明角，两者就不一致了（已踩）。
      "--default-background-color=00000000",
      `--screenshot=${out}`,
      `--window-size=${w},${h}`,
      "--force-device-scale-factor=1",
      `file://${page}`,
    ],
    { stdio: "ignore" },
  );
  try {
    for (let i = 0; i < 60; i++) {
      if (existsSync(out) && statSync(out).size > 0) {
        await sleep(250); // 等写盘落定
        break;
      }
      await sleep(300);
    }
    if (!existsSync(out)) throw new Error(`截图失败：${out}`);
  } finally {
    chrome.kill("SIGKILL");
    // 刚 kill 掉的 Chrome 还在往 profile 目录写盘，直接删会 ENOTEMPTY —— 等一下 + 重试，且不让
    // 清理失败打断产物生成（临时目录留在 /tmp 无害）。
    await sleep(400);
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      console.warn(`  （临时目录未清净，可忽略：${dir}）`);
    }
  }
  console.log(`  ✓ ${out.replace(PUB, "public")} (${w}x${h})`);
}

const pageFor = (svg: string, w: number, h: number, body = "") =>
  `<!doctype html><meta charset="utf-8"><style>
     html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden}
     svg{display:block;width:${w}px;height:${h}px}
   </style>${body || svg}`;

async function main() {
  // 1) icon.svg —— 真正的矢量源，浏览器 tab 首选它
  const iconSvg = brandMarkSvg({ size: 512 });
  writeFileSync(join(PUB, "icon.svg"), iconSvg + "\n");
  console.log("  ✓ public/icon.svg");

  // 2) 各尺寸 PNG：逐尺寸原生渲染（不是从 512 降采样——发丝环在小尺寸下才不会糊掉）
  for (const [file, size] of [
    ["icon-512.png", 512],
    ["icon-192.png", 192],
  ] as const) {
    await shoot(
      pageFor(brandMarkSvg({ size }), size, size),
      join(PUB, file),
      size,
      size,
    );
  }

  // 3) 满幅版（无圆角、无描边环，字形缩到 .82 落在 80% 安全圈内）：
  //    - maskable：PWA 规范要求满幅，系统自己裁形
  //    - apple-icon：iOS 主屏也自己套 squircle 蒙版，且**不认透明**（透明区会被合成成黑）。
  //      所以苹果这张不能带自己的圆角 + 透明角，否则圆角被套两次、角落发黑。
  for (const [file, size] of [
    ["icon-maskable-512.png", 512],
    ["apple-icon.png", 180],
  ] as const) {
    await shoot(
      pageFor(brandMarkSvg({ size, bleed: true, glyphScale: 0.82 }), size, size),
      join(PUB, file),
      size,
      size,
    );
  }

  // 4) favicon.ico(48)：先渲 PNG，再 sips 转 ico
  const tmpPng = join(PUB, ".favicon-tmp.png");
  await shoot(pageFor(brandMarkSvg({ size: 48 }), 48, 48), tmpPng, 48, 48);
  // sips 的格式短名是 `ico`（`sips --formats` 里 com.microsoft.ico → ico），不是 microsoft-icon
  const ico = spawnSync("sips", [
    "-s",
    "format",
    "ico",
    tmpPng,
    "--out",
    join(PUB, "favicon.ico"),
  ]);
  rmSync(tmpPng, { force: true });
  if (ico.status !== 0)
    throw new Error(`sips 转 ico 失败：${ico.stderr?.toString() ?? ""}`);
  console.log("  ✓ public/favicon.ico (48x48)");

  // 5) og.png —— 分享卡（1200x630），沿用原版式，只换徽标
  const og = `<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:PF;src:local("PingFang SC")}
    html,body{margin:0;width:1200px;height:630px;overflow:hidden}
    body{background:#0b0d12;font-family:PF,-apple-system,"PingFang SC",sans-serif;color:#fff}
    .frame{position:absolute;inset:24px;border:1px solid #23262e;border-radius:20px;
           background:radial-gradient(900px 420px at 88% 8%, rgba(245,166,35,.13), transparent 62%)}
    .wrap{position:absolute;inset:0;padding:72px 88px;display:flex;flex-direction:column}
    .top{display:flex;align-items:center;gap:26px}
    .top svg{width:104px;height:104px}
    .top b{font-size:76px;font-weight:800;letter-spacing:4px;line-height:1}
    .rule{width:104px;height:6px;background:#f5a623;border-radius:3px;margin:44px 0 30px}
    h1{font-size:44px;font-weight:800;margin:0;letter-spacing:1px}
    p{font-size:27px;line-height:1.62;color:#c9ccd4;margin:20px 0 0;max-width:930px}
    .foot{margin-top:auto;display:flex;align-items:baseline;justify-content:space-between}
    .foot a{color:#f5a623;font-size:25px;font-weight:700}
    .foot span{color:#8a8c93;font-size:24px;letter-spacing:2px}
  </style>
  <div class="frame"></div>
  <div class="wrap">
    <div class="top">${brandMarkSvg({ size: 104 })}<b>解牛</b></div>
    <div class="rule"></div>
    <h1>聚焦式一手财经资讯 · 大师视角解读</h1>
    <p>私人投研工作台 —— 只覆盖最热门板块的核心个股，一手公告与重磅资讯第一时间触达，配 AI 投资逻辑，盯住自选股真正发生变化的时刻。</p>
    <div class="foot"><a>jieniu.swaylab.ai</a><span>一手 · 聚焦 · 大师解读</span></div>
  </div>`;
  await shoot(og, join(PUB, "og.png"), 1200, 630);

  console.log("品牌资产已全部重新生成。");
}

void main();
