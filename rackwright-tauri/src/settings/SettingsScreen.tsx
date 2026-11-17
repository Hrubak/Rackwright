// Settings screen: full-window panel with a left nav. Profile, Company, New racks, Users, Server update.
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { DARK, LIGHT, isHex6, v } from "../theme";
import { IS_WEB } from "../backend";
import * as A from "../api";
import { RACK_MODELS, GENERIC_MAX_U, GENERIC_MIN_U, kindLabel } from "../racks";
import { UpdateBody, UsersBody, WebProps, errStyle, msgOf } from "../web";
import { useSettings } from "./context";
import { settingsStore } from "./store";
import { startScreen } from "./startScreen";
import type { AssetName, StartScreen, ThemePref, Units } from "./types";

export type SettingsTab = "profile" | "company" | "racks" | "users" | "update";

const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 10px", marginRight: 5, cursor: "pointer", fontSize: 12 } as const;
const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px", fontSize: 12 } as const;
const lbl: CSSProperties = { display: "block", marginBottom: 10, fontSize: 12 };
const help: CSSProperties = { fontSize: 12, opacity: 0.7, margin: "6px 0 10px" };
const h2: CSSProperties = { fontSize: 14, margin: "0 0 10px" };

/** Shows "Saved" for 2 seconds, or the error in red. */
function useStatus() {
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = async (f: () => Promise<unknown>) => {
    setErr(""); setSaved(false);
    try { await f(); setSaved(true); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setSaved(false), 2000); return true; }
    catch (e) { setErr(msgOf(e)); return false; }
  };
  const view = <>{saved && <span style={{ color: v("ok"), fontSize: 12 }}>Saved</span>}{err && <div style={errStyle}>{err}</div>}</>;
  return { run, view };
}

function Profile({ web }: { web?: WebProps }) {
  const { prefs, savePrefs } = useSettings();
  const who = useStatus(), pw = useStatus(), pref = useStatus();
  const [name, setName] = useState(web?.user.name ?? "");
  const [email, setEmail] = useState(web?.user.email ?? "");
  const [curPw, setCurPw] = useState("");
  const [cur, setCur] = useState(""), [nw, setNw] = useState(""), [rep, setRep] = useState("");
  const emailChanged = !!web && email.trim() !== web.user.email;

  const saveMe = () => who.run(async () => {
    const u = await A.patchMe({ name: name.trim(), email: email.trim(), ...(emailChanged ? { current_password: curPw } : {}) });
    web!.setUser(u); setCurPw("");
  });
  const changePw = async () => {
    if (nw !== rep) { await pw.run(async () => { throw new Error("The new passwords do not match."); }); return; }
    if (await pw.run(() => A.changePassword(cur, nw))) { setCur(""); setNw(""); setRep(""); }
  };
  const units: Units = prefs.units ?? "mm";
  const start: StartScreen = startScreen(prefs);
  return (
    <>
      {web && (
        <>
          <h2 style={h2}>Profile</h2>
          <label style={lbl}>Name<br /><input style={{ ...inp, width: 280 }} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={lbl}>Email<br /><input style={{ ...inp, width: 280 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {emailChanged && <label style={lbl}>Current password<br /><input style={{ ...inp, width: 280 }} type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} /></label>}
          <button style={btn} onClick={saveMe} disabled={!name.trim() || !email.trim() || (emailChanged && !curPw)}>Save</button>
          {who.view}
          <h2 style={{ ...h2, marginTop: 24 }}>Change password</h2>
          <label style={lbl}>Current password<br /><input style={{ ...inp, width: 280 }} type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
          <label style={lbl}>New password (min 8 characters)<br /><input style={{ ...inp, width: 280 }} type="password" value={nw} onChange={(e) => setNw(e.target.value)} /></label>
          <label style={lbl}>Repeat new password<br /><input style={{ ...inp, width: 280 }} type="password" value={rep} onChange={(e) => setRep(e.target.value)} /></label>
          <button style={btn} onClick={changePw} disabled={!cur || !nw || !rep}>Change password</button>
          {pw.view}
        </>
      )}
      <h2 style={{ ...h2, marginTop: web ? 24 : 0 }}>Preferences</h2>
      <label style={lbl}>Theme<br />
        <select style={inp} value={prefs.theme ?? "dark"} onChange={(e) => pref.run(() => savePrefs({ theme: e.target.value as ThemePref }))}>
          <option value="dark">Dark</option><option value="light">Light</option><option value="system">Match my computer</option>
        </select>
      </label>
      <label style={lbl}>Units<br />
        <select style={inp} value={units} onChange={(e) => pref.run(() => savePrefs({ units: e.target.value as Units }))}>
          <option value="mm">Millimetres</option><option value="in">Inches</option>
        </select>
      </label>
      <label style={lbl}>Start screen<br />
        <select style={inp} value={start} onChange={(e) => pref.run(() => savePrefs({ start: e.target.value as StartScreen }))}>
          <option value="clients">Clients dashboard</option>
          <option value="last">Last rack</option>
          <option value="new">New rack</option>
          {IS_WEB && <option value="racks">Rack list</option>}
        </select>
      </label>
      {pref.view}
    </>
  );
}

function Company() {
  const { system, branding, saveSystem, setLogo } = useSettings();
  const st = useStatus(), logo = useStatus();
  const [name, setName] = useState(system.company_name ?? "");
  const [accent, setAccent] = useState(system.accent ?? "");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(system.company_name ?? ""); setAccent(system.accent ?? ""); }, [system.company_name, system.accent]);
  const valid = accent === "" || isHex6(accent);
  return (
    <>
      <h2 style={h2}>Company</h2>
      <label style={lbl}>Company name<br /><input style={{ ...inp, width: 280 }} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div style={lbl}>Logo<br />
        {branding.logo_url && <img src={branding.logo_url} alt="Company logo" style={{ height: 48, maxWidth: 240, objectFit: "contain", display: "block", margin: "4px 0 6px" }} />}
        <input ref={file} type="file" accept=".png,.svg,.jpg,.jpeg,.webp,image/png,image/svg+xml,image/jpeg,image/webp" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) logo.run(() => setLogo(f)); }} />
        <button style={btn} onClick={() => file.current?.click()}>Upload…</button>
        <button style={btn} onClick={() => logo.run(() => setLogo(null))} disabled={!branding.logo_url}>Remove</button>
        {logo.view}
      </div>
      <div style={lbl}>Accent colour<br />
        <input type="color" value={isHex6(accent) ? accent : DARK.accent} onChange={(e) => setAccent(e.target.value)} style={{ verticalAlign: "middle", marginRight: 6 }} />
        <input style={{ ...inp, width: 90, marginRight: 6 }} value={accent} placeholder={DARK.accent} onChange={(e) => setAccent(e.target.value)} />
        <button style={btn} onClick={() => setAccent("")}>Use default</button>
        {!valid && <span style={{ ...errStyle, marginLeft: 6 }}>Use a colour like {DARK.accent}.</span>}
      </div>
      <div style={help}>Shown in the top bar, on the sign-in page and in client reports.</div>
      <button style={btn} onClick={() => st.run(() => saveSystem({ company_name: name.trim(), accent }))} disabled={!valid}>Save</button>
      {st.view}
      <Reports />
    </>
  );
}

const ART: [AssetName, string][] = [["cover_art", "Cover artwork"], ["header_art", "Page header artwork"], ["footer_art", "Page footer artwork"]];
const IMG_ACCEPT = ".png,.svg,.jpg,.jpeg,.webp,image/png,image/svg+xml,image/jpeg,image/webp";

/** Reads one asset; reloads when assetsVersion changes. */
function useAsset(name: AssetName) {
  const { assetsVersion } = useSettings();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    settingsStore().getAsset(name).then((b) => { if (live) setBlob(b); }, () => { if (live) setBlob(null); });
    return () => { live = false; };
  }, [name, assetsVersion]);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return { blob, url };
}

function ArtRow({ name, label }: { name: AssetName; label: string }) {
  const { setAsset } = useSettings();
  const st = useStatus();
  const { blob, url } = useAsset(name);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div style={lbl}>{label}<br />
      {url && <img src={url} alt={label} style={{ maxHeight: 60, maxWidth: 240, objectFit: "contain", display: "block", margin: "4px 0 6px" }} />}
      <input ref={file} type="file" accept={IMG_ACCEPT} style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) st.run(() => setAsset(name, f)); }} />
      <button style={btn} onClick={() => file.current?.click()}>Upload…</button>
      <button style={btn} onClick={() => st.run(() => setAsset(name, null))} disabled={!blob}>Remove</button>
      {st.view}
    </div>
  );
}

function FontRow({ name, label }: { name: AssetName; label: string }) {
  const { setAsset } = useSettings();
  const st = useStatus();
  const { blob } = useAsset(name);
  const [fileName, setFileName] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <div style={lbl}>{label}: <span style={{ opacity: 0.7 }}>{blob ? fileName || "Uploaded" : "Not set"}</span><br />
      <input ref={file} type="file" accept=".ttf,.otf,font/ttf,font/otf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) st.run(async () => { await setAsset(name, f); setFileName(f.name); }); }} />
      <button style={btn} onClick={() => file.current?.click()}>Upload…</button>
      <button style={btn} onClick={() => st.run(async () => { await setAsset(name, null); setFileName(""); })} disabled={!blob}>Remove</button>
      {st.view}
    </div>
  );
}

function Reports() {
  const { system, saveSystem } = useSettings();
  const st = useStatus();
  const [sec, setSec] = useState(system.report_secondary ?? "");
  const [addr, setAddr] = useState(system.address_line ?? "");
  const [font, setFont] = useState(system.report_font_name ?? "");
  useEffect(() => { setSec(system.report_secondary ?? ""); setAddr(system.address_line ?? ""); setFont(system.report_font_name ?? ""); }, [system.report_secondary, system.address_line, system.report_font_name]);
  const valid = sec === "" || isHex6(sec);
  return (
    <>
      <h2 style={{ ...h2, marginTop: 24 }}>Reports</h2>
      <div style={lbl}>Secondary colour<br />
        <input type="color" value={isHex6(sec) ? sec : LIGHT.text} onChange={(e) => setSec(e.target.value)} style={{ verticalAlign: "middle", marginRight: 6 }} />
        <input style={{ ...inp, width: 90, marginRight: 6 }} value={sec} placeholder={LIGHT.text} onChange={(e) => setSec(e.target.value)} />
        <button style={btn} onClick={() => setSec("")}>Use default</button>
        {!valid && <span style={{ ...errStyle, marginLeft: 6 }}>Use a colour like {LIGHT.text}.</span>}
      </div>
      <label style={lbl}>Address line<br /><input style={{ ...inp, width: 360 }} maxLength={200} value={addr} onChange={(e) => setAddr(e.target.value)} /></label>
      <div style={help}>Shown in the footer of every report page.</div>
      <FontRow name="font_regular" label="Font, Regular" />
      <FontRow name="font_bold" label="Font, Bold" />
      <label style={lbl}>Font name<br /><input style={{ ...inp, width: 280 }} maxLength={100} value={font} onChange={(e) => setFont(e.target.value)} /></label>
      <div style={help}>Without a font, reports use Noto Sans.</div>
      {ART.map(([n, l]) => <ArtRow key={n} name={n} label={l} />)}
      <button style={btn} disabled={!valid} onClick={() => st.run(() => saveSystem({ report_secondary: sec, address_line: addr.trim(), report_font_name: font.trim() }))}>Save</button>
      {st.view}
    </>
  );
}

function NewRacks() {
  const { system, saveSystem } = useSettings();
  const st = useStatus();
  const [model, setModel] = useState(system.rack_default_model ?? "");
  const [u, setU] = useState(system.rack_default_u != null ? String(system.rack_default_u) : "");
  useEffect(() => { setModel(system.rack_default_model ?? ""); setU(system.rack_default_u != null ? String(system.rack_default_u) : ""); }, [system.rack_default_model, system.rack_default_u]);
  const un = u === "" ? undefined : Number(u);
  const uOk = un === undefined || (Number.isInteger(un) && un >= GENERIC_MIN_U && un <= GENERIC_MAX_U);
  return (
    <>
      <h2 style={h2}>New racks</h2>
      <label style={lbl}>Default rack model<br />
        <select style={{ ...inp, width: 360 }} value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">No default</option>
          {RACK_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} ({kindLabel(m.kind)}, {m.u}U)</option>)}
        </select>
      </label>
      <label style={lbl}>Default height (U)<br />
        <input style={{ ...inp, width: 80 }} type="number" min={GENERIC_MIN_U} max={GENERIC_MAX_U} value={u} onChange={(e) => setU(e.target.value)} />
      </label>
      {!uOk && <div style={errStyle}>Use a whole number from {GENERIC_MIN_U} to {GENERIC_MAX_U}.</div>}
      <button style={btn} disabled={!uOk} onClick={() => st.run(() => saveSystem({ rack_default_model: model, rack_default_u: un }))}>Save</button>
      {st.view}
    </>
  );
}

export default function SettingsScreen({ tab, setTab, web, onClose }: { tab: SettingsTab; setTab: (t: SettingsTab) => void; web?: WebProps; onClose: () => void }) {
  const admin = !IS_WEB || !!web?.user.is_admin;
  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [onClose]);
  const tabs: [SettingsTab, string][] = [["profile", "Profile"]];
  if (admin) tabs.push(["company", "Company"], ["racks", "New racks"]);
  if (IS_WEB && web?.user.is_admin) tabs.push(["users", "Users"], ["update", "Server update"]);
  const cur: SettingsTab = tabs.some(([id]) => id === tab) ? tab : "profile";
  let body: ReactNode = null;
  if (cur === "profile") body = <Profile web={IS_WEB ? web : undefined} />;
  else if (cur === "company") body = <Company />;
  else if (cur === "racks") body = <NewRacks />;
  else if (cur === "users" && web) body = <UsersBody me={web.user} onMe={web.setUser} />;
  else if (cur === "update") body = <UpdateBody />;
  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay-strong"), zIndex: 90, display: "flex", alignItems: "stretch", justifyContent: "center", padding: 20 }}>
      <div role="dialog" aria-label="Settings" style={{ background: v("panel"), border: `1px solid ${v("border")}`, borderRadius: 6, color: v("text"), fontSize: 13, display: "flex", flexDirection: "column", width: "100%", maxWidth: 1100 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${v("border-subtle")}` }}>
          <b style={{ fontSize: 15, flex: 1 }}>Settings</b>
          <button style={{ ...btn, marginRight: 0 }} onClick={onClose}>Close</button>
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ width: 200, borderRight: `1px solid ${v("border-subtle")}`, padding: 10 }}>
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} aria-current={id === cur ? "page" : undefined} style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", color: v("text"), border: "none", padding: "6px 8px", borderRadius: 4, cursor: "pointer", marginBottom: 2, background: id === cur ? v("accent-soft") : "none" }}>{label}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 18 }}>{body}</div>
        </div>
      </div>
    </div>
  );
}
