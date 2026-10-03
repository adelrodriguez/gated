import type { MaybePromise } from "#lib/types"

export function reportInBackground<TReport>(
  reporter: ((report: TReport) => MaybePromise<void>) | undefined,
  report: TReport
): void {
  if (!reporter) {
    return
  }

  void Promise.resolve()
    .then(() => reporter(report))
    .catch(() => null)
}
