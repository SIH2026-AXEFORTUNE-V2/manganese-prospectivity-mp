// The circular "match %" indicator from the UI reference, repurposed for a target's fused
// score. Always a dark ring with a lime progress arc, in both themes - see the accent rule
// in globals.css. This is the one place that rule lives; don't re-implement rings elsewhere.

export default function ScoreRing({
  value, // 0..1
  size = 72,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const stroke = Math.max(4, size * 0.09);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="var(--chip-dark)"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent-lime)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--chip-dark-ink)",
        }}
      >
        <strong style={{ fontSize: size * 0.24, lineHeight: 1 }}>{Math.round(pct * 100)}%</strong>
        {label && <span style={{ fontSize: size * 0.11, opacity: 0.7 }}>{label}</span>}
      </div>
    </div>
  );
}
