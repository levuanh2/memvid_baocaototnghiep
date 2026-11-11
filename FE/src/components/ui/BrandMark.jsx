// StudyMap brand mark (V5-A). Same artwork as public/studymap-mark.svg (the favicon), drawn
// inline so it follows the theme's --seal token. Purely decorative: the surrounding link or
// heading carries the accessible name ("StudyMap — trang chủ"), so the SVG is aria-hidden.
export default function BrandMark({ size = 30, className = "" }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`brand-mark flex-shrink-0 ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
      data-brand-mark=""
    >
      <rect x="2" y="2" width="60" height="60" rx="15" fill="var(--seal, #F1333A)" />
      <path d="M18 45 L31 20 L46 34" fill="none" stroke="#FAF8F5" strokeWidth="6"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="45" r="7" fill="#FAF8F5" />
      <circle cx="31" cy="20" r="7" fill="#FAF8F5" />
      <circle cx="46" cy="34" r="8.5" fill="#1B2A41" stroke="#FAF8F5" strokeWidth="4" />
    </svg>
  );
}
