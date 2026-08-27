// The one card shell every floating panel uses - frosted glass over the dark map, per the
// UI reference. Change the look here and every stat card / target card / filter pill
// updates together; don't restyle glass inline in individual components.

import type { CSSProperties, ReactNode } from "react";

export default function GlassCard({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: "var(--glass)",
        border: "1px solid var(--glass-border)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
