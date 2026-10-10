import Link from "next/link";
import Badge from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Feedback";
import Panel from "@/components/ui/Panel";
import type { MonitorResponse } from "@/lib/api";
import { fixed } from "@/lib/format";
import { MODEL_STATUS } from "@/lib/status";

/**
 * 到期成績：最新一個已到期基準日的 Rank IC、近期平均與 Newey–West t、監控狀態。
 * t 未達門檻時直接寫「未達顯著」，不讓正的平均值看起來像已經證實。
 */
export default function MaturedPanel({ model }: { model: MonitorResponse["model"] | undefined }) {
  const status = model ? MODEL_STATUS[model.status] : null;
  const latest = model ? [...model.daily].reverse().find((d) => d.ic != null) : undefined;
  const skillT = model?.thresholds.skill_t[0] ?? 2;

  return (
    <Panel
      title="到期成績"
      actions={
        status && (
          <Badge tone={status.tone} icon={status.icon} title={status.note}>
            {status.text}
          </Badge>
        )
      }
    >
      {!model ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <>
          {latest ? (
            <p className="text-sm text-ink-2">
              最新到期的是 {latest.day} 那份排序（{latest.n} 檔）：Rank IC{" "}
              <span className="font-semibold text-ink">{fixed(latest.ic, 3, true)}</span>
              {latest.source === "pit" && "（事後重建）"}。
            </p>
          ) : (
            <p className="text-sm text-ink-2">還沒有到期的交易日。</p>
          )}
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">近 {model.n_days} 個到期日平均</dt>
              <dd className="font-semibold text-ink">{fixed(model.mean_ic, 3, true)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">Newey–West t</dt>
              <dd className="text-ink">
                {fixed(model.t_skill, 2)}
                <span className="ml-1.5 text-xs text-ink-3">
                  {model.t_skill != null && model.t_skill >= skillT ? "達顯著" : `未達顯著（門檻 ${skillT.toFixed(1)}）`}
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">回測平均</dt>
              <dd className="text-ink">{fixed(model.backtest_ic, 3, true)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            Rank IC 是預測排序與實際 5 日報酬排序的相關係數，0 代表沒有預測力。{status?.note}。
          </p>
          <Link href="/monitor" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
            看完整監控與失效檢定
          </Link>
        </>
      )}
    </Panel>
  );
}
