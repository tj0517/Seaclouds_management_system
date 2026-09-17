import { describe, expect, it, vi } from 'vitest'
import { SKIPPED, singleFlight } from './single-flight'

/** A promise you resolve by hand, so "still in flight" is a state we control. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('singleFlight', () => {
  it('runs the call when nothing is in flight', async () => {
    const fn = vi.fn(async (n: number) => n * 2)
    const guarded = singleFlight(fn)
    await expect(guarded(21)).resolves.toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('refuses a second call while the first is still pending', async () => {
    const d = deferred<string>()
    const fn = vi.fn(() => d.promise)
    const guarded = singleFlight(fn)

    // Both clicks happen before the first call settles — the case a disabled
    // attribute cannot catch, because React has not committed it yet.
    const first = guarded()
    const second = guarded()

    await expect(second).resolves.toBe(SKIPPED)
    expect(fn).toHaveBeenCalledTimes(1)

    d.resolve('saved')
    await expect(first).resolves.toBe('saved')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('refuses every extra call, not just the second', async () => {
    const d = deferred<undefined>()
    const fn = vi.fn(() => d.promise)
    const guarded = singleFlight(fn)
    const first = guarded()
    const rest = await Promise.all([guarded(), guarded(), guarded()])
    expect(rest).toEqual([SKIPPED, SKIPPED, SKIPPED])
    expect(fn).toHaveBeenCalledTimes(1)
    d.resolve(undefined)
    await first
  })

  it('accepts the next call once the first has settled', async () => {
    const fn = vi.fn(async () => 'ok')
    const guarded = singleFlight(fn)
    await guarded()
    await expect(guarded()).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('releases the latch when the call rejects, so a failed save is retryable', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok')
    const guarded = singleFlight(fn)
    await expect(guarded()).rejects.toThrow('network')
    await expect(guarded()).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('passes arguments through untouched', async () => {
    const fn = vi.fn(async (id: { id: string }, tags: string[], n: number) => `${id.id}:${tags.join()}:${n}`)
    const guarded = singleFlight(fn)
    await expect(guarded({ id: 'x' }, ['a'], 3)).resolves.toBe('x:a:3')
    expect(fn).toHaveBeenCalledWith({ id: 'x' }, ['a'], 3)
  })

  it('latches per wrapper, so two different buttons do not block each other', async () => {
    const d = deferred<undefined>()
    const a = vi.fn(() => d.promise)
    const b = vi.fn(async () => 'b')
    const guardedA = singleFlight(a)
    const guardedB = singleFlight(b)
    const pendingA = guardedA()
    await expect(guardedB()).resolves.toBe('b')
    d.resolve(undefined)
    await pendingA
  })
})
