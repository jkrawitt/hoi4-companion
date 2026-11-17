/**
 * Helpers for the queues the player orders: research, construction and political power.
 *
 * Ids: a position in the queue changes when an earlier item goes, so anything attached to an item
 * (a tick on the timeline) goes by its id.
 */
export const newId = (): string => globalThis.crypto.randomUUID()

/** Gives every item without an id one (saved queues from before ids, and newly added items). */
export const withIds = <T extends { id?: string }>(list: T[]): T[] =>
  list.some((item) => !item.id)
    ? list.map((item) => (item.id ? item : { ...item, id: newId() }))
    : list

/** Moves an item up (-1) or down (1); out of range leaves the queue as it was. */
export const moveItem = <T>(queue: T[], index: number, by: -1 | 1): T[] => {
  const target = index + by
  if (index < 0 || index >= queue.length || target < 0 || target >= queue.length) return queue
  const moved = [...queue]
  ;[moved[index], moved[target]] = [moved[target], moved[index]]
  return moved
}
