import { ListOrdered } from "lucide-react";
import Link from "next/link";
import Magnitude from "@/components/rank/Magnitude";
import { EmptyState, Notice, Skeleton } from "@/components/ui/Feedback";
import Hint from "@/components/ui/Hint";
import Panel from "@/components/ui/Panel";
import type { RankResponse, RankResult } from "@/lib/api";
import { code } from "@/lib/format";
import { rankEnds } from "@/lib/rank";
import { errorText } from "@/lib/useAsync";

/**
 * 今日排序名次最前與最後各 3 檔（未來 5 個交易日的相對強弱預測），點名稱進個股頁。
 * 標題寫「前三、後三」而不寫「強、弱」；「排名靠前仍可能下跌」收在提示裡。
 */

function Ends({ label, rows }: { label: string; rows: RankResult[] }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs text-ink-3">{label}</h3>
      <ol className="mt-2 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.ticker} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-right text-ink-2">{r.rank}</span>
            <Magnitude percentile={r.percentile} />
            <Link
              href={`/stock?t=${encodeURIComponent(r.ticker)}`}
              className="inline-flex min-w-0 items-baseline gap-1.5 rounded-[3px] py-0.5 font-serif font-semibold text-ink hover:underline"
            >
              <span className="truncate">{r.name}</span>
              <span className="font-sans text-xs font-normal text-ink-3">{code(r.ticker)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function RankEndsPanel({ rank, error, className }: { rank: RankResponse | undefined; error: unknown; className?: string }) {
  const { top, bottom } = rankEnds(rank?.results ?? []);
  return (
    <Panel
      className={className}
      title="前三與後三"
      description={rank && top.length > 0 ? `基準日 ${rank.base_date}，未來 5 個交易日的相對強弱` : undefined}
      actions={
        <Hint to="rank" anchor="groups" label="前三與後三">
          <p>名次只是相對位置：排名靠前仍可能下跌，排名靠後也可能上漲。</p>
        </Hint>
      }
    >
      {error ? (
        <Notice tone="error">{errorText(error, "今日排序還沒有產生。")}</Notice>
      ) : !rank ? (
        <div className="grid grid-cols-2 gap-x-6">
          {["top", "bottom"].map((k) => (
            <div key={k} className="space-y-2">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : top.length === 0 ? (
        <EmptyState icon={ListOrdered} title={rank.is_mock ? "相對強弱模型還沒有載入" : "這一天沒有排序資料"} />
      ) : (
        <div className="grid grid-cols-2 gap-x-6">
          <Ends label="前三" rows={top} />
          {bottom.length > 0 && <Ends label="後三" rows={bottom} />}
        </div>
      )}
    </Panel>
  );
}
