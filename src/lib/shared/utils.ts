export function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV !== "production"
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
