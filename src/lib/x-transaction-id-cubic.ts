// ============================================================
// X Client Transaction ID — Cubic Bezier & Math Helpers
//
// Pure math functions for computing the animation key used in
// X's transaction ID algorithm. Zero network, zero HTML, zero state.
//
// Extracted from x-transaction-id.ts to reduce per-file complexity.
//
// References:
// - Lqm1/x-client-transaction-id (TypeScript, browser-based)
// - iSarabjitDhiman/XClientTransaction (Python)
// - vladkens/twscrape (Python, xclid.py)
// ============================================================

// --- Cubic Bezier Interpolation ---
// Implements CSS cubic-bezier(x1, y1, x2, y2) evaluation.
//
// The curve goes from (0,0) to (1,1) with control points (x1,y1) and (x2,y2).
// Given a time value, we need to find the corresponding y-value:
//   1. Find t such that X(t) = time  (binary search)
//   2. Return Y(t)
//
// Uses binary search instead of Newton-Raphson to exactly match the
// reference implementation (Lqm1/x-client-transaction-id). Newton-Raphson
// can prematurely break when the derivative is near-zero, which happens
// with negative control points produced by isOdd() returning -1.0.

export class Cubic {
  private curves: [number, number, number, number]

  constructor(curves: [number, number, number, number]) {
    this.curves = curves
  }

  /**
   * Evaluate the cubic bezier curve at the given time position.
   * Uses binary search to find the parameter t where X(t) ≈ time,
   * then returns Y(t) — the interpolated animation value.
   */
  getValue(time: number): number {
    // Handle values outside [0, 1] with tangent extrapolation
    if (time <= 0.0) {
      if (this.curves[0] > 0.0) {
        return (this.curves[1] / this.curves[0]) * time
      }
      if (this.curves[0] === 0.0 && this.curves[2] > 0.0) {
        return (this.curves[3] / this.curves[2]) * time
      }
      return 0.0
    }
    if (time >= 1.0) {
      if (this.curves[2] < 1.0) {
        return 1.0 + ((this.curves[3] - 1.0) / (this.curves[2] - 1.0)) * (time - 1.0)
      }
      if (this.curves[2] === 1.0 && this.curves[0] < 1.0) {
        return 1.0 + ((this.curves[1] - 1.0) / (this.curves[0] - 1.0)) * (time - 1.0)
      }
      return 1.0
    }

    // Binary search to find t where X(t) ≈ time
    let start = 0.0
    let mid = 0.0
    let end = 1.0

    while (start < end) {
      mid = (start + end) / 2
      const xEst = this.calculate(this.curves[0], this.curves[2], mid)
      if (Math.abs(time - xEst) < 0.00001) {
        return this.calculate(this.curves[1], this.curves[3], mid)
      }
      if (xEst < time) {
        start = mid
      } else {
        end = mid
      }
    }

    return this.calculate(this.curves[1], this.curves[3], mid)
  }

  /**
   * Calculate cubic bezier value: 3·a·(1-m)²·m + 3·b·(1-m)·m² + m³
   * When a=x1, b=x2 → X(t); when a=y1, b=y2 → Y(t)
   */
  private calculate(a: number, b: number, m: number): number {
    return 3.0 * a * (1 - m) * (1 - m) * m + 3.0 * b * (1 - m) * m * m + m * m * m
  }
}

export function interpolate(from: number[], to: number[], val: number): number[] {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion, security/detect-object-injection -- integer array index
  return from.map((f, i) => f + (to[i]! - f) * val)
}

export function solve(value: number, minVal: number, maxVal: number, rounding: boolean): number {
  const result = (value * (maxVal - minVal)) / 255 + minVal
  return rounding ? Math.floor(result) : Math.round(result * 100) / 100
}

export function isOdd(n: number): number {
  return n % 2 !== 0 ? -1.0 : 0.0
}

/**
 * Convert a float to its hex string representation (base-16 with fraction).
 * Handles both integer and fractional parts separately, matching the
 * reference implementations from Lqm1/x-client-transaction-id and
 * iSarabjitDhiman/XClientTransaction.
 *
 * Examples:
 *   1.0  → "1"
 *   0.87 → ".deb851eb851eb8"
 *   0.0  → ""
 *
 * The calling code handles the edge cases:
 *   - Empty string → falls through to "0" via || "0"
 *   - Starts with "." → prepends "0" and lowercases
 *   - All dots are stripped in the final key assembly
 */
export function floatToHex(x: number): string {
  const result: string[] = []
  let quotient = Math.floor(x)
  let fraction = x - quotient

  while (quotient > 0) {
    const newQuotient = Math.floor(x / 16)
    const remainder = Math.floor(x - newQuotient * 16)
    if (remainder > 9) {
      result.unshift(String.fromCharCode(remainder + 55))
    } else {
      result.unshift(remainder.toString())
    }
    x = newQuotient
    quotient = newQuotient
  }

  if (fraction === 0) {
    return result.join('')
  }

  result.push('.')
  let maxIter = 20 // Guard against IEEE 754 floating-point infinite loop
  while (fraction > 0 && maxIter-- > 0) {
    fraction *= 16
    const integer = Math.floor(fraction)
    fraction -= integer
    if (integer > 9) {
      result.push(String.fromCharCode(integer + 55))
    } else {
      result.push(integer.toString())
    }
  }

  return result.join('')
}

export function convertRotationToMatrix(degrees: number): number[] {
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [cos, sin, -sin, cos, 0, 0]
}
