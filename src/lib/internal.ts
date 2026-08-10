class HookControlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "HookControlError"
  }
}

export function normalizeError(error: unknown): Error {
  try {
    if (error instanceof Error) {
      return error
    }

    if (typeof error === "object" && error !== null) {
      try {
        return new Error(JSON.stringify(error) || "Non-Error object thrown")
      } catch {
        return new Error("Non-Error object thrown")
      }
    }

    if (typeof error === "function") {
      return new Error("Non-Error function thrown")
    }

    return new Error(String(error))
  } catch {
    // Even inspecting a thrown value can fail (for example, a revoked Proxy throws from
    // `instanceof`). Error normalization must remain total to preserve fail-soft evaluation.
    return new Error("Uninspectable value thrown")
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
  readonly originalError: Error

  constructor(error = new Error("Hook resolution aborted")) {
    super(error.message, { cause: error })
    this.name = "HookResolutionAbortError"
    this.originalError = error
  }
}
