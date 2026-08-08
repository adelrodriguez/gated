class HookControlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "HookControlError"
  }
}

export class DedupeOwnerFinalizationError extends HookControlError {
  readonly key: string

  constructor(key: string) {
    super(`Dedupe owner finalized before settling pending request for "${key}"`)
    this.name = "DedupeOwnerFinalizationError"
    this.key = key
  }
}

export class HookResolutionAbortError extends HookControlError {
  readonly originalError: unknown

  constructor(error: unknown) {
    super(error instanceof Error ? error.message : "Hook resolution aborted", { cause: error })
    this.name = "HookResolutionAbortError"
    this.originalError = error
  }
}
