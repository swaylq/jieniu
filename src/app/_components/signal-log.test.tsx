import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SignalLogItem } from "./signal-log";

const base = {
  dimensionKey: "产能",
  direction: "bull",
  materiality: 8,
  note: "扩产项目落地",
  newsTitle: "某公司公告扩产计划",
};

describe("SignalLogItem", () => {
  it("makes the triggering news title clickable → /news/{newsId} when newsId present", () => {
    const html = renderToStaticMarkup(
      <ul>
        <SignalLogItem s={{ ...base, newsId: "news123" }} />
      </ul>,
    );
    expect(html).toContain('href="/news/news123"');
    expect(html).toContain("某公司公告扩产计划");
  });

  it("renders the news title as plain text (no /news/ link) when newsId is absent", () => {
    const html = renderToStaticMarkup(
      <ul>
        <SignalLogItem s={{ ...base, newsId: null }} />
      </ul>,
    );
    expect(html).toContain("某公司公告扩产计划");
    expect(html).not.toContain("/news/");
  });

  it("shows dimension key, note and materiality", () => {
    const html = renderToStaticMarkup(
      <ul>
        <SignalLogItem s={{ ...base, newsId: null }} />
      </ul>,
    );
    expect(html).toContain("产能");
    expect(html).toContain("扩产项目落地");
    expect(html).toContain("材料度 8");
  });
});
