import { AdminPanel } from "#features/admin/admin-panel"
import { ShowcaseIntro } from "#features/shell/showcase-intro"
import { snapshotFlags } from "#shared/demo-provider/store"

export const dynamic = "force-dynamic"

export default function AdminPage() {
  return (
    <main className="shell page">
      <ShowcaseIntro eyebrow="overrides · latency · failure" title="Provider state" />
      <AdminPanel flags={snapshotFlags()} />
    </main>
  )
}
