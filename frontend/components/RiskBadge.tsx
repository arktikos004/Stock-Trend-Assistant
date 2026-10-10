import Badge from "@/components/ui/Badge";
import type { RiskLevel } from "@/lib/api";
import type { BadgeTone } from "@/lib/status";

// 風險等級不用紅綠（台股的紅綠代表漲跌）：低＝中性、中＝琥珀、高＝實心深色，另附文字
const TONE: Record<RiskLevel, BadgeTone> = { 低: "neutral", 中: "warn", 高: "solid" };

export default function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <Badge tone={TONE[risk]} title="依近 60 日年化波動率換算">
      {risk}風險
    </Badge>
  );
}
