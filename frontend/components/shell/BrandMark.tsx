/** 站標：三條由長到短的橫條，代表排序。與 app/icon.svg 同一個圖形。 */
export default function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <rect x="5" y="6" width="14" height="2.6" rx="1.3" fill="var(--accent-fg)" />
      <rect x="5" y="10.7" width="10.5" height="2.6" rx="1.3" fill="var(--accent-fg)" opacity="0.85" />
      <rect x="5" y="15.4" width="7" height="2.6" rx="1.3" fill="var(--accent-fg)" opacity="0.7" />
    </svg>
  );
}
