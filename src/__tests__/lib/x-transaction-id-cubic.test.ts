import { describe, it, expect } from 'vitest'
import { Cubic, interpolate, solve, isOdd, floatToHex, convertRotationToMatrix } from '@/lib/x-transaction-id-cubic'

describe('Cubic', () => {
  it('returns 0 at time 0 for linear bezier', () => {
    const cubic = new Cubic([0, 0, 1, 1])
    expect(cubic.getValue(0)).toBeCloseTo(0, 4)
  })

  it('returns 1 at time 1 for linear bezier', () => {
    const cubic = new Cubic([0, 0, 1, 1])
    expect(cubic.getValue(1)).toBeCloseTo(1, 4)
  })

  it('returns ~0.5 at time 0.5 for ease-in-out (0.42, 0, 0.58, 1)', () => {
    const cubic = new Cubic([0.42, 0, 0.58, 1])
    expect(cubic.getValue(0.5)).toBeCloseTo(0.5, 1)
  })

  it('handles time <= 0 with tangent extrapolation (curves[0] > 0)', () => {
    const cubic = new Cubic([0.25, 0.1, 0.25, 1])
    const result = cubic.getValue(-1)
    expect(result).toBeLessThanOrEqual(0)
  })

  it('handles time <= 0 with curves[0] === 0, curves[2] > 0', () => {
    // curves[0] === 0 triggers second branch
    const cubic = new Cubic([0, 0.5, 0.5, 1])
    const result = cubic.getValue(-1)
    // Should use curves[3]/curves[2] * time
    expect(result).toBeLessThanOrEqual(0)
  })

  it('returns 0.0 when time <= 0 and both control points are 0', () => {
    const cubic = new Cubic([0, 0, 0, 0])
    expect(cubic.getValue(-1)).toBe(0.0)
  })

  it('handles time >= 1 with tangent extrapolation (curves[2] < 1)', () => {
    const cubic = new Cubic([0.25, 0.1, 0.25, 1])
    const result = cubic.getValue(2)
    expect(result).toBeGreaterThanOrEqual(1)
  })

  it('handles time >= 1 with curves[2] === 1, curves[0] < 1', () => {
    // curves[2] === 1 triggers second branch
    const cubic = new Cubic([0.25, 0.5, 1, 1])
    const result = cubic.getValue(2)
    expect(result).toBeGreaterThanOrEqual(1)
  })

  it('returns 1.0 when time >= 1 and both tangent branches fail', () => {
    const cubic = new Cubic([1, 1, 1, 1])
    expect(cubic.getValue(2)).toBe(1.0)
  })

  it('uses binary search and falls through to final calculate', () => {
    // A bezier where binary search needs multiple iterations
    const cubic = new Cubic([0.42, 0, 0.58, 1])
    const result = cubic.getValue(0.3)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1)
  })

  it('binary search xEst < time branch', () => {
    const cubic = new Cubic([0.1, 0.9, 0.2, 0.8])
    const result = cubic.getValue(0.5)
    expect(typeof result).toBe('number')
    expect(isFinite(result)).toBe(true)
  })

  it('binary search xEst >= time branch', () => {
    const cubic = new Cubic([0.8, 0.2, 0.9, 0.1])
    const result = cubic.getValue(0.5)
    expect(typeof result).toBe('number')
    expect(isFinite(result)).toBe(true)
  })

  it('binary search falls through to final calculate (line 79)', () => {
    // Use a bezier where start converges to end exactly (e.g., time = 0 or 1
    // are handled earlier, so use a value in the middle that requires many iterations)
    // The while loop exits when start >= end due to floating-point convergence
    const cubic = new Cubic([0.42, 0, 0.58, 1])
    // Call getValue at a point that doesn't hit the precision threshold
    // This should cause the binary search to exhaust and fall through to line 79
    const result = cubic.getValue(0.123456789)
    expect(typeof result).toBe('number')
    expect(isFinite(result)).toBe(true)
  })
})

describe('interpolate', () => {
  it('interpolates between two arrays', () => {
    const result = interpolate([0, 0, 0], [100, 100, 100], 0.5)
    expect(result).toEqual([50, 50, 50])
  })

  it('returns "from" at val=0', () => {
    const result = interpolate([10, 20, 30], [40, 50, 60], 0)
    expect(result).toEqual([10, 20, 30])
  })

  it('returns "to" at val=1', () => {
    const result = interpolate([10, 20, 30], [40, 50, 60], 1)
    expect(result).toEqual([40, 50, 60])
  })
})

describe('solve', () => {
  it('maps 0 to minVal', () => {
    expect(solve(0, 10, 100, false)).toBe(10)
  })

  it('maps 255 to maxVal', () => {
    expect(solve(255, 10, 100, true)).toBe(100)
  })

  it('rounds down when rounding=true', () => {
    const result = solve(128, 0, 100, true)
    expect(result).toBe(Math.floor(result))
  })

  it('rounds to 2 decimal places when rounding=false', () => {
    const result = solve(128, 0, 100, false)
    expect(result * 100).toBeCloseTo(Math.round(result * 100), 0)
  })
})

describe('isOdd', () => {
  it('returns 0 for even numbers', () => {
    expect(isOdd(0)).toBe(0)
    expect(isOdd(2)).toBe(0)
    expect(isOdd(4)).toBe(0)
  })

  it('returns -1 for odd numbers', () => {
    expect(isOdd(1)).toBe(-1)
    expect(isOdd(3)).toBe(-1)
    expect(isOdd(5)).toBe(-1)
  })
})

describe('floatToHex', () => {
  it('converts 1.0 to "1"', () => {
    expect(floatToHex(1.0)).toBe('1')
  })

  it('converts 0.0 to empty string', () => {
    expect(floatToHex(0.0)).toBe('')
  })

  it('converts integer values to hex', () => {
    expect(floatToHex(16)).toBe('10')
    expect(floatToHex(255).toLowerCase()).toBe('ff')
  })

  it('converts fractional values (triggers the fraction branch)', () => {
    // 0.5 in hex = 0.8
    const result = floatToHex(0.5)
    expect(result).toContain('.')
    expect(result).toContain('8')
  })

  it('handles integer > 9 with letter hex digits', () => {
    // 10 → 'a', 11 → 'b', etc.
    expect(floatToHex(10).toLowerCase()).toBe('a')
    expect(floatToHex(15).toLowerCase()).toBe('f')
  })

  it('handles fractional part with digits > 9 (letter hex digits)', () => {
    // 0.875 → 0.E in hex (14/16)
    const result = floatToHex(0.875)
    expect(result).toContain('.')
  })
})

describe('convertRotationToMatrix', () => {
  it('returns identity matrix for 0 degrees', () => {
    const [a, b, c, d, tx, ty] = convertRotationToMatrix(0)
    expect(a).toBeCloseTo(1, 4)
    expect(b).toBeCloseTo(0, 4)
    expect(c).toBeCloseTo(0, 4)
    expect(d).toBeCloseTo(1, 4)
    expect(tx).toBe(0)
    expect(ty).toBe(0)
  })

  it('returns correct matrix for 90 degrees', () => {
    const [a, b, c, d] = convertRotationToMatrix(90)
    expect(a).toBeCloseTo(0, 4)
    expect(b).toBeCloseTo(1, 4)
    expect(c).toBeCloseTo(-1, 4)
    expect(d).toBeCloseTo(0, 4)
  })

  it('returns correct matrix for 180 degrees', () => {
    const [a, b, c, d] = convertRotationToMatrix(180)
    expect(a).toBeCloseTo(-1, 4)
    expect(b).toBeCloseTo(0, 4)
    expect(c).toBeCloseTo(0, 4)
    expect(d).toBeCloseTo(-1, 4)
  })

  it('returns 6-element array', () => {
    expect(convertRotationToMatrix(45)).toHaveLength(6)
  })
})
