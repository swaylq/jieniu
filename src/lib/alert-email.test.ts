import { describe, it, expect } from "vitest";
import {
  alertEmailSubject,
  renderAlertEmailHtml,
  escapeHtml,
  type MailItem,
} from "./alert-email";

const item = (o: Partial<MailItem> = {}): MailItem => ({
  kind: "logic",
  title: "澜起科技「现金流与资本开支」转向偏风险",
  body: "对照你为它设的证伪条件，看是否已被触发。",
  url: "/entity/e1",
  occurredAt: new Date(2026, 6, 28, 15, 30),
  ...o,
});

describe("escapeHtml", () => {
  it("转义标题里的 HTML 元字符——资讯标题来自外部源，不可信", () => {
    expect(escapeHtml(`A&B <script>x</script> "q" 'p'`)).toBe(
      "A&amp;B &lt;script&gt;x&lt;/script&gt; &quot;q&quot; &#39;p&#39;",
    );
  });
});

describe("alertEmailSubject", () => {
  it("单条：直接用标题", () => {
    expect(alertEmailSubject([item()])).toBe(
      "【解牛】澜起科技「现金流与资本开支」转向偏风险",
    );
  });

  it("多条：首条 + 诚实计数", () => {
    expect(alertEmailSubject([item(), item({ title: "别的" }), item({ title: "又一条" })])).toBe(
      "【解牛】澜起科技「现金流与资本开支」转向偏风险 等 3 条",
    );
  });

  it("空列表且无复盘时返回空串——调用方据此不发信", () => {
    expect(alertEmailSubject([])).toBe("");
    expect(alertEmailSubject([], null)).toBe("");
  });

  it("有复盘时以复盘为主体——每日都有，异动只是附注", () => {
    expect(alertEmailSubject([], { tradeDate: "2026-07-28" })).toBe("【解牛】今日复盘 07.28");
    expect(alertEmailSubject([item(), item()], { tradeDate: "2026-07-28" })).toBe(
      "【解牛】今日复盘 07.28 · 自选 2 条异动",
    );
  });

  it("超长标题截断，不把整段正文塞进主题行", () => {
    const long = "极".repeat(80);
    const s = alertEmailSubject([item({ title: long })]);
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("renderAlertEmailHtml", () => {
  const base = {
    items: [item()],
    heldBack: 0,
    baseUrl: "https://jieniu.swaylab.ai",
    unsubUrl: "https://jieniu.swaylab.ai/unsubscribe?t=tok123",
  };

  it("每条都渲染标题、正文，并链回站内绝对地址", () => {
    const html = renderAlertEmailHtml(base);
    expect(html).toContain("澜起科技");
    expect(html).toContain("证伪条件");
    expect(html).toContain("https://jieniu.swaylab.ai/entity/e1");
  });

  it("被挤下去的条目写明「另有 N 条在站内」，不静默截断", () => {
    const html = renderAlertEmailHtml({ ...base, heldBack: 4 });
    expect(html).toContain("另有 4 条");
    expect(html).toContain("https://jieniu.swaylab.ai/notifications");
  });

  it("heldBack=0 时不出现「另有」字样", () => {
    expect(renderAlertEmailHtml(base)).not.toContain("另有");
  });

  it("必须带退订链接（合规硬要求）", () => {
    const html = renderAlertEmailHtml(base);
    expect(html).toContain("https://jieniu.swaylab.ai/unsubscribe?t=tok123");
    expect(html).toContain("退订");
  });

  it("正文里的 HTML 元字符被转义，换行转成 <br>", () => {
    const html = renderAlertEmailHtml({
      ...base,
      items: [item({ title: "<b>注入</b>", body: "第一行\n第二行" })],
    });
    expect(html).toContain("&lt;b&gt;注入&lt;/b&gt;");
    expect(html).not.toContain("<b>注入</b>");
    expect(html).toContain("第一行<br>第二行");
  });

  it("带免责声明——不构成投资建议", () => {
    expect(renderAlertEmailHtml(base)).toContain("不构成投资建议");
  });

  it("有复盘时把五段 + 判断都渲染进来", () => {
    const html = renderAlertEmailHtml({
      ...base,
      brief: {
        tradeDate: "2026-07-28",
        data: {
          overview: "指数普跌，防御板块逆势上涨。",
          drivers: [
            { scope: "global" as const, text: "韩股逼近熔断，隔夜海外存储链重挫" },
            { scope: "macro" as const, text: "央行开展2065亿元7天逆回购，利率持平1.40%" },
          ],
          sectors: { strong: [{ name: "白酒", note: "避险" }], weak: [{ name: "半导体", note: "承压" }] },
          stocks: [{ name: "兆易创新", changePct: -10, note: "板块领跌" }],
          watchpoints: ["半导体能否企稳"],
          judgment: "若企稳则修复；反之调整压力加大。",
          breadth: {
            counted: 5316, up: 900, down: 4300, flat: 116,
            limitUp: 12, limitDown: 48, medianChangePct: -1.62,
          },
        },
      },
    });
    expect(html).toContain("今日复盘");
    expect(html).toContain("指数普跌");
    expect(html).toContain("判断");
    expect(html).toContain("韩股逼近熔断");
    expect(html).toContain("国内宏观");
    expect(html).toContain("4300");
    expect(html).toContain("白酒");
    expect(html).toContain("兆易创新");
    expect(html).toContain("-10.00%");
    expect(html).toContain("半导体能否企稳");
  });

  it("没有复盘时不渲染空的复盘骨架", () => {
    expect(renderAlertEmailHtml(base)).not.toContain("今日复盘");
  });
});
