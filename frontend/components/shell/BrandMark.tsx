/**
 * 站標「三星連線」：夜空藍圓角方塊裡，三顆由亮到暗的星以一條細線相連。星的大小代表排序，細線代表一筆接一筆的存證鏈，
 * 最亮那顆是琥珀色的今天。與 app/icon.svg 同一個圖形，顏色固定，不隨主題切換。
 */
export default function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect width="24" height="24" rx="6" fill="#0A1021" />
      <path d="M7 7L12.5 12.5L17.5 17" fill="none" stroke="#F2F2E9" strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="7" cy="7" r="3.2" fill="#F2B84B" />
      <circle cx="12.5" cy="12.5" r="2.2" fill="#F2F2E9" />
      <circle cx="17.5" cy="17" r="1.5" fill="#F2F2E9" />
    </svg>
  );
}
