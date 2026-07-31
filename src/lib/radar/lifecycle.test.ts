import { describe, it, expect } from "vitest";
import {
  advanceSignal,
  expiryFor,
  EARLY_VALID_DAYS,
  type LiveSignal,
  type Confirmation,
} from "./lifecycle";

const EARLY: LiveSignal = {
  signalType: "EARLY",
  status: "ACTIVE",
  tradeDate: "2026-07-28",
  entityName: "半导体",
};

const CONF: Confirmation = {
  tradeDaysElapsed: 1,
  stillPassesEarly: true,
  passesConfirmed: false,
  posFlowDays3: 2,
  breadthDrop: 0,
  severeCrowding: false,
};

describe("expiryFor", () => {
  it("刚刚启动默认有效 3 个交易日", () => {
    expect(EARLY_VALID_DAYS).toBe(3);
    const exp = expiryFor("EARLY", new Date("2026-07-28T08:00:00Z"));
    // 3 个自然日的宽限（交易日推算交给调用方，这里只保证不是永不过期）
    expect(exp.getTime()).toBeGreaterThan(Date.parse("2026-07-28T08:00:00Z"));
  });

  it("趋势形成给更长的有效期——它已被市场确认", () => {
    const a = expiryFor("EARLY", new Date("2026-07-28T08:00:00Z"));
    const b = expiryFor("CONFIRMED", new Date("2026-07-28T08:00:00Z"));
    expect(b.getTime()).toBeGreaterThan(a.getTime());
  });
});

describe("advanceSignal（§9 生命周期）", () => {
  it("拿到确认 → 升级为「趋势形成」", () => {
    const r = advanceSignal(EARLY, { ...CONF, passesConfirmed: true });
    expect(r.signalType).toBe("CONFIRMED");
    expect(r.status).toBe("CONFIRMED");
    expect(r.note).toContain("升级");
  });

  it("触发拥挤 → 转「追高风险」，不是第四种机会", () => {
    const r = advanceSignal(EARLY, { ...CONF, severeCrowding: true });
    expect(r.status).toBe("RISK");
    expect(r.signalType).toBe("EARLY"); // 类型不变，只是加了风险标签
  });

  it("资金转为流出 → 降级移除", () => {
    const r = advanceSignal(EARLY, { ...CONF, posFlowDays3: 0 });
    expect(r.status).toBe("EXPIRED");
    expect(r.note).toContain("资金");
  });

  it("板块广度明显下降 → 降级移除", () => {
    const r = advanceSignal(EARLY, { ...CONF, breadthDrop: 0.21 });
    expect(r.status).toBe("EXPIRED");
    expect(r.note).toContain("广度");
  });

  it("3 个交易日内没拿到确认 → 自动失效（旧机会不许赖在页面上）", () => {
    const r = advanceSignal(EARLY, { ...CONF, tradeDaysElapsed: 3 });
    expect(r.status).toBe("EXPIRED");
  });

  it("第 2 个交易日仍在改善 → 保持 ACTIVE", () => {
    const r = advanceSignal(EARLY, { ...CONF, tradeDaysElapsed: 2 });
    expect(r.status).toBe("ACTIVE");
  });

  it("拥挤优先于升级——过热了就不该再劝人进场", () => {
    const r = advanceSignal(EARLY, {
      ...CONF,
      passesConfirmed: true,
      severeCrowding: true,
    });
    expect(r.status).toBe("RISK");
  });

  it("已经是趋势形成的信号，资金转流出同样会被降级", () => {
    const conf: LiveSignal = { ...EARLY, signalType: "CONFIRMED", status: "CONFIRMED" };
    expect(advanceSignal(conf, { ...CONF, posFlowDays3: 0 }).status).toBe("EXPIRED");
  });

  it("逆势走强也有 3 日有效期，不靠板块确认", () => {
    const rs: LiveSignal = { ...EARLY, signalType: "RELATIVE_STRENGTH" };
    expect(advanceSignal(rs, { ...CONF, tradeDaysElapsed: 3 }).status).toBe("EXPIRED");
    expect(advanceSignal(rs, { ...CONF, tradeDaysElapsed: 1 }).status).toBe("ACTIVE");
  });
});
