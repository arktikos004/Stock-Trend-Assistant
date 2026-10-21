import Link from "next/link";
import Badge from "@/components/ui/Badge";
import { Notice, Skeleton } from "@/components/ui/Feedback";
import Hint from "@/components/ui/Hint";
import Panel from "@/components/ui/Panel";
import type { MonitorResponse } from "@/lib/api";
import { fixed } from "@/lib/format";
import { MODEL_STATUS } from "@/lib/status";
import { errorText } from "@/lib/useAsync";

/**
 * 到期成績：主數字是即時記錄（前瞻）的平均 Rank IC 與 Newey–West t；含事後重建或補寫的全部到期日、回測平均與最新到期的那一天另列。
 * t 未達門檻時直接寫「未達顯著」，不讓正的平均值看起來像已經證實。狀態依預先聲明用全部到期日判定。
 */
export default function MaturedPanel({
  model,
  error,
  className,
}: {
  model: MonitorResponse["model"] | undefined;
  error?: unknown;
  className?: string;
}) {
  const status = model ? MODEL_STATUS[model.status] : null;
  const latest = model ? [...model.daily].reverse().find((d) => d.ic != null) : undefined;
  const skillT = model?.thresholds.skill_t[0] ?? 2;
  const live = model?.groups?.live;
  const verdict = (t: number | null | undefined) => (t != null && t >= skillT ? "達顯著" : `未達顯著（門檻 ${skillT.toFixed(1)}）`);
  const lead = live ?? (model ? { n_days: model.n_days, mean_ic: model.mean_ic, t_nw: model.t_skill } : null);

  return (
    <Panel
      className={className}
      title="到期成績"
      actions={
        status && (
          <span className="flex items-center gap-1">
            <Badge tone={status.tone} icon={status.icon} title={status.note}>
              {status.text}
            </Badge>
            <Hint to="model" anchor="status" label="模型狀態">
              <p>
                「{status.text}」：{status.note}。狀態依預先聲明用全部 {model?.n_days} 個到期日判定，只顯示、不會自動停用模型。
              </p>
            </Hint>
          </span>
        )
      }
    >
      {error ? (
        <Notice tone="error">{errorText(error, "到期成績還沒有產生。")}</Notice>
      ) : !model || !lead ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <>
          <p className="text-xs text-ink-3">{live ? `即時記錄 ${lead.n_days} 天平均 Rank IC` : `${lead.n_days} 個到期日平均 Rank IC`}</p>
          <p className="mt-1 text-[32px] font-light leading-none text-ink">{fixed(lead.mean_ic, 3, true)}</p>
          <p className="mt-2 text-xs text-ink-2">
            Newey–West t {fixed(lead.t_nw, 2, true)}，{verdict(lead.t_nw)}
          </p>
          <dl className="hairline-t mt-5 space-y-2 pt-4 text-sm">
            {live && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">全部 {model.n_days} 天（含事後重建或補寫）</dt>
                <dd className="text-ink">
                  {fixed(model.mean_ic, 3, true)} <span className="text-xs text-ink-3">t {fixed(model.t_skill, 2, true)}</span>
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">回測測試期平均</dt>
              <dd className="text-ink">{fixed(model.backtest_ic, 3, true)}</dd>
            </div>
            {latest && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-2">
                  最新到期 {latest.day.slice(5).replace("-", "/")}
                  {latest.source === "pit" ? "（事後重建）" : latest.on_time === false ? "（窗口開始後補寫）" : ""}
                </dt>
                <dd className="text-ink">{fixed(latest.ic, 3, true)}</dd>
              </div>
            )}
          </dl>
          <Link href="/monitor" className="mt-4 inline-block text-sm font-medium link">
            看完整監控
          </Link>
        </>
      )}
    </Panel>
  );
}
