import { MatrixTable } from "#features/matrix/matrix-table"

export const dynamic = "force-dynamic"

export default function MatrixPage() {
  return (
    <main className="shell page">
      <p className="eyebrow">Multi-user batch</p>
      <h1 className="title">One store, divergent decisions.</h1>
      <p className="lede">
        Overrides make the same typed gates resolve differently for Alice, Bob, and Carol.
      </p>
      <div className="section">
        <MatrixTable />
      </div>
    </main>
  )
}
