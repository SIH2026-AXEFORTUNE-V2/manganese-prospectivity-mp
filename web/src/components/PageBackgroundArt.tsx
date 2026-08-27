// Full-width watermark behind the New Project wizard - a wide mine-skyline panorama sitting
// under the glass cards, the same full-bleed idea the Projects page uses with its background
// video (see app/projects/page.tsx), just a static inline SVG instead of a video file. Fixed to
// the viewport so it never scrolls with the (usually short) wizard content, masked to fade into
// the page background at the top so it reads as atmosphere behind the cards, not a hard-edged
// image. Colours are fixed rather than theme tokens - this is a picture, not UI chrome, and its
// muted palette is designed to sit quietly behind translucent glass in either theme.
export default function PageBackgroundArt() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: "38vh",
        minHeight: 220,
        maxHeight: 380,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 40%, black 100%)",
        maskImage: "linear-gradient(to bottom, transparent 0%, black 40%, black 100%)",
        opacity: 0.32,
      }}
    >
      <svg
        viewBox="0 0 1600 500"
        preserveAspectRatio="xMidYMax meet"
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        {/* distant ridge */}
        <path
          d="M0 300 L120 220 L220 270 L340 170 L460 250 L590 190 L720 270 L860 210 L980 260 L1120 190 L1260 250 L1400 210 L1600 240 L1600 500 L0 500 Z"
          fill="#a9a08a"
          opacity={0.45}
        />
        {/* nearer ridge */}
        <path
          d="M0 340 L150 270 L260 320 L400 240 L520 310 L660 250 L790 320 L930 260 L1080 330 L1220 270 L1360 320 L1600 290 L1600 500 L0 500 Z"
          fill="#8f886f"
          opacity={0.55}
        />

        {/* stockpile mounds with a little scrub */}
        <path d="M20 470 L110 370 L200 470 Z" fill="#8a7a52" />
        <path d="M40 470 L110 400 L150 470 Z" fill="#6e7a4a" opacity={0.7} />
        <path d="M980 480 L1060 400 L1140 480 Z" fill="#8a7a52" />

        {/* head-frame / conveyor tower - the recognisable "mine" silhouette, left of centre */}
        <g fill="#5c5c54" opacity={0.8}>
          <rect x="150" y="230" width="12" height="250" />
          <rect x="255" y="230" width="12" height="250" />
          <rect x="158" y="228" width="103" height="12" />
          <line x1="158" y1="230" x2="261" y2="330" stroke="#5c5c54" strokeWidth={5} />
          <line x1="261" y1="230" x2="158" y2="330" stroke="#5c5c54" strokeWidth={5} />
        </g>
        {/* conveyor down to the stockpile */}
        <line x1="160" y1="255" x2="60" y2="400" stroke="#5c5c54" strokeWidth={12} strokeLinecap="round" opacity={0.75} />
        <line x1="30" y1="415" x2="420" y2="415" stroke="#5c5c54" strokeWidth={4} opacity={0.6} />

        {/* low sheds */}
        <g fill="#6b6b62" opacity={0.6}>
          <rect x="440" y="400" width="140" height="80" />
          <path d="M440 400 L510 350 L580 400 Z" />
          <rect x="600" y="425" width="100" height="55" />
        </g>

        {/* smokestacks, right */}
        <g opacity={0.6}>
          <rect x="1330" y="330" width="20" height="160" rx="2" fill="#6b6b62" />
          <rect x="1385" y="290" width="24" height="200" rx="2" fill="#5c5c54" />
          <rect x="1385" y="330" width="24" height="10" fill="#b5473a" opacity={0.7} />
          <rect x="1435" y="335" width="18" height="155" rx="2" fill="#6b6b62" />
          <rect x="1470" y="360" width="110" height="130" fill="#6b6b62" opacity={0.7} />
        </g>

        {/* clouds */}
        <g fill="#fff" opacity={0.5}>
          <ellipse cx="240" cy="90" rx="60" ry="20" />
          <ellipse cx="900" cy="60" rx="70" ry="24" />
          <ellipse cx="1300" cy="110" rx="50" ry="18" />
        </g>
      </svg>
    </div>
  );
}
