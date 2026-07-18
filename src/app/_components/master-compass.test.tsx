import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MasterCompass } from "./master-compass";
import { masterCompass } from "~/lib/master-compass";

const compass = masterCompass({ title: "A公司拟收购B公司巩固护城河" });
const html = renderToStaticMarkup(
  <MasterCompass
    compass={compass}
    active={null}
    loading={null}
    onSelect={() => undefined}
  />,
);

describe("MasterCompass", () => {
  it("renders the 4 masters as optional lenses (P5-12: neutral is not a compass row)", () => {
    for (const label of ["巴菲特", "芒格", "林奇", "格雷厄姆"]) {
      expect(html).toContain(label);
    }
    // 中性解读被降级为默认视角、在罗盘之外单独展示，不再作为罗盘里的一行
    expect(html).not.toContain("中性解读");
  });

  it("shows the consensus/divergence headline", () => {
    expect(html).toContain(compass.headline);
    expect(html).toContain("巴菲特");
  });

  it("uses amber bars — never red/green", () => {
    expect(html).toContain("bg-brand/70");
    expect(html).not.toContain("bg-up");
    expect(html).not.toContain("bg-down");
    expect(html).not.toContain("text-up");
    expect(html).not.toContain("text-down");
  });

  it("carries the compliance caption (non-rating, non-prediction)", () => {
    expect(html).toContain("非评级、非涨跌预测");
  });
});
