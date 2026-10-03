/**
 * A supported identity attribute value.
 */
export type IdentityValue = bigint | boolean | number | object | string | symbol | null | undefined

export type Identity = {
  /**
   * A unique identifier for the user
   */
  distinctId: string | number
} & Record<string, IdentityValue>
