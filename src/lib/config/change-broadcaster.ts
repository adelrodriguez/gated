import type { GatedConfig } from "#lib/types"

type ChangeListener = (keys?: readonly string[]) => void

/**
 * Sends one gate factory's provider change notifications to every listener. It attaches the
 * consumer's `subscribe` at most once at a time: on the first listener, and it detaches when the
 * last listener leaves. Listeners run synchronously, in subscription order.
 */
export type ChangeBroadcaster = {
  /**
   * Adds a listener and returns an idempotent unsubscribe function. When this listener causes the
   * attach and the consumer's `subscribe` throws, the broadcaster stays detached and rethrows. The
   * next listener tries again.
   */
  subscribe(listener: ChangeListener): () => void
}

export function createChangeBroadcaster(
  subscribe: NonNullable<GatedConfig["subscribe"]>
): ChangeBroadcaster {
  // One entry per subscription, so one function subscribed twice needs two unsubscribes.
  const listeners = new Set<{ listener: ChangeListener }>()
  let attached = false
  let detach: (() => void) | undefined

  const notify = ({ keys }: { keys?: readonly string[] }) => {
    // Snapshot: a listener added during this notification does not receive it.
    for (const entry of Array.from(listeners)) {
      entry.listener(keys)
    }
  }

  return {
    subscribe(listener) {
      const entry = { listener }
      listeners.add(entry)

      if (!attached) {
        // Set before the call: a listener that subscribes again during a synchronous notification
        // must not attach a second time.
        attached = true
        try {
          detach = subscribe(notify)
        } catch (error) {
          attached = false
          listeners.delete(entry)
          throw error
        }
      }

      let subscribed = true
      return () => {
        if (!subscribed) {
          return
        }
        subscribed = false
        listeners.delete(entry)
        if (listeners.size === 0 && attached) {
          const detachProvider = detach
          attached = false
          detach = undefined
          detachProvider?.()
        }
      }
    },
  }
}
