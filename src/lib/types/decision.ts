export type Decision<TPayload = unknown> =
  | {
      type: "boolean"
      value: boolean
    }
  | {
      type: "variant"
      variant: string
      payload?: TPayload
    }

export type DecisionSource = "cache" | "provider"

type EvaluationDetailsBase<TValue> = {
  value: TValue
  flagKey: string
}

type EvaluationDetailsPayload<TValue, TPayload> = [Extract<TValue, string>] extends [never]
  ? unknown
  : {
      /**
       * Present only when a successful variant decision includes provider metadata.
       */
      payload?: TPayload
    }

export type EvaluationDetails<TValue, TPayload = unknown> = EvaluationDetailsBase<TValue>
  & EvaluationDetailsPayload<TValue, TPayload>
  & (
    | { source: DecisionSource; error?: never }
    | {
        source: "default"
        /**
         * The failure that caused evaluation to use the configured default.
         */
        error: Error
      }
  )
