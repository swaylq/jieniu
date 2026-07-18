/** AI 行情分析入口（数值级数据后续基建，当前为占位）。会员限制已移除——对所有人开放。颜色只用 amber/灰。 */
export function MarketAnalysisCard() {
  return (
    <section className="rounded-xl border border-brand/30 bg-brand/[0.04] p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden>📈</span>
        <h3 className="text-sm font-bold text-ink">AI 行情分析</h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        K 线形态、资金流向、量价走势的 AI 客观归纳——把行情信号对上你的投资逻辑。仅供参考、非投资建议。
      </p>
      <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-center text-xs text-muted">
        行情数据接入中，敬请期待。
      </div>
    </section>
  );
}
