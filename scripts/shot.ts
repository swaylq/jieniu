/**
 * shot.ts — 可复用「登录 + 截图」工具（UI/UX 改造循环用）。零依赖：直接用系统 Chrome + CDP（Node 全局 WebSocket/fetch）。
 * 用法：
 *   env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx scripts/shot.ts <path> <out.png> [WxH] [--login=email] [--full] [--dark]
 * 例：
 *   ... scripts/shot.ts / home-pc.png 1440x900 --login=swaylq0913@gmail.com
 *   ... scripts/shot.ts /profile prof-m.png 390x844 --login=swaylq0913@gmail.com --full --dark
 * 登录：给 VerificationToken 播种一个已知 OTP（token=sha256(email:code)），再走 NextAuth credentials callback 拿 JWT session cookie——不发邮件、不依赖 devCode。
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "../generated/prisma";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.SHOT_BASE ?? "http://localhost:3838";
const PORT = Number(process.env.CDP_PORT ?? 9300 + (process.pid % 400));
const hashCode = (s: string) => createHash("sha256").update(s).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const path = argv[0] ?? "/";
const out = argv[1] ?? "shot.png";
const dim = argv.find((a) => /^\d+x\d+$/.test(a)) ?? "1440x900";
const [w, h] = dim.split("x").map(Number);
const loginArg = argv.find((a) => a.startsWith("--login="));
const email = loginArg ? loginArg.slice("--login=".length).toLowerCase() : null;
const full = argv.includes("--full");
const dark = argv.includes("--dark");
const mobile = w < 640;

async function waitEndpoint(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(120);
  }
  throw new Error("chrome CDP endpoint timeout");
}

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), "shot-chrome-"));
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
      `--window-size=${w},${h}`,
    ],
    { stdio: "ignore" },
  );

  try {
    const version = await waitEndpoint(`http://127.0.0.1:${PORT}/json/version`);
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = () => res(null);
      ws.onerror = (e) => rej(e);
    });

    let msgId = 0;
    const pending = new Map();
    const listeners = new Set<(m: any) => void>();
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        for (const l of listeners) l(m);
      }
    };
    const send = (method, params = {}, sessionId?) =>
      new Promise<any>((res, rej) => {
        const id = ++msgId;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });

    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const S = (method, params = {}) => send(method, params, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: 2,
      mobile,
    });
    if (dark) {
      await S("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "dark" }],
      });
    }

    const nav = async (url) => {
      const done = new Promise((r) => {
        const l = (m) => {
          if (m.method === "Page.loadEventFired") {
            listeners.delete(l);
            r(null);
          }
        };
        listeners.add(l);
      });
      await S("Page.navigate", { url });
      await Promise.race([done, sleep(15000)]);
      await sleep(750);
    };

    if (email) {
      const db = new PrismaClient();
      const code = "424242";
      await db.verificationToken.deleteMany({ where: { identifier: email } });
      await db.verificationToken.create({
        data: {
          identifier: email,
          token: hashCode(`${email}:${code}`),
          expires: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      await db.$disconnect();

      await nav(`${BASE}/api/auth/csrf`);
      const csrfRes = await S("Runtime.evaluate", {
        expression: "document.body.innerText",
        returnByValue: true,
      });
      const csrf = JSON.parse(csrfRes.result.value).csrfToken;
      const expr = `fetch(${JSON.stringify(BASE)}+"/api/auth/callback/credentials",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrfToken:${JSON.stringify(
        csrf,
      )},email:${JSON.stringify(email)},code:${JSON.stringify(
        code,
      )},callbackUrl:${JSON.stringify(BASE)},json:"true"}),credentials:"same-origin"}).then(r=>r.status)`;
      await S("Runtime.evaluate", {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
    }

    await nav(`${BASE}${path}`);

    // --type=文本：往页面首个搜索输入框键入文本（React 受控 input：原生 setter + input 事件），
    // 等 tRPC 查询返回 + 渲染后再截图。用于截「搜索空态 / 自助加股入口」等需交互才出现的界面。
    const typeArg = argv.find((a) => a.startsWith("--type="));
    if (typeArg) {
      const text = typeArg.slice("--type=".length);
      await S("Runtime.evaluate", {
        expression: `(() => {
          const inp = document.querySelector('input[placeholder*="搜索"], input[type="search"], input[placeholder]');
          if (!inp) return "no-input";
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(inp, ${JSON.stringify(text)});
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          return "typed";
        })()`,
        returnByValue: true,
      });
      await sleep(2000);
    }

    let clip;
    if (full) {
      const lm = await S("Page.getLayoutMetrics");
      const cs = lm.cssContentSize ?? lm.contentSize;
      const fullH = Math.ceil(cs.height);
      await S("Emulation.setDeviceMetricsOverride", {
        width: w,
        height: fullH,
        deviceScaleFactor: 2,
        mobile,
      });
      clip = { x: 0, y: 0, width: w, height: fullH, scale: 1 };
      await sleep(300);
    }
    const shot = await S("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: full,
      ...(clip ? { clip } : {}),
    });
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    ws.close();
    console.log(
      `shot ${path} -> ${out} @ ${w}x${h}${email ? ` in:${email}` : ""}${full ? " full" : ""}${dark ? " dark" : ""}`,
    );
  } finally {
    chrome.kill("SIGKILL");
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

void main();
