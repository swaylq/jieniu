/**
 * verify-avatar.ts — 头像功能的端到端自测（真浏览器、真上传、真落库）。
 *
 * 为什么要有这个：裁剪 / 上传这条链路是纯交互的，单测与 `tsc` 全绿也证明不了「人点进去能用」。
 * 而每条断言都带一个「动作真的发生了」的锚点（文件输入被接受、URL 变了、库里写没写），
 * 不是只看结果——「动作没发生」和「行为不对」在结果上完全同形。
 *
 * 用法（先起隔离 dev：`NEXT_DIST_DIR=.next-dev npx next dev -p 3939`）：
 *   env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" \
 *     SHOT_BASE=http://localhost:3939 npx tsx scripts/verify-avatar.ts
 *
 * 用**自建的一次性账号**跑，跑完删掉——绝不碰真实用户的数据。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

import { PrismaClient } from "../generated/prisma";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3939";
const PORT = Number(process.env.CDP_PORT ?? 9700 + (process.pid % 200));
const EMAIL = "avatar-e2e@jieniu.test";
/** 视口。移动端那一遍不是可选项——只在桌面验收过的 UI 改动，我们已经栽过。 */
const W = Number(process.env.SHOT_W ?? 1440);
const H = Number(process.env.SHOT_H ?? 900);
/** 设了就顺手截图（`SHOT_DIR=/tmp/x`），文件名带视口宽度。 */
const SHOT_DIR = process.env.SHOT_DIR ?? "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hashCode = (s: string) => createHash("sha256").update(s).digest("hex");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

type Send = (method: string, params?: Record<string, unknown>) => Promise<any>;

async function waitEndpoint(url: string, tries = 60): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* chrome 还没起来 */
    }
    await sleep(120);
  }
  throw new Error("chrome CDP endpoint timeout");
}

/** 轮询到条件成立为止；返回是否成立（超时不抛，交给 check 报告）。 */
async function until(
  S: Send,
  expr: string,
  ms = 8000,
): Promise<unknown> {
  const deadline = Date.now() + ms;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true });
    last = r.result?.value;
    if (last) return last;
    await sleep(200);
  }
  return last;
}

async function main() {
  const db = new PrismaClient();
  const tmp = mkdtempSync(join(tmpdir(), "avatar-e2e-"));
  const userDataDir = mkdtempSync(join(tmpdir(), "avatar-chrome-"));

  // 一次性账号：全程只动它，跑完删掉。
  await db.user.deleteMany({ where: { email: EMAIL } });
  const user = await db.user.create({ data: { email: EMAIL, name: "E2E" } });
  console.log(`测试账号 ${EMAIL} (${user.id})`);

  // 造一张竖构图（1000×1500）——正是「居中裁剪会切头」那种，能验证拖动/缩放真的接上了。
  const photo = join(tmp, "portrait.png");
  writeFileSync(
    photo,
    await sharp({
      create: { width: 1000, height: 1500, channels: 3, background: "#1e6f5c" },
    })
      .png()
      .toBuffer(),
  );

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--disable-gpu",
      `--window-size=${W},${H}`,
    ],
    { stdio: "ignore" },
  );

  try {
    const version = await waitEndpoint(`http://127.0.0.1:${PORT}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = () => res(null);
      ws.onerror = (e) => rej(e as unknown as Error);
    });

    let msgId = 0;
    const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
    const listeners = new Set<(m: any) => void>();
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id)!;
        pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method) {
        for (const l of listeners) l(m);
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
      new Promise<any>((res, rej) => {
        const id = ++msgId;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });

    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S: Send = (method, params = {}) => send(method, params, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("DOM.enable");
    await S("Emulation.setDeviceMetricsOverride", {
      width: W,
      height: H,
      deviceScaleFactor: 2,
      mobile: W < 640,
    });

    if (process.env.SHOT_DARK === "1") {
      await S("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "dark" }],
      });
    }

    const shot = async (name: string) => {
      if (!SHOT_DIR) return;
      const r = await S("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(SHOT_DIR, `${name}-${W}.png`), Buffer.from(r.data, "base64"));
    };

    const nav = async (url: string) => {
      const done = new Promise((r) => {
        const l = (m: any) => {
          if (m.method === "Page.loadEventFired") {
            listeners.delete(l);
            r(null);
          }
        };
        listeners.add(l);
      });
      await S("Page.navigate", { url });
      await Promise.race([done, sleep(20000)]);
      await sleep(900);
    };

    // 走项目真实的登录流程（播种 OTP → credentials callback），不手工铸 cookie。
    const code = "424242";
    await db.verificationToken.deleteMany({ where: { identifier: EMAIL } });
    await db.verificationToken.create({
      data: {
        identifier: EMAIL,
        token: hashCode(`${EMAIL}:${code}`),
        expires: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    await nav(`${BASE}/api/auth/csrf`);
    const csrfRes = await S("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    const csrf = JSON.parse(String(csrfRes.result.value)).csrfToken as string;
    await S("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `fetch("${BASE}/api/auth/callback/credentials",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrfToken:${JSON.stringify(
        csrf,
      )},email:${JSON.stringify(EMAIL)},code:"${code}",callbackUrl:"${BASE}",json:"true"}),credentials:"same-origin"}).then(r=>r.status)`,
    });

    // ── 1. 默认态：三处都是渐变盘，一张 <img> 都不该有 ────────────────────────────
    await nav(`${BASE}/settings/avatar`);
    const loggedIn = await until(
      S,
      `!!document.querySelector('input[type=file]') && "ok"`,
    );
    check("登录成功、编辑器渲染出来了", loggedIn === "ok", String(loggedIn));
    const defaultImgs = await S("Runtime.evaluate", {
      expression: `document.querySelectorAll('img[src^="/api/avatar/"]').length`,
      returnByValue: true,
    });
    check("默认态没有任何上传头像", defaultImgs.result?.value === 0);
    await shot("editor-default");

    // ── 2. 上传：把文件塞进隐藏 input，出现取景框才算「动作真的发生了」 ───────────
    const { root } = await S("DOM.getDocument");
    const { nodeId } = await S("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    });
    await S("DOM.setFileInputFiles", { files: [photo], nodeId });
    const cropped = await until(
      S,
      `!!document.querySelector('img[alt="待裁剪的头像"]') && "ok"`,
    );
    check("选中文件后出现圆形取景框（React 收到了 change）", cropped === "ok", String(cropped));

    // 放大一点 + 往下拖，验证 zoom / 平移这条路真的能改到出图（而不是永远居中裁剪）。
    await S("Runtime.evaluate", {
      expression: `(() => {
        const box = document.querySelector('img[alt="待裁剪的头像"]').parentElement;
        const r = box.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const opt = (t, x, y) => new PointerEvent(t, {bubbles:true, pointerId:1, clientX:x, clientY:y, isPrimary:true});
        box.setPointerCapture = () => {}; box.releasePointerCapture = () => {}; box.hasPointerCapture = () => false;
        box.dispatchEvent(opt('pointerdown', cx, cy));
        box.dispatchEvent(opt('pointermove', cx, cy + 60));
        box.dispatchEvent(opt('pointerup', cx, cy + 60));
        return "dragged";
      })()`,
      returnByValue: true,
    });
    const moved = await S("Runtime.evaluate", {
      expression: `getComputedStyle(document.querySelector('img[alt="待裁剪的头像"]')).transform`,
      returnByValue: true,
    });
    check(
      "拖动改变了图片位置（不是死图）",
      typeof moved.result?.value === "string" && !/matrix\(1, 0, 0, 1, [^,]+, 0\)/.test(String(moved.result.value)),
      String(moved.result?.value).slice(0, 60),
    );
    await shot("crop");

    await S("Runtime.evaluate", {
      expression: `[...document.querySelectorAll('button')].find(b => b.textContent.includes('保存这张')).click()`,
      returnByValue: true,
    });
    const savedSrc = await until(
      S,
      `(document.querySelector('img[src^="/api/avatar/"]') || {}).src || ""`,
      15000,
    );
    check("保存后页面上出现上传头像", String(savedSrc).includes("/api/avatar/"), String(savedSrc));
    check("URL 带内容版本号 ?v=", /\?v=[0-9a-f]{8}$/.test(String(savedSrc)), String(savedSrc));

    const dbRow = await db.user.findUnique({
      where: { id: user.id },
      select: { image: true },
    });
    check("库里记下了同一个 URL", !!dbRow?.image && String(savedSrc).endsWith(dbRow.image), dbRow?.image ?? "null");

    const head = await fetch(String(savedSrc));
    check("头像 URL 真的能拉到图", head.status === 200, `http=${head.status}`);
    check(
      "响应类型是 image/webp 且可长缓存",
      head.headers.get("content-type") === "image/webp" &&
        (head.headers.get("cache-control") ?? "").includes("immutable"),
      `${head.headers.get("content-type")} / ${head.headers.get("cache-control")}`,
    );
    const bytes = Buffer.from(await head.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    check(
      "落盘尺寸是 256×256",
      meta.width === 256 && meta.height === 256,
      `${meta.width}×${meta.height} ${(bytes.byteLength / 1024).toFixed(1)}KB`,
    );

    await shot("uploaded");

    // 侧栏（另一处调用点）也得换掉——这才是「全站一致」的证据。侧栏 md 以下不渲染，
    // 所以这条断言只在桌面视口成立；移动端换成「页头那处也换了」。
    const desktop = W >= 768;
    if (desktop) {
      const sidebar = await until(
        S,
        `(document.querySelector('aside img[src^="/api/avatar/"]') || {}).src || ""`,
      );
      check("桌面侧栏账号块也换成了照片", String(sidebar).includes("/api/avatar/"), String(sidebar));
    }

    await nav(`${BASE}/profile`);
    const wantImgs = desktop ? 2 : 1;
    const onProfile = await until(
      S,
      `document.querySelectorAll('img[src^="/api/avatar/"]').length >= ${wantImgs} ? "ok" : ""`,
    );
    check(
      desktop ? "我的组合页（页头 + 侧栏）也换了" : "我的组合页页头也换了",
      onProfile === "ok",
      String(onProfile),
    );
    await shot("profile");

    // ── 3. 文字头像：应清掉照片、显示自定义字 ────────────────────────────────────
    await nav(`${BASE}/settings/avatar`);
    await S("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector('input[type="text"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '张楚');
        input.dispatchEvent(new Event('input', {bubbles:true}));
        document.querySelector('button[aria-label="底色 3"]').click();
        return "typed";
      })()`,
      returnByValue: true,
    });
    await S("Runtime.evaluate", {
      expression: `[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('用这个')).click()`,
      returnByValue: true,
    });
    const presetSaved = await until(
      S,
      `document.querySelectorAll('img[src^="/api/avatar/"]').length === 0 && document.body.innerText.includes('文字头像已保存') ? "ok" : ""`,
      15000,
    );
    check("存文字头像后照片消失、提示已保存", presetSaved === "ok", String(presetSaved));

    const afterPreset = await db.user.findUnique({
      where: { id: user.id },
      select: { image: true, avatarColor: true, avatarChar: true },
    });
    check(
      // 点的是「底色 3」（给人看的 1-based 标签），存的是 0-based 下标 2。
      "库里：照片清空、色号与字存下",
      afterPreset?.image === null &&
        afterPreset?.avatarColor === 2 &&
        afterPreset?.avatarChar === "张楚",
      JSON.stringify(afterPreset),
    );

    const gone = await fetch(String(savedSrc));
    check("旧照片文件已删除（404）", gone.status === 404, `http=${gone.status}`);

    const scope = desktop ? "aside" : "main";
    const glyph = await until(
      S,
      `(document.querySelector(${JSON.stringify(scope)})?.innerText.includes('张楚')) ? "ok" : ""`,
    );
    check(`${desktop ? "侧栏" : "页面"}渲染的是自定义字`, glyph === "ok", String(glyph));
    await shot("preset");

    // ── 4. 恢复默认 ─────────────────────────────────────────────────────────────
    await S("Runtime.evaluate", {
      expression: `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '恢复默认').click()`,
      returnByValue: true,
    });
    const reset = await until(
      S,
      `document.body.innerText.includes('已恢复默认头像') ? "ok" : ""`,
      15000,
    );
    check("点了恢复默认有反馈", reset === "ok", String(reset));
    const afterReset = await db.user.findUnique({
      where: { id: user.id },
      select: { image: true, avatarColor: true, avatarChar: true },
    });
    check(
      "库里三个字段全清",
      afterReset?.image === null &&
        afterReset?.avatarColor === null &&
        afterReset?.avatarChar === null,
      JSON.stringify(afterReset),
    );

    await nav(`${BASE}/settings`);
    const entry = await until(
      S,
      `document.body.innerText.includes('更换头像') ? "ok" : ""`,
    );
    check("设置页有「更换头像」入口", entry === "ok", String(entry));
    await shot("settings");

    // ── 5. 目录穿越 ─────────────────────────────────────────────────────────────
    const traversal = await fetch(`${BASE}/api/avatar/${encodeURIComponent("../../package.json")}`);
    check("路径穿越被挡", traversal.status === 404, `http=${traversal.status}`);
  } finally {
    chrome.kill();
    await sleep(300); // Chrome 还在往 user-data-dir 里写，太早删会 ENOTEMPTY
    for (const d of [userDataDir, tmp]) {
      try {
        rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* 临时目录清不掉不算失败，别掩盖真正的结论 */
      }
    }
    await db.user.deleteMany({ where: { email: EMAIL } });
    await db.verificationToken.deleteMany({ where: { identifier: EMAIL } });
    await db.$disconnect();
  }

  console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
