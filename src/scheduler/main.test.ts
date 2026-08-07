import { describe, it, expect, vi, type Mock } from "vitest";
import { healOrphanRuns, recordFailRun, type JobRunStore } from "./main";

/**
 * main.ts 里新加的「异常兜底 / 孤儿自愈」纯逻辑。
 *
 * fire() 本身的 try/catch/finally 释放锁是 JS finally 语义保证的（finally 无条件执行），
 * 这里单测拆出来的两个可测函数，覆盖具体数据怎么落库。
 */

/** 测试用的假 jobRun 委托：三个方法全是 mock，按调用方需要各自设返回值。 */
function store(): {
  findMany: Mock<(a: FindManyCall) => Promise<{ id: string; output: string | null }[]>>;
  update: Mock<(a: UpdateCall) => Promise<unknown>>;
  create: Mock<(a: CreateCall) => Promise<unknown>>;
} {
  return { findMany: vi.fn(), update: vi.fn(), create: vi.fn() };
}

type FindManyCall = {
  where: { status: string; finishedAt: null; firedAt: { lt: Date } };
  select: { id: boolean; output: boolean };
};
type UpdateCall = {
  where: { id: string };
  data: { status: string; finishedAt: Date; output: string };
};
type CreateCall = {
  data: { jobKey: string; firedAt: Date; finishedAt: Date; status: string; output: string };
};

describe("healOrphanRuns", () => {
  it("把超过 24h 的孤儿 running 标成 timeout，output 尾部追加自愈说明", async () => {
    const s = store();
    s.findMany.mockResolvedValue([
      { id: "run-1", output: "前半段输出" },
      { id: "run-2", output: null },
    ]);

    const n = await healOrphanRuns(s as unknown as JobRunStore);

    expect(n).toBe(2);
    // 查询条件：running、没结束、firedAt 早于约 24h 前
    expect(s.findMany).toHaveBeenCalledWith({
      where: { status: "running", finishedAt: null, firedAt: { lt: expect.any(Date) as Date } },
      select: { id: true, output: true },
    });
    const cutoff: unknown = s.findMany.mock.calls[0]?.[0].where.firedAt.lt;
    expect(cutoff).toBeInstanceOf(Date);
    // 上面已断言是 Date 实例，这里取毫秒核对「24 小时」这个语义
    const cutoffDate = cutoff as Date;
    expect(Math.abs(cutoffDate.getTime() - (Date.now() - 24 * 60 * 60 * 1000))).toBeLessThan(
      5_000,
    );

    // 每条都被 update 成 timeout + finishedAt + 追加说明（output 为空也要留一句）
    expect(s.update).toHaveBeenCalledTimes(2);
    expect(s.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        status: "timeout",
        finishedAt: expect.any(Date) as Date,
        output: "前半段输出\n\n[自愈] 进程重启时发现该运行未正常结束，已标记超时",
      },
    });
    expect(s.update).toHaveBeenCalledWith({
      where: { id: "run-2" },
      data: {
        status: "timeout",
        finishedAt: expect.any(Date) as Date,
        output: "\n\n[自愈] 进程重启时发现该运行未正常结束，已标记超时",
      },
    });
  });

  it("没有孤儿时返回 0，不碰任何行", async () => {
    const s = store();
    s.findMany.mockResolvedValue([]);

    await expect(healOrphanRuns(s as unknown as JobRunStore)).resolves.toBe(0);
    expect(s.update).not.toHaveBeenCalled();
  });
});

describe("recordFailRun", () => {
  it("run 已建：把那条 update 成 fail，不新增孤儿行", async () => {
    const s = store();

    await recordFailRun(s as unknown as JobRunStore, {
      jobKey: "ingest",
      firedAt: new Date("2026-08-07T00:00:00Z"),
      runId: "run-1",
      reason: "boom",
    });

    expect(s.create).not.toHaveBeenCalled();
    expect(s.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        finishedAt: expect.any(Date) as Date,
        status: "fail",
        output: "[scheduler] fire 中断: boom",
      },
    });
  });

  it("run 还没建（create 本身就抛了）：补建一条带 firedAt 的 fail", async () => {
    const s = store();
    const firedAt = new Date("2026-08-07T00:00:00Z");

    await recordFailRun(s as unknown as JobRunStore, {
      jobKey: "ingest",
      firedAt,
      runId: null,
      reason: "boom",
    });

    expect(s.update).not.toHaveBeenCalled();
    expect(s.create).toHaveBeenCalledWith({
      data: {
        jobKey: "ingest",
        firedAt,
        finishedAt: expect.any(Date) as Date,
        status: "fail",
        output: "[scheduler] fire 中断: boom",
      },
    });
  });

  it("DB 写失败也吞掉，不往外抛（尽力而为）", async () => {
    const s = store();
    s.update.mockRejectedValue(new Error("db down"));

    await expect(
      recordFailRun(s as unknown as JobRunStore, {
        jobKey: "ingest",
        firedAt: new Date(),
        runId: "run-1",
        reason: "boom",
      }),
    ).resolves.toBeUndefined();
  });
});
