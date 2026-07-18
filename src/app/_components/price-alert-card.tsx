"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { describeAlert, type AlertDirection } from "~/lib/price-alert";
import { brandBtn, fieldClsSm } from "./section-head";

/**
 * 到价提醒控件（#3b）。合规：用户自设阈值、只是「到价通知我」——非荐买/荐卖（铁律②）。
 * 触发由 cron 比价，提醒中心露出；这里管设置 / 查看 / 删除。
 */
export function PriceAlertCard({ entityId }: { entityId: string }) {
  const utils = api.useUtils();
  const list = api.priceAlert.listByEntity.useQuery({ entityId });
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [price, setPrice] = useState("");

  const invalidate = () =>
    void utils.priceAlert.listByEntity.invalidate({ entityId });
  const create = api.priceAlert.create.useMutation({
    onSuccess: () => {
      setPrice("");
      invalidate();
    },
  });
  const remove = api.priceAlert.remove.useMutation({ onSuccess: invalidate });

  const alerts = list.data ?? [];
  const priceNum = Number(price);
  const canSubmit = Number.isFinite(priceNum) && priceNum > 0 && !create.isPending;

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span aria-hidden>🔔</span>
        <h3 className="text-sm font-bold text-ink">到价提醒</h3>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        股价触及你设的价位时通知你。你自己设的观察位，非解牛荐买卖。
      </p>

      <div className="mt-3 flex items-center gap-2">
        <select
          aria-label="方向"
          value={direction}
          onChange={(e) => setDirection(e.target.value as AlertDirection)}
          className={`${fieldClsSm} w-auto`}
        >
          <option value="above">涨破</option>
          <option value="below">跌破</option>
        </select>
        <input
          inputMode="decimal"
          aria-label="价格"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit)
              create.mutate({ entityId, direction, threshold: priceNum });
          }}
          placeholder="价格"
          className={`${fieldClsSm} min-w-0 flex-1`}
        />
        <span className="shrink-0 text-xs text-muted">元</span>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            create.mutate({ entityId, direction, threshold: priceNum })
          }
          className={`${brandBtn} shrink-0`}
        >
          添加
        </button>
      </div>
      {create.error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      ) : null}

      {alerts.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
              <span
                className={
                  a.active ? "text-ink" : "text-muted line-through"
                }
              >
                {describeAlert(a.direction as AlertDirection, a.threshold)}
                {!a.active && a.triggeredPrice != null
                  ? `（已触发 @ ${a.triggeredPrice.toFixed(2)}）`
                  : ""}
              </span>
              <button
                type="button"
                onClick={() => remove.mutate({ id: a.id })}
                className="shrink-0 text-muted transition-colors hover:text-red-600"
                aria-label="删除提醒"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
