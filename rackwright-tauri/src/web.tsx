// Web-only UI pieces: users panel, shared rack list, dialogs. Only rendered when VITE_TARGET === "web".
import { v } from "./theme";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import * as A from "./api";
import { RackMeta, UpdateCheck, UpdateStatus, User } from "./api";

export const btn = { background: v("control"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "5px 12px", marginRight: 5, cursor: "pointer" } as const;
export const inp = { background: v("bg"), color: v("text"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: "4px 6px" } as const;
const errStyle = { color: v("danger"), fontSize: 12, margin: "6px 0" } as const;
export const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose?: () => void; children: ReactNode; width?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: v("overlay"), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: v("panel"), padding: 14, borderRadius: 6, width, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto", border: `1px solid ${v("border")}`, color: v("text"), fontSize: 13 }}>
        <div style={{ display: "flex", marginBottom: 10 }}>
          <b style={{ flex: 1, fontSize: 14 }}>{title}</b>
          {onClose && <button style={{ ...btn, marginRight: 0, padding: "1px 8px" }} onClick={onClose}>x</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>{label}<br />{children}</label>
);

export interface WebProps { user: User; signOut: () => void; setUser: (u: User) => void }

/** Header controls: user name, Change password, Users and Update server (admin), Sign out. */
export function UserBar({ web }: { web: WebProps }) {
  const [pw, setPw] = useState(false);
  const [users, setUsers] = useState(false);
  const [upd, setUpd] = useState(false);
  return (
    <span style={{ marginLeft: "auto", paddingLeft: 12, fontSize: 12, display: "inline-flex", alignItems: "center" }}>
      <span style={{ opacity: 0.8, marginRight: 8 }}>{web.user.name}{web.user.is_admin ? " (admin)" : ""}</span>
      <button style={btn} onClick={() => setPw(true)}>Change password</button>
      {web.user.is_admin && <button style={btn} onClick={() => setUsers(true)}>Users</button>}
      {web.user.is_admin && <button style={btn} onClick={() => setUpd(true)} title="Update this server to the newest version">Update server</button>}
      <button style={{ ...btn, marginRight: 0 }} onClick={web.signOut}>Sign out</button>
      {pw && <ChangePassword onClose={() => setPw(false)} />}
      {users && <UsersPanel me={web.user} onMe={web.setUser} onClose={() => setUsers(false)} />}
      {upd && <UpdatePanel onClose={() => setUpd(false)} />}
    </span>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const go = async () => { setErr(""); try { await A.changePassword(cur, nw); setOk(true); } catch (e) { setErr(msgOf(e)); } };
  return (
    <Modal title="Change password" onClose={onClose} width={320}>
      <Field label="Current password"><input style={{ ...inp, width: "100%" }} type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New password (min 8 characters)"><input style={{ ...inp, width: "100%" }} type="password" value={nw} onChange={(e) => setNw(e.target.value)} /></Field>
      {err && <div style={errStyle}>{err}</div>}
      {ok && <div style={{ color: v("ok"), fontSize: 12, margin: "6px 0" }}>Password changed.</div>}
      <button style={btn} onClick={go} disabled={!cur || !nw || ok}>Change</button>
      <button style={btn} onClick={onClose}>{ok ? "Close" : "Cancel"}</button>
    </Modal>
  );
}

function UsersPanel({ me, onMe, onClose }: { me: User; onMe: (u: User) => void; onClose: () => void }) {
  const [list, setList] = useState<User[]>([]);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [nu, setNu] = useState({ email: "", name: "", password: "", is_admin: false });
  const reload = useCallback(async () => { try { setList(await A.listUsers()); } catch (e) { setErr(msgOf(e)); } }, []);
  useEffect(() => { reload(); }, [reload]);
  const run = async (f: () => Promise<unknown>, okMsg = "") => {
    setErr(""); setNote("");
    try { await f(); setNote(okMsg); await reload(); return true; } catch (e) { setErr(msgOf(e)); return false; }
  };
  const patch = (u: User, p: { name?: string; is_admin?: boolean; password?: string }, okMsg = "") =>
    run(async () => { const r = await A.patchUser(u.id, p); if (r.id === me.id) onMe(r); }, okMsg);
  const rename = (u: User) => { const n = prompt("New name", u.name); if (n && n.trim() && n !== u.name) patch(u, { name: n.trim() }); };
  const reset = (u: User) => { const p = prompt(`New password for ${u.name} (min 8 characters)`); if (p) patch(u, { password: p }, `Password reset for ${u.name}.`); };
  const remove = (u: User) => { if (confirm(`Delete ${u.name} (${u.email})?`)) run(() => A.deleteUser(u.id)); };
  const add = async () => { if (await run(() => A.addUser(nu), `Added ${nu.name}.`)) setNu({ email: "", name: "", password: "", is_admin: false }); };
  const th = { textAlign: "left", fontWeight: 600, padding: "3px 6px", opacity: 0.7 } as const;
  const td = { padding: "3px 6px", borderTop: `1px solid ${v("panel-2")}` } as const;
  const sm = { ...btn, padding: "2px 8px", marginRight: 3, fontSize: 11 } as const;
  return (
    <Modal title="Users" onClose={onClose} width={720}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Admin</th><th style={th}></th></tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.id}>
              <td style={td}>{u.name}{u.id === me.id ? " (you)" : ""}</td>
              <td style={td}>{u.email}</td>
              <td style={td}><input type="checkbox" checked={u.is_admin} onChange={(e) => patch(u, { is_admin: e.target.checked })} /></td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                <button style={sm} onClick={() => rename(u)}>Rename</button>
                <button style={sm} onClick={() => reset(u)}>Reset password</button>
                <button style={{ ...sm, color: v("danger") }} onClick={() => remove(u)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.8 }}>Add a user. There is no email: tell them their starting password.</div>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inp, width: 170 }} placeholder="Email" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
        <input style={{ ...inp, width: 120 }} placeholder="Name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
        <input style={{ ...inp, width: 140 }} type="password" placeholder="Starting password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={nu.is_admin} onChange={(e) => setNu({ ...nu, is_admin: e.target.checked })} /> admin</label>
        <button style={{ ...btn, marginRight: 0 }} onClick={add} disabled={!nu.email || !nu.name || !nu.password}>Add</button>
      </div>
      {err && <div style={errStyle}>{err}</div>}
      {note && <div style={{ color: v("ok"), fontSize: 12, margin: "6px 0" }}>{note}</div>}
    </Modal>
  );
}

/** Admin: check for a newer version and update the LXC (runs the same script as `update`). */
function UpdatePanel({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<UpdateStatus | null>(null);
  const [chk, setChk] = useState<UpdateCheck | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [down, setDown] = useState(false); // server restarting, not answering
  const [startedFrom, setStartedFrom] = useState(""); // version when this panel started an update
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    try { setSt(await A.getUpdate()); setDown(false); setErr(""); }
    catch (e) { if (e instanceof A.ApiError && (e.status === 0 || e.status >= 502)) setDown(true); else setErr(msgOf(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const running = st?.state === "running" || down;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [st?.log]);

  const check = async () => {
    setBusy(true); setErr(""); setChk(null);
    try { setChk(await A.checkUpdate()); } catch (e) { setErr(msgOf(e)); }
    setBusy(false);
  };
  const start = async () => {
    if (!confirm("Update the server now?\n\nIt downloads and builds the new version, which takes several minutes. Rackwright keeps working while it builds, then restarts. Save your racks first.")) return;
    setBusy(true); setErr("");
    try { await A.startUpdate(); setStartedFrom(st?.version ?? ""); setChk(null); await load(); } catch (e) { setErr(msgOf(e)); }
    setBusy(false);
  };

  const ok = { color: v("ok"), fontSize: 12, margin: "6px 0" } as const;
  const when = st?.since ? new Date(st.since).toLocaleString() : "";
  return (
    <Modal title="Update server" onClose={onClose} width={680}>
      {!st && !err && <div style={{ opacity: 0.7 }}>Loading...</div>}
      {st && (
        <div style={{ marginBottom: 10 }}>
          Running version <b>{st.version}</b>{st.commit && <> (commit {st.commit}{st.branch && <>, branch {st.branch}</>})</>}.
          {st.repo && <div style={{ opacity: 0.7, fontSize: 12 }}>Updates come from {st.repo}</div>}
        </div>
      )}
      {st && !st.available && <div style={{ opacity: 0.85 }}>{st.reason}</div>}

      {st?.available && !running && (
        <>
          <button style={btn} onClick={check} disabled={busy}>Check for updates</button>
          {chk && !chk.update_available && <span style={{ ...ok, marginLeft: 6 }}>You have the newest version.</span>}
          {chk && chk.update_available && (
            <div style={{ marginTop: 10 }}>
              <div>New version <b>{chk.latest_version || chk.latest_commit}</b> (commit {chk.latest_commit}{chk.latest_date && <>, {new Date(chk.latest_date).toLocaleString()}</>}).</div>
              {chk.latest_subject && <div style={{ opacity: 0.7, fontSize: 12 }}>{chk.latest_subject}</div>}
              {chk.changes && <pre style={{ whiteSpace: "pre-wrap", background: v("bg"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: 8, maxHeight: 220, overflow: "auto", fontSize: 12, fontFamily: "inherit" }}>{chk.changes}</pre>}
              <button style={{ ...btn, marginTop: 8 }} onClick={start} disabled={busy}>Update now</button>
            </div>
          )}
        </>
      )}

      {running && (
        <div style={{ margin: "8px 0", color: v("warn") }}>
          {down ? "The server is restarting. This page reconnects by itself." : "Updating. This takes several minutes. You can close this window; the update keeps going."}
        </div>
      )}
      {st && !running && st.state === "ok" && (
        <div style={ok}>
          Last update finished{when && <> {when}</>}.
          {startedFrom && startedFrom !== st.version && <> Now on version {st.version}.</>}
          {" "}<button style={{ ...btn, padding: "2px 8px" }} onClick={() => location.reload()}>Reload page</button>
        </div>
      )}
      {st && !running && st.state === "failed" && (
        <div style={errStyle}>The last update failed{when && <> ({when})</>}. The previous version is still running. Read the log below, fix the cause, then try again.</div>
      )}
      {err && <div style={errStyle}>{err}</div>}

      {st?.log && (
        <>
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>Update log</div>
          <pre ref={logRef} style={{ background: v("log-bg"), border: `1px solid ${v("border")}`, borderRadius: 4, padding: 8, maxHeight: 260, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{st.log}</pre>
        </>
      )}
    </Modal>
  );
}

/** Shared rack list with open and delete. */
export function RackList({ currentId, onOpen, onClose }: { currentId: number | null; onOpen: (m: RackMeta) => void; onClose: () => void }) {
  const [list, setList] = useState<RackMeta[] | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(async () => { try { setList(await A.listRacks()); } catch (e) { setErr(msgOf(e)); } }, []);
  useEffect(() => { reload(); }, [reload]);
  const remove = async (m: RackMeta) => {
    if (!confirm(`Delete "${m.name}" for everyone? This cannot be undone.`)) return;
    setErr(""); try { await A.deleteRack(m.id); await reload(); } catch (e) { setErr(msgOf(e)); }
  };
  const td = { padding: "4px 6px", borderTop: `1px solid ${v("panel-2")}` } as const;
  return (
    <Modal title="Shared racks" onClose={onClose} width={760}>
      {err && <div style={errStyle}>{err}</div>}
      {list && !list.length && <div style={{ opacity: 0.7 }}>No racks saved yet. Use Save to add the current one.</div>}
      {!list && !err && <div style={{ opacity: 0.7 }}>Loading...</div>}
      {list && list.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>{["Name", "Client / site", "Updated by", "When", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "3px 6px", opacity: 0.7 }}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} style={{ background: m.id === currentId ? v("accent-soft") : undefined }}>
                <td style={td}>{m.name}</td><td style={{ ...td, opacity: m.site ? 1 : 0.55 }}>{m.site ? `${m.client} / ${m.site}` : "Unassigned"}</td><td style={td}>{m.updated_by}</td>
                <td style={td}>{new Date(m.updated_at).toLocaleString()}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button style={{ ...btn, padding: "2px 8px", marginRight: 3 }} onClick={() => onOpen(m)}>Open</button>
                  <button style={{ ...btn, padding: "2px 8px", marginRight: 0, color: v("danger") }} onClick={() => remove(m)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export function NamePrompt({ title, initial, onOk, onCancel }: { title: string; initial: string; onOk: (n: string) => void; onCancel: () => void }) {
  const [n, setN] = useState(initial);
  return (
    <Modal title={title} onClose={onCancel} width={340}>
      <form onSubmit={(e) => { e.preventDefault(); if (n.trim()) onOk(n.trim()); }}>
        <Field label="Rack name"><input style={{ ...inp, width: "100%" }} autoFocus value={n} onChange={(e) => setN(e.target.value)} /></Field>
        <button style={btn} disabled={!n.trim()}>Save</button>
        <button type="button" style={btn} onClick={onCancel}>Cancel</button>
      </form>
    </Modal>
  );
}

export function ConflictDialog({ by, onTheirs, onMine, onCancel }: { by: string; onTheirs: () => void; onMine: () => void; onCancel: () => void }) {
  return (
    <Modal title="Someone else changed this rack" onClose={onCancel} width={460}>
      <div style={{ marginBottom: 12 }}>{by ? <b>{by}</b> : "Another user"} saved a newer version since you opened it.</div>
      <button style={btn} onClick={onTheirs}>Reload theirs (discard mine)</button>
      <button style={{ ...btn, color: v("danger") }} onClick={onMine}>Overwrite with mine</button>
      <button style={{ ...btn, marginRight: 0 }} onClick={onCancel}>Cancel</button>
    </Modal>
  );
}
