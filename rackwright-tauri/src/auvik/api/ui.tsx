// Shared look for the Import from Auvik screen (the same as the .xlsx import screen).
import { v } from "../../theme";

export const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
export const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "3px 5px" } as const;

// Green pulsing loading line. Render <BusyStyle /> once in the dialog root.
export function BusyStyle() {
  return <style>{`@keyframes rw-busy-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } } .rw-busy { animation: rw-busy-pulse 1.6s ease-in-out infinite } @media (prefers-reduced-motion: reduce) { .rw-busy { animation: none } }`}</style>;
}

export function Busy({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div role="status" className="rw-busy" style={{ color: v("ok-text"), ...style }}>{children}</div>;
}
