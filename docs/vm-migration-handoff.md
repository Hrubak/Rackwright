# Handoff: Virtual machines and migration planning

Status: idea stage, 2026-11-18. Nothing built yet. This note collects what we discussed so the team can answer the open questions and work up a plan.

## What we want

Show where virtual machines live today and plan where they will live after a hardware upgrade.

The usual job: an old single hypervisor host is replaced by a **3-node cluster**. After the move, a VM belongs to the **cluster**, not to one node, because the cluster can run it on any node.

## Who it is for

Both groups use the same plan, so the two never drift apart:

- **Clients**, to understand and sign off the upgrade. They need a clear picture of today and the future state, and proof that the new cluster is big enough.
- **Techs**, to run the cutover. They need the move order, the batches (waves) and a status for each VM.

## What Rackwright has today

- **Auvik import** (`rackwright-tauri/src/auvik/plan.ts`, `apply.ts`, `diff.ts`):
  - VMs are grouped into one off-rack device per host, of type "Virtual machines", named "VMs on HOST" (or "VMs (no host)").
  - Each VM is a member row with name, type, model, IP, MAC and status (`Member`, `PlanVmBox` in `plan.ts`).
  - The host is guessed from vendor words (`guessHost`), and you can change it in the import review.
  - Infra-looking VMs with no physical link (vCenter, controllers, firewalls) are listed but not drawn (`INFRA_VM`).
- **Editing:** `auvik/EndpointEditor.tsx` edits the member list of a VM box.
- **Cabling view:** the cabling view can hide cables to VM boxes.
- **What is missing:**
  - No cluster.
  - No VM size (vCPU, RAM, disk).
  - No "planned" or future state.
  - No VM diagram and no VM section in the client report.

## Ideas

1. **Clusters.** A cluster is a named group of server nodes that are already in the racks, plus its storage (shared SAN/NAS, Ceph, vSAN or S2D). Every VM is assigned either to a host or to a cluster.
2. **Now and Planned.** Each VM has a current place and a planned place. One switch shows today or the future state, and the same VM list drives both.
3. **Side-by-side diagram.** The old host with its VMs on the left, the new cluster (nodes and storage) with its VMs on the right, and arrows for what moves. Clicking a node opens it in its rack.
4. **Capacity check.** Add up the planned VMs' vCPU, RAM and disk, and compare the totals with the cluster.
   - Warn when the cluster can't carry the load with one node down (N+1).
   - Show the headroom left for growth.
   - This is the "it is big enough" proof for the client.
5. **Migration waves.** Group VMs into waves (for example "Weekend 1: file and print", "Weekend 2: SQL and line-of-business apps").
   - Each wave has a date, an order and a status per VM: planned, moved, checked, rolled back.
   - Optional notes: downtime window, owner, dependencies (move SQL before the app server).
6. **Report.**
   - A VM inventory table: VM, current host, target cluster, vCPU / RAM / disk, wave, status.
   - The before and after diagrams and the capacity summary.
   - This goes in the client report, and later in the 3.18.0 Word report.
7. **Old hardware.** When every VM has left a host, mark that host "to retire" so the rack and floor plan views can show what comes out.

## Questions for the team

These decide what gets built. The first one matters most.

1. **Where do VM details come from?** How do you collect the VM list and sizes today: RVTools, the vCenter / Proxmox / Hyper-V console, a script, or by hand? Rackwright could read that export, or let you type sizes in quickly.
2. **Which platforms, from and to?** For example VMware to Proxmox, VMware to Hyper-V, or Hyper-V to Hyper-V. This sets the storage options and words the cluster needs (Ceph, S2D, vSAN, SAN).
3. **How big is a typical job?** 5 VMs or 80? Large jobs need bulk editing and filters; small ones can live on one screen.
4. **What does "fits" mean to you?** N+1 with one node down? A RAM over-commit ratio? A vCPU-to-core ratio? A disk headroom target?
5. **Which parts does the client see?** Should status and tech notes be hidden in the client report?
6. **Beyond one host to 3 nodes?** Do you also plan host-to-host moves, two old hosts into one cluster, or moves to the cloud?
7. **Does Auvik stay the starting point?** Should the VM list from the Auvik import become the "Now" state, with sizes added on top?
8. **Plan history.** Do you need more than one plan per client (option A vs option B), or one plan that is updated as you go?

## Constraints to keep

- Desktop and web share one front end, and web-only code stays behind `IS_WEB`.
- `.rack.json` stays one format: unknown fields must survive a load and save. Clusters and plans probably belong to the client or site (`clients/store.ts`) rather than one rack, because a cluster spans racks.
- Re-running an Auvik import must not wipe planned hosts, sizes or waves. Lock edited fields, as site visit does for Auvik fields.
- Real customer data stays local. Tests and mocks use made-up names ("Example IT", "EX-HV01", "EX-CL01").
- UI copy is plain language, and colours go only through `v(token)`.

## Suggested next step

Answer questions 1 and 2 first. With those, we can choose an approach (importer first vs. typing sizes in first), write the design and plan, and slot it into the roadmap after 3.18.0 (Word report), or before it if the VM section should be in the Word report from the start.

## Team answers

Answers from the team, 2026-11-18. They cover the Auvik API import (which comes before the VM migration plan) and the rules shared with the later Asio work.

### Release order

3.18.0 Word report, then the Auvik API import, then the VM migration plan (clusters, now/planned, Scale Computing HyperCore targets, waves, capacity check), then "Fill from Asio" (ConnectWise Asio API, later).

### Auvik API import, alongside the CSV import (not replacing it)

- **Web only.** The desktop keeps the CSV import. The server makes the calls, because the browser can't call Auvik directly and the key must not reach it.
- **Credentials:**
  - The feature shows only when an Auvik key is configured.
  - Username, region and key live server-side. The key comes from an env var (for example `AUVIK_API_KEY`) and never goes in the repo or `.rack.json`.
  - "Test connection" uses `GET /authentication/verify`.
  - Auth is Basic (username plus API key) at `https://auvikapi.<region>.my.auvik.com/v1`.
- **Tenants:** `GET /tenants` and `/tenants/detail`.
  - A `multiClient` tenant becomes the Client, and its child `client` tenants become Sites. The user picks the client.
  - Skip, with a note, any site the key can't read or that has no collectors. Don't fail the whole import.
- **Per site:** pull `/inventory/device/info` (`page[first]=1000`, follow `links.next`), `/inventory/device/detail` (discovery status) and `/inventory/component/info` (disks, CPUs, memory, power supplies).
  - In a live test against one real client, about 120 devices came back.
  - Most switches, APs, firewalls, servers and hypervisors had model, serial and firmware. The UPS had none.
- **Placement:**
  - Fill rack heights from the catalog by make and model.
  - Rack-mountable types (switch, stack, firewall, server, hypervisor, storage, UPS) go to a per-site "to place" list. Everything else goes to a non-rack inventory list.
  - Auto-place only when a RackMap layout is also supplied, reusing the 3.15.0 matching.
- **Preview:** shown before anything is written. The user can deselect items.

### Rules for this and the later Asio work

- Re-imports fill empty fields only, unless the user picks overwrite.
- Track which source each field came from (Auvik, Asio, CSV or manual).
- Never wipe placements, manual edits or the migration plan.
- Tests use recorded, made-up API responses only: pagination, a denied site, an empty site, missing fields. No real client data.
- The Auvik import is its own versioned release after 3.18.0. Update CHANGELOG and README.

Design: `docs/superpowers/specs/2026-11-18-auvik-api-import-design.md`.
