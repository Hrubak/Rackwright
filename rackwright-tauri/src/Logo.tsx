import { v } from "./theme";

export function Logo({ size, wordmark }: { size: number; wordmark?: boolean }) {
  const white = "#fff"; // theme-ok
  const mark = (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <rect width="64" height="64" rx="14" fill={v("accent")} />
      <rect x="13" y="15" width="38" height="9" rx="2" fill={white} />
      <rect x="13" y="27.5" width="38" height="9" rx="2" fill={white} />
      <rect x="13" y="40" width="38" height="9" rx="2" fill={white} fillOpacity=".55" />
      <circle cx="45" cy="19.5" r="2" fill={v("accent")} />
      <circle cx="45" cy="32" r="2" fill={v("accent")} />
    </svg>
  );
  if (!wordmark) return mark;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.35), color: v("text") }}>
      {mark}
      <span style={{ fontSize: Math.round(size * 0.75), fontWeight: 600 }}>Rackwright</span>
    </span>
  );
}
