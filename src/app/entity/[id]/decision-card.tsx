import Link from "next/link";

import type { DecisionCard as Card, ModelRead } from "~/lib/decision-card";

/**
 * 「个股决策卡」——个股页第一屏（2026-08-06，按张楚寒新一轮反馈重做）。
 *
 * ## 版式为什么是这个顺序
 *
 * 结论 → 拆解 → 条件 → 免责。上一版观察卡已经把「结论先行」立住了，这一版补的是
 * **拆解**：一个总结论如果不能当场拆成五个各自带依据的读数，它和「今日偏正面」
 * 没有区别。所以五个模型不是装饰，是这张卡的正文。
 *
 * ## 五个模型为什么是可展开的行，不是并排的五张小卡
 *
 * 反馈的原话是「点击每个模型能看到依据」。并排小卡在 390px 下每张只剩 70px 宽，
 * 档位词就顶满了，依据一个字放不下；而在 1500px 的桌面下，展开某一张会把整行的高度
 * 撑起来、其余四张跟着变形（上一版那条「手机版式照搬到桌面会散架」的教训，反过来的形状）。
 * 竖排 `<details>` 两头都成立：summary 一行扫完，点开就地展开，不影响别人。
 * 而且 `<details>` 是原生的——服务端组件不用为了一个展开塞一份 JS 到客户端。
 *
 * ## 配色：走**语义**变量，随明暗模式翻转
 *
 * 8-05 的观察卡用的是侧栏那套 `--color-sb-*`（不随主题翻转的固定深色），理由是
 * 「深色＝这是结论」的层级跳变。8-06 sway 直接否了：亮色模式下一整块黑压在暖米画布上
 * 太重，主题开关等于对这张卡失效。现在一律走 `surface / surface-2 / ink / muted /
 * faint / line`——`.dark` 覆盖同名变量，亮色是白卡、暗色是深藏蓝卡，一处不用写条件。
 *
 * 层级不靠「永远深色」撑，靠**结构**：整宽、置顶、衬线大标题，外层 `bg-surface` 配
 * 内层 `bg-surface-2` 的模型区。**永远用语义类，别写死颜色**，否则暗色模式与色盲模式一起失效。
 *
 * **琥珀一屏只服务一个焦点**：这屏的焦点是「最大的不确定性」那一行——它是这张卡里
 * 唯一需要用户立刻做点什么的东西。五个模型的档位一律走中性墨阶：它们每张卡都会渲染
 * 五次，染色就成了底噪（DESIGN.md 的机械判定：每条列表项都渲染 → 中性）。
 * 方向不靠颜色区分、靠词——「改善 / 走弱 / 未变化 / 待确认」本来就说得比颜色清楚，
 * 而且不吃色盲的亏。
 */

const STANCE_TAG: Record<ModelRead["stance"], string> = {
  support: "改善",
  against: "走弱",
  flat: "未变化",
  unknown: "待确认",
};

/** 结论七档里哪些需要用户停下来看一眼（决定状态点是否点亮）。 */
const ALARMED = new Set(["conflict", "weaken", "broken", "insufficient"]);

function Basis({
  items,
}: {
  items: { text: string; newsId?: string; source?: string }[];
}) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((b, i) => (
        <li key={i} className="text-muted flex gap-2 text-[13px] leading-relaxed">
          <span className="text-faint mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" aria-hidden />
          <span className="min-w-0">
            {b.text}
            {b.newsId ? (
              <>
                {" "}
                <Link
                  href={`/news/${b.newsId}`}
                  className="text-faint hover:text-ink underline underline-offset-2 transition-colors"
                >
                  出处{b.source ? ` · ${b.source}` : ""}
                </Link>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ModelRow({ m }: { m: ModelRead }) {
  const first = m.basis[0]?.text ?? m.missing ?? "";
  // 档位词本身已经说清方向时（基本面「改善」/「走弱」），不再并排重复一个同义标签——
  // 真机截图里这一列就是「改善　改善」，白占 390px 屏幕里宝贵的一截宽度。
  const tag = STANCE_TAG[m.stance];
  const showTag = !m.level.includes(tag);
  return (
    <details className="group border-line border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-baseline gap-3 py-2.5">
        <span className="text-muted w-16 shrink-0 text-xs">{m.name}</span>
        <span className="text-ink w-28 shrink-0 text-sm font-semibold">
          {m.level}
        </span>
        <span className="text-faint w-12 shrink-0 text-[11px]">
          {showTag ? tag : ""}
        </span>
        {/* 桌面下把首条依据带进 summary，一眼扫完五行就知道每个模型凭什么这么说。
            手机下藏起来（`hidden sm:block`）——390px 塞不下，硬塞会换行成三行、
            五个模型就占掉整屏。 */}
        <span className="text-faint hidden min-w-0 flex-1 truncate text-xs sm:block">
          {first}
        </span>
        <span className="text-faint ml-auto shrink-0 text-[11px] group-open:hidden">
          看依据
        </span>
      </summary>
      <div className="pb-3 pl-0 sm:pl-[7.75rem]">
        {m.basis.length > 0 ? (
          <Basis items={m.basis} />
        ) : (
          <p className="text-muted text-[13px] leading-relaxed">
            没有可核事实。
          </p>
        )}
        {m.missing ? (
          <p className="text-faint mt-2 text-[11px] leading-relaxed">
            {m.missing}
          </p>
        ) : null}
        {m.asOf ? (
          <p className="text-faint mt-1 text-[11px]">{m.asOf}</p>
        ) : null}
      </div>
    </details>
  );
}

const COND_MARK: Record<string, string> = {
  met: "已满足",
  pending: "待满足",
  adverse: "出现反面证据",
};

export function DecisionCard({
  card,
  name,
  logicHref,
  planHref,
}: {
  card: Card;
  name: string;
  /** 「写下我的逻辑」/「看我盯的维度」落点。 */
  logicHref: string;
  /** 「编辑我的计划」落点（持仓 / 到价 / 决策记录合并卡）。 */
  planHref: string;
}) {
  const alarmed = ALARMED.has(card.verdict);
  const { conditions: c } = card;
  const pct = c.total > 0 ? Math.round((c.met / c.total) * 100) : 0;

  return (
    <section className="bg-surface border-line overflow-hidden rounded-2xl border p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${alarmed ? "bg-brand" : "bg-muted"}`}
          aria-hidden
        />
        <span className="text-muted text-xs font-medium">
          {card.verdictLabel}
        </span>
        <span className="text-faint ml-auto shrink-0 text-[11px]">
          个股决策卡 · 非荐股
        </span>
      </div>

      <div className="mt-3 gap-6 lg:flex lg:items-start">
        <div className="min-w-0 lg:flex-1">
          <h2 className="font-display text-ink max-w-3xl text-xl leading-snug font-bold tracking-tight sm:text-2xl">
            {card.headline}
          </h2>
          <p className="text-muted tabular mt-2.5 text-sm leading-relaxed">
            {card.tally}
          </p>
          <p className="text-muted mt-2 max-w-3xl text-[13px] leading-relaxed">
            {card.body}
          </p>
        </div>

        {/* 「模型一致性」与「最重要的新增证据」并成右栏：概念稿把一致性放在右侧的圆环里，
            解牛不画那个环——一个圆环把 3/5 渲染得像个概率，而它明确不是概率。
            所以只留数字，并把「不是涨跌概率」写在它正下方，位置就是最容易被误读的地方。

            手机上这一整块**改成横排一行**（`flex … lg:block`）。竖着排的话，光标签+大数字+
            两行注解就要 130px，而这张卡在 390px 下本来就快到 1800px 高——上一轮刚把
            「投资逻辑要滚 1600px 才看得到」修好，这一轮不能自己再造一个。 */}
        <div className="border-line mt-4 shrink-0 border-t pt-3.5 lg:mt-0 lg:w-64 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <div className="flex items-baseline gap-2 lg:block">
            <p className="text-faint shrink-0 text-[11px]">模型一致性</p>
            <p className="text-ink tabular font-display text-lg font-bold lg:mt-0.5 lg:text-2xl">
              {card.agreement.same}
              <span className="text-muted text-sm font-normal lg:text-base">
                /{card.agreement.total}
              </span>
            </p>
            <p className="text-faint min-w-0 text-[11px] leading-relaxed lg:mt-0.5">
              {card.agreement.note}；这不是涨跌概率
            </p>
          </div>
          {card.topEvidence ? (
            <div className="border-line mt-3 border-t pt-3">
              <p className="text-faint text-[11px]">最重要的新增证据</p>
              <p className="text-ink mt-1 text-[13px] leading-relaxed">
                {card.topEvidence.text}
              </p>
              {card.topEvidence.newsId ? (
                <Link
                  href={`/news/${card.topEvidence.newsId}`}
                  className="text-faint hover:text-ink mt-1 inline-block text-[11px] underline underline-offset-2 transition-colors"
                >
                  查看出处
                  {card.topEvidence.source ? ` · ${card.topEvidence.source}` : ""}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* 五个模型 */}
      <div className="bg-surface-2 mt-4 rounded-xl px-4 py-1">
        {card.models.map((m) => (
          <ModelRow key={m.key} m={m} />
        ))}
      </div>

      {/* 条件完成度：全部来自用户自己设的东西，所以标题写「我的」、右上角标「用户自设」。
          未设置时整块不渲染——一条 0/0 的进度条不是信息，是噪音（上一版那条教训）。 */}
      {c.unset ? null : (
        <div className="mt-4">
          {/* `flex-wrap` + 每一项 `shrink-0`：不加的话 390px 下 flex 会去压缩标题本身，
              「我的条件完成度」被挤成竖着的四行（真机截图抓到的）。右侧那句注解在窄屏
              自成一行（`w-full sm:w-auto sm:ml-auto`），不跟标题抢宽度。 */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-ink shrink-0 text-sm font-semibold">
              我的条件完成度
            </h3>
            <span className="text-ink tabular shrink-0 text-sm font-semibold">
              {c.met}/{c.total}
            </span>
            {c.freshlyMet > 0 ? (
              <span className="text-muted shrink-0 text-[11px]">
                其中 {c.freshlyMet} 项是近 7 天新满足的
              </span>
            ) : null}
            <span className="text-faint w-full shrink-0 text-[11px] sm:ml-auto sm:w-auto">
              条件由你自己设定 · 解牛不替你生成
            </span>
          </div>
          <div
            className="bg-line mt-2 h-1.5 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={`${c.total} 项条件已满足 ${c.met} 项`}
          >
            <div
              className="bg-muted h-full rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
          <details className="group mt-2">
            <summary className="text-faint hover:text-muted cursor-pointer list-none text-[11px] transition-colors">
              <span className="group-open:hidden">展开逐条看</span>
              <span className="hidden group-open:inline">收起</span>
            </summary>
            <ul className="mt-2 space-y-2">
              {c.items.map((it, i) => (
                <li key={i} className="flex gap-2.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      it.state === "met" ? "bg-ink" : it.state === "adverse" ? "bg-brand" : "bg-line"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-ink text-[13px] leading-snug font-medium">
                      {it.label}
                      <span className="text-faint ml-2 text-[11px] font-normal">
                        {COND_MARK[it.state]}
                      </span>
                    </p>
                    <p className="text-muted mt-0.5 text-[12px] leading-relaxed">
                      {it.detail}
                      {it.newsId ? (
                        <>
                          {" "}
                          <Link
                            href={`/news/${it.newsId}`}
                            className="text-faint hover:text-ink underline underline-offset-2 transition-colors"
                          >
                            出处
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {/* 最大的不确定性——这屏唯一的琥珀，因为它是唯一「还需要你去核」的东西。 */}
      {card.topUncertainty ? (
        <p className="border-brand/40 text-muted mt-4 border-l-2 pl-3 text-[13px] leading-relaxed">
          <span className="text-brand font-medium">最大的不确定性　</span>
          {card.topUncertainty}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Link
          href={logicHref}
          scroll
          className="bg-brand hover:bg-brand-dark inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-[#1b1a17] transition-colors"
        >
          {c.unset ? "写下我的逻辑" : "看我盯的维度"}
        </Link>
        <Link
          href={planHref}
          scroll
          className="border-line text-ink hover:border-muted inline-flex items-center justify-center rounded-full border px-5 py-2.5 text-sm font-medium transition-colors"
        >
          编辑我的计划
        </Link>
      </div>

      <p className="text-faint mt-3 text-[11px] leading-relaxed">
        五个模型给的都是<span className="text-muted">信息状态</span>
        ，不是操作建议，也不是涨跌预测。解牛不会把价格或资金变化翻译成买卖动作；{name}
        的持仓与价位由你自己设定，平台不评价价位是否合理。数据不足时这里会直说「判不了」。
      </p>
    </section>
  );
}
