import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

import {
  saveAvatarImage,
  readAvatarImage,
  deleteAvatarImage,
  decodeImageDataUrl,
  AVATAR_PIXELS,
} from "./avatar-store";

const UID = "cm3x8k2p90000abcdefghijkl";
const OTHER = "cm3x8k2p90000zyxwvutsrqpo";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jieniu-avatar-"));
  process.env.AVATAR_DIR = dir;
});

afterAll(async () => {
  delete process.env.AVATAR_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** 造一张真图（不是手写的字节），保证测的是 sharp 的真实行为。 */
async function png(w: number, h: number, bg = "#c83c28"): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .png()
    .toBuffer();
}

describe("saveAvatarImage — 任何尺寸进，256×256 WebP 出", () => {
  it("横构图被裁成正方形，落盘就是 256×256 WebP", async () => {
    const { version } = await saveAvatarImage(UID, await png(1200, 800));
    expect(version).toMatch(/^[0-9a-f]{8}$/);

    const out = await readAvatarImage(UID);
    expect(out).not.toBeNull();
    const meta = await sharp(out!).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(AVATAR_PIXELS);
    expect(meta.height).toBe(AVATAR_PIXELS);
  });

  it("小图也统一放大到 256（尺寸恒定，UI 不用操心）", async () => {
    await saveAvatarImage(UID, await png(64, 64));
    const meta = await sharp((await readAvatarImage(UID))!).metadata();
    expect(meta.width).toBe(AVATAR_PIXELS);
    expect(meta.height).toBe(AVATAR_PIXELS);
  });

  it("体积压在 60 KB 以内（头像挂在侧栏，天天要下载）", async () => {
    await saveAvatarImage(UID, await png(2000, 2000));
    const out = await readAvatarImage(UID);
    expect(out!.byteLength).toBeLessThan(60 * 1024);
  });

  it("内容变了 version 就变，内容一样 version 不变（URL 带 v= 做缓存键）", async () => {
    const a = await saveAvatarImage(UID, await png(300, 300));
    const b = await saveAvatarImage(UID, await png(300, 300));
    const c = await saveAvatarImage(UID, await png(300, 300, "#1e40af"));
    expect(a.version).toBe(b.version);
    expect(c.version).not.toBe(a.version);
  });

  it("重复保存不留临时文件（写 tmp + rename 的残渣）", async () => {
    await saveAvatarImage(UID, await png(500, 400));
    const files = await readdir(dir);
    expect(files.filter((f) => f.includes(".tmp"))).toHaveLength(0);
  });

  it("两个用户互不覆盖", async () => {
    await saveAvatarImage(UID, await png(100, 100));
    await saveAvatarImage(OTHER, await png(400, 200));
    expect(await readAvatarImage(UID)).not.toBeNull();
    expect(await readAvatarImage(OTHER)).not.toBeNull();
  });

  it("坏字节抛错，且不落盘（半张图比没有更糟）", async () => {
    const before = (await readdir(dir)).sort();
    await expect(
      saveAvatarImage("cm3x8k2p90000broken00000a", Buffer.from("not an image")),
    ).rejects.toThrow();
    expect((await readdir(dir)).sort()).toEqual(before);
  });

  it("非法 userId 一律拒绝——拼路径前的最后一道闸", async () => {
    await expect(saveAvatarImage("../../etc/passwd", await png(10, 10))).rejects.toThrow(
      /userId/,
    );
    await expect(readAvatarImage("../../etc/passwd")).resolves.toBeNull();
  });
});

describe("readAvatarImage / deleteAvatarImage", () => {
  it("没存过的用户读出来是 null，不是抛错（路由要据此返 404）", async () => {
    expect(await readAvatarImage("cm3x8k2p90000neverseen001")).toBeNull();
  });

  it("删掉之后读出来是 null；删不存在的也不抛", async () => {
    await saveAvatarImage(UID, await png(120, 120));
    await deleteAvatarImage(UID);
    expect(await readAvatarImage(UID)).toBeNull();
    await expect(deleteAvatarImage(UID)).resolves.toBeUndefined();
  });
});

describe("decodeImageDataUrl — 只信魔数，不信 MIME 声明", () => {
  const b64 = (b: Buffer) => b.toString("base64");

  it("认 PNG / JPEG / WebP", async () => {
    for (const make of [
      () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer(),
      () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer(),
      () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).webp().toBuffer(),
    ]) {
      const buf = await make();
      expect(decodeImageDataUrl(`data:image/png;base64,${b64(buf)}`)).not.toBeNull();
    }
  });

  it("声明成 image/png 的可执行文件被挡（魔数不符）", () => {
    const evil = Buffer.from("MZ\x90\x00 fake exe payload");
    expect(decodeImageDataUrl(`data:image/png;base64,${b64(evil)}`)).toBeNull();
  });

  it("SVG 被挡——它能带脚本，转码前就该拒", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(decodeImageDataUrl(`data:image/svg+xml;base64,${b64(svg)}`)).toBeNull();
  });

  it("不是 data URL / base64 烂掉 / 空串 → null", () => {
    expect(decodeImageDataUrl("https://example.com/a.png")).toBeNull();
    expect(decodeImageDataUrl("data:image/png;base64,!!!!")).toBeNull();
    expect(decodeImageDataUrl("")).toBeNull();
  });

  it("超大载荷直接拒，别先解码再说", () => {
    const huge = "A".repeat(9 * 1024 * 1024);
    expect(decodeImageDataUrl(`data:image/png;base64,${huge}`)).toBeNull();
  });
});
