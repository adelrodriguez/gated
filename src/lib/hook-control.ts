export class HookResolutionAbortError extends Error {
  readonly originalError: unknown

  constructor(error: unknown) {
    super(error instanceof Error ? error.message : "Hook resolution aborted")
    this.name = "HookResolutionAbortError"
    this.originalError = error
  }
}
