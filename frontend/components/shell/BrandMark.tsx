/**
 * 站標「排序條加鏈節」：深藍黑圓角方塊裡，三條由長到短的橫條代表排序，左端串在一條鏈上代表一筆接一筆的存證紀錄，
 * 最上面那一節是電光藍（今天這一節）。與 app/icon.svg 同一個圖形，顏色固定，不隨主題切換。
 */
export default function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect width="24" height="24" rx="6" fill="#0A0F1A" />
      <path d="M6 6V18" fill="none" stroke="#E7EEF8" strokeWidth="2" />
      <path d="M6 6H18 M6 12H15 M6 18H12" fill="none" stroke="#E7EEF8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="6" cy="6" r="2" fill="#3D8BFF" />
      <path d="M6 12h.01 M6 18h.01" stroke="#E7EEF8" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
