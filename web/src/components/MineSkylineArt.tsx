// Decorative mine-skyline silhouette for the New Project wizard - conveyor tower, stockpiles,
// smokestacks, distant ridge line. Inline SVG (no binary asset) so it reflows to any container
// width and follows the current theme automatically: every shape is `currentColor` at a low
// opacity, so a parent that sets `color` picks the tone, and it never needs a light/dark
// variant of its own.
export default function MineSkylineArt({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 400 180"
      preserveAspectRatio="xMidYMax slice"
      style={{ display: "block", width: "100%", height: "100%", ...style }}
      aria-hidden="true"
    >
      {/* distant ridge */}
      <path
        d="M0 130 L40 95 L75 118 L120 70 L160 108 L205 82 L250 120 L300 90 L340 115 L400 100 L400 180 L0 180 Z"
        fill="currentColor"
        opacity={0.12}
      />
      {/* nearer ridge */}
      <path
        d="M0 150 L55 120 L95 140 L150 105 L190 138 L245 112 L290 145 L340 122 L400 140 L400 180 L0 180 Z"
        fill="currentColor"
        opacity={0.2}
      />

      {/* stockpiles */}
      <path d="M10 168 L45 132 L80 168 Z" fill="currentColor" opacity={0.3} />
      <path d="M255 172 L285 142 L320 172 Z" fill="currentColor" opacity={0.3} />

      {/* smokestacks, right */}
      <g opacity={0.42}>
        <rect x="332" y="118" width="8" height="54" rx="1" fill="currentColor" />
        <rect x="332" y="128" width="8" height="6" fill="currentColor" opacity={0.5} />
        <rect x="348" y="104" width="9" height="68" rx="1" fill="currentColor" />
        <rect x="348" y="118" width="9" height="6" fill="currentColor" opacity={0.5} />
        <rect x="362" y="128" width="7" height="44" rx="1" fill="currentColor" />
      </g>

      {/* head-frame / conveyor tower, left of centre - the recognisable "mine" silhouette */}
      <g opacity={0.55}>
        <rect x="42" y="60" width="6" height="112" fill="currentColor" />
        <rect x="88" y="60" width="6" height="112" fill="currentColor" />
        <line x1="45" y1="60" x2="91" y2="60" stroke="currentColor" strokeWidth={5} />
        <line x1="45" y1="82" x2="91" y2="72" stroke="currentColor" strokeWidth={4} />
        <line x1="45" y1="60" x2="91" y2="104" stroke="currentColor" strokeWidth={3} />
        <line x1="91" y1="60" x2="45" y2="104" stroke="currentColor" strokeWidth={3} />
        {/* conveyor running down to the stockpile */}
        <line x1="48" y1="76" x2="10" y2="140" stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
        <line x1="48" y1="76" x2="10" y2="140" stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
        <line x1="8" y1="146" x2="150" y2="146" stroke="currentColor" strokeWidth={2} />
      </g>

      {/* low sheds */}
      <g opacity={0.38}>
        <rect x="150" y="140" width="46" height="32" />
        <path d="M150 140 L173 124 L196 140 Z" />
        <rect x="200" y="150" width="34" height="22" />
      </g>

      {/* clouds */}
      <g fill="currentColor" opacity={0.14}>
        <ellipse cx="60" cy="30" rx="22" ry="9" />
        <ellipse cx="230" cy="20" rx="26" ry="10" />
        <ellipse cx="330" cy="44" rx="18" ry="7" />
      </g>
    </svg>
  );
}
