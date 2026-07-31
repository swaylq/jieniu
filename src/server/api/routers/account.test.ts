import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

vi.mock("~/server/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { createCallerFactory } from "~/server/api/trpc";
import { accountRouter } from "./account";
import { readAvatarImage } from "~/server/avatar-store";

const UID = "cm3x8k2p90000abcdefghijkl";
const SESSION = { user: { id: UID } };

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "jieniu-account-"));
  process.env.AVATAR_DIR = dir;
});

afterAll(async () => {
  delete process.env.AVATAR_DIR;
  await rm(dir, { recursive: true, force: true });
});

function makeCaller(db: unknown, session: unknown = SESSION) {
  return createCallerFactory(accountRouter)({
    db,
    session,
    headers: new Headers(),
  } as never);
}

/** 用户表桩：只暴露 setAvatar 用到的两个方法。 */
function userStub(update = vi.fn().mockResolvedValue({})) {
  return {
    update,
    findUnique: vi.fn().mockResolvedValue({
      email: "sway@example.com",
      image: null,
      avatarColor: null,
      avatarChar: null,
    }),
  };
}

async function pngDataUrl(w = 600, h = 400): Promise<string> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: "#c83c28" },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

describe("account.setAvatar", () => {
  it("未登录一律拒绝", async () => {
    await expect(
      makeCaller({}, null).setAvatar({ kind: "reset" }),
    ).rejects.toThrow();
  });

  it("上传：落盘 + 库里存带版本号的 URL", async () => {
    const user = userStub();
    const res = await makeCaller({ user }).setAvatar({
      kind: "image",
      dataUrl: await pngDataUrl(),
    });

    expect(res.image).toMatch(new RegExp(`^/api/avatar/${UID}\\?v=[0-9a-f]{8}$`));
    expect(await readAvatarImage(UID)).not.toBeNull();
    expect(user.update).toHaveBeenCalledWith({
      where: { id: UID },
      data: { image: res.image },
    });
  });

  it("上传坏字节：报 400，且**没碰过库**", async () => {
    const user = userStub();
    const junk = Buffer.from("definitely not an image").toString("base64");
    await expect(
      makeCaller({ user }).setAvatar({
        kind: "image",
        dataUrl: `data:image/png;base64,${junk}`,
      }),
    ).rejects.toThrow(/读不出来/);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("落盘成功但库更新失败：把刚写的文件删掉，不留孤儿", async () => {
    const user = userStub(vi.fn().mockRejectedValue(new Error("db down")));
    await expect(
      makeCaller({ user }).setAvatar({ kind: "image", dataUrl: await pngDataUrl() }),
    ).rejects.toThrow("db down");
    expect(await readAvatarImage(UID)).toBeNull();
  });

  it("存文字头像：清掉照片（文件也删），存归一后的色与字", async () => {
    const user = userStub();
    await makeCaller({ user }).setAvatar({
      kind: "image",
      dataUrl: await pngDataUrl(),
    });
    expect(await readAvatarImage(UID)).not.toBeNull();

    const res = await makeCaller({ user }).setAvatar({
      kind: "preset",
      color: 3,
      char: "张楚寒",
    });

    expect(res.image).toBeNull();
    expect(await readAvatarImage(UID)).toBeNull();
    expect(user.update).toHaveBeenLastCalledWith({
      where: { id: UID },
      data: { image: null, avatarColor: 3, avatarChar: "张楚" },
    });
  });

  it("文字留空 = 回到邮箱首字母（存 null，不是空串）", async () => {
    const user = userStub();
    await makeCaller({ user }).setAvatar({ kind: "preset", color: null, char: "   " });
    expect(user.update).toHaveBeenLastCalledWith({
      where: { id: UID },
      data: { image: null, avatarColor: null, avatarChar: null },
    });
  });

  it("越界色号报 400，不写库", async () => {
    const user = userStub();
    await expect(
      makeCaller({ user }).setAvatar({ kind: "preset", color: 99, char: null }),
    ).rejects.toThrow(/色号/);
    expect(user.update).not.toHaveBeenCalled();
  });

  it("恢复默认：三个字段全清 + 删文件", async () => {
    const user = userStub();
    await makeCaller({ user }).setAvatar({
      kind: "image",
      dataUrl: await pngDataUrl(),
    });
    await makeCaller({ user }).setAvatar({ kind: "reset" });

    expect(await readAvatarImage(UID)).toBeNull();
    expect(user.update).toHaveBeenLastCalledWith({
      where: { id: UID },
      data: { image: null, avatarColor: null, avatarChar: null },
    });
  });
});

describe("account.getAvatar", () => {
  it("给编辑器原始值（含取色种子）", async () => {
    const user = {
      findUnique: vi.fn().mockResolvedValue({
        email: "sway@example.com",
        image: "/api/avatar/x?v=1",
        avatarColor: 2,
        avatarChar: "张",
      }),
    };
    expect(await makeCaller({ user }).getAvatar()).toEqual({
      image: "/api/avatar/x?v=1",
      avatarColor: 2,
      avatarChar: "张",
      seed: "sway@example.com",
    });
  });
});
