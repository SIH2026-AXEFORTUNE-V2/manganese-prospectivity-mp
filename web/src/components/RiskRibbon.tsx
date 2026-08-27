import type { RiskEntry } from "@/lib/contract";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color: string;
  threshold?: number;
  min?: number;
  max?: number;
}

function Sparkline({ data, width = 100, height = 24, color, threshold, min, max }: SparklineProps) {
  if (data.length === 0) return null;

  const dataMin = min !== undefined ? min : Math.min(...data);
  const dataMax = max !== undefined ? max : Math.max(...data);
  const range = dataMax - dataMin || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - dataMin) / range) * height;
    return `${x},${y}`;
  });

  return (
    <div style={{ position: "relative", width, height }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          points={points.join(" ")}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {threshold !== undefined && (
          <line
            x1="0"
            y1={height - ((threshold - dataMin) / range) * height}
            x2={width}
            y2={height - ((threshold - dataMin) / range) * height}
            stroke="var(--critical)"
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity={0.6}
          />
        )}
      </svg>
    </div>
  );
}

export default function RiskRibbon({ series }: { series: RiskEntry["series"] }) {
  const rainfall = series.map((s) => s.rainfall_mm);
  const soil = series.map((s) => s.soil_moisture);
  const lst = series.map((s) => s.lst_c);
  const ndvi = series.map((s) => s.ndvi);

  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        paddingTop: 12,
        marginTop: 12,
        borderTop: "1px solid var(--rule)",
        flexWrap: "wrap",
      }}
    >
      <Metric label="Rainfall (mm)" data={rainfall} color="#4ea8de" threshold={100} min={0} />
      <Metric label="Soil Moisture" data={soil} color="#5390d9" threshold={0.35} min={0} max={1} />
      <Metric label="LST (°C)" data={lst} color="#e07a5f" threshold={45} min={0} max={60} />
      <Metric label="NDVI" data={ndvi} color="#81b29a" min={0} max={1} />
    </div>
  );
}

function Metric({
  label,
  data,
  color,
  threshold,
  min,
  max,
}: {
  label: string;
  data: number[];
  color: string;
  threshold?: number;
  min?: number;
  max?: number;
}) {
  const current = data[data.length - 1];

  return (
    <div style={{ flex: "1 1 calc(25% - 12px)", minWidth: 80 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--ink-dim)",
          marginBottom: 4,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", marginBottom: 6 }}>
        {typeof current === "number" ? current.toFixed(1) : "—"}
      </div>
      <Sparkline data={data} width={80} height={20} color={color} threshold={threshold} min={min} max={max} />
    </div>
  );
}
