import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsensusCard } from "./consensus-card";
import { parseConsensusDetail } from "~/lib/consensus";

const asOf = new Date("2026-07-20T00:00:00Z");
const detail = parseConsensusDetail({
  orgNum: 20,
  buy: 12,
  add: 5,
  neutral: 3,
  eps: [
    { year: "2026", eps: 2.5 },
    { year: "2027", eps: 3.0 },
  ],
})!;
const html = renderToStaticMarkup(<ConsensusCard detail={detail} asOf={asOf} />);

describe("ConsensusCard", () => {
  it("显示覆盖机构数与三档分歧度", () => {
    expect(html).toContain("20");
    for (const l of ["买入", "增持", "中性"]) expect(html).toContain(l);
  });

  it("比例条用 amber/灰阶——红绿只留给股价（铁律①）", () => {
    expect(html).toContain("bg-brand");
    expect(html).not.toContain("text-up");
    expect(html).not.toContain("text-down");
    expect(html).not.toContain("bg-up");
    expect(html).not.toContain("bg-down");
  });

  it("露出未来两年 EPS 一致预期与隐含增速", () => {
    expect(html).toContain("2026");
    expect(html).toContain("2027");
    expect(html).toContain("2.5");
    expect(html).toContain("20"); // 隐含增速 +20%
  });

  it("无 EPS 数据时不渲染 EPS 段——没有就不显示，不占位", () => {
    const bare = parseConsensusDetail({ orgNum: 4, buy: 4 })!;
    const h = renderToStaticMarkup(<ConsensusCard detail={bare} asOf={asOf} />);
    expect(h).not.toContain("每股收益预期");
  });

  it("带合规话术：搬运第三方、非评级、非投资建议、无目标价", () => {
    expect(html).toContain("非评级");
    expect(html).toContain("非投资建议");
    expect(html).toContain("目标价");
  });

  it("标注数据时间——结论要能看出新旧", () => {
    expect(html).toContain("07/20");
  });
});
