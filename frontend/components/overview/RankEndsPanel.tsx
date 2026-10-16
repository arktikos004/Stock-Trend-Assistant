import { ListOrdered } from "lucide-react";
import Link from "next/link";
import { QUANTILE } from "@/components/rank/RankBar";
import Badge from "@/components/ui/Badge";
import { EmptyState, Notice, Skeleton } from "@/components/ui/Feedback";
import HelpLink from "@/components/ui/HelpLink";
import Panel from "@/components/ui/Panel";
import type { RankResponse, RankResult } from "@/lib/api";
import { code } from "@/lib/format";
import { rankEnds } from "@/lib/rank";
import type { BadgeTone } from "@/lib/status";
import { errorText } from "@/lib/useAsync";

/**
 * 今日排序名次最前與最後各 3 檔（未來 5 個交易日的相對強弱預測），點名稱進個股頁。
 * 標籤寫「前三、後三」而不寫「強、弱」——排名靠前仍可能下跌；顏色沿用排序表的分組（前段紅、後段綠）。
 */

function Ends({ label, tone, rows }: { label: string; tone: BadgeTone; rows: RankResult[] }) {
  return (
    <div className="min-w-0">
      <h3>
        <Badge tone={tone}>{label}</Badge>
      </h3>
      <ol className="mt-2 space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.ticker} className="flex items-baseline gap-2">
            <span className="w-6 shrink-0 text-right font-semibold text-ink">{r.rank}</span>
            <Link
              href={`/stock?t=${encodeURIComponent(r.ticker)}`}
              className="inline-flex min-w-0 items-baseline gap-1.5 rounded-sm py-0.5 font-medium text-ink hover:underline"
            >
              <span className="truncate">{r.name}</span>
              <span className="text-xs font-normal text-ink-3">{code(r.ticker)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function RankEndsPanel({ rank, error }: { rank: RankResponse | undefined; error: unknown }) {
  const { top, bottom } = rankEnds(rank?.results ?? []);
  return (
    <Panel title="相對強弱：前三與後三" description={rank && top.length > 0 ? `基準日 ${rank.base_date}，預測未來 5 個交易日` : undefined}>
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
        <>
          <div className="grid grid-cols-2 gap-x-6">
            <Ends label="前三" tone={QUANTILE.top.tone} rows={top} />
            {bottom.length > 0 && <Ends label="後三" tone={QUANTILE.bottom.tone} rows={bottom} />}
          </div>
          <p className="mt-3 text-sm text-ink-2">
            排名靠前仍可能下跌。
            <HelpLink to="rank" className="ml-1" />
          </p>
        </>
      )}
    </Panel>
  );
}
