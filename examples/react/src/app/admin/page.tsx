import { AdminPanel } from "#features/admin/admin-panel"
import { snapshotFlags } from "#shared/demo-provider/store"

export const dynamic = "force-dynamic"

export default function AdminPage() {
  return (
    <main className="shell page">
      <p className="eyebrow">Control surface</p>
      <h1 className="title">Change the decisions.</h1>
      <p className="lede">
        Every control mutates the local in-memory store. Open another demo page to see server
        evaluations update immediately; the client page stays cached until you invalidate it.
      </p>
      <AdminPanel flags={snapshotFlags()} />
    </main>
  )
}
