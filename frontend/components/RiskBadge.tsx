import Badge from "@/components/ui/Badge";
import type { RiskLevel } from "@/lib/api";
import type { BadgeTone } from "@/lib/status";

// 風險等級不用紅綠（台股的紅綠代表漲跌），也不用琥珀（只標「看這裡」）：低、中＝文字，高＝實心深色
const TONE: Record<RiskLevel, BadgeTone> = { 低: "neutral", 中: "neutral", 高: "solid" };

export default function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <Badge tone={TONE[risk]} title="依近 60 日年化波動率換算">
      {risk}風險
    </Badge>
  );
}
