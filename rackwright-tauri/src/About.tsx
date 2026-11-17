import { useEffect } from "react";
import { v } from "./theme";
import { btn } from "./web";
import { IS_WEB } from "./backend";
import { Logo } from "./Logo";
import pkg from "../package.json";

export function About({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: v("panel"), padding: 16, borderRadius: 6, width: 340, maxWidth: "94vw", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 13 }}>
        <Logo size={40} wordmark />
        <div style={{ margin: "12px 0 4px" }}>Version {pkg.version}</div>
        <div style={{ marginBottom: 4 }}>{IS_WEB ? "Web app" : "Desktop app"}</div>
        <div style={{ marginBottom: 14 }}>What's new: see CHANGELOG.md in the project.</div>
        <div style={{ textAlign: "right" }}><button style={btn} onClick={onClose} autoFocus>Close</button></div>
      </div>
    </div>
  );
}
