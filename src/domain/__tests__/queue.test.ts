import { describe, expect, it } from 'vitest'
import { withIds } from '../queue'
import { movePurchase, removePurchase, setNotBefore } from '../plan/politicsPlan'

describe('queue item ids', () => {
  it('gives items without an id one and keeps the ones that have it', () => {
    const [a, b] = withIds([{ id: 'keep' }, {}])
    expect(a.id).toBe('keep')
    expect(b.id).toBeTruthy()
    const same = [{ id: 'x' }]
    expect(withIds(same)).toBe(same)
  })

  it('keeps an id when the queue is reordered, edited or an earlier item is removed', () => {
    const queue = withIds([{ optionId: 'a' }, { optionId: 'b' }, { optionId: 'c' }])
    const ids = queue.map((q) => q.id)
    expect(movePurchase(queue, 0, 1).map((q) => q.id)).toEqual([ids[1], ids[0], ids[2]])
    expect(setNotBefore(queue, 1, '1936-05-01')[1].id).toBe(ids[1])
    expect(removePurchase(queue, 0).map((q) => q.id)).toEqual([ids[1], ids[2]])
  })
})
