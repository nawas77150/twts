import { describe, it, expect } from 'vitest'
import {
  classifyError,
  parseDirectPostResponse,
  shouldRetry,
  MAX_DIRECT_ATTEMPTS,
} from '@/lib/twitter-post-error'
import type { ErrorClass } from '@/lib/twitter-post-error'

describe('classifyError', () => {
  it.each([
    ['X API returned HTTP 404: Not Found', 'stale_cache'],
    ['code: 48 — feature deprecated', 'stale_cache'],
    ['HTTP 226: unknown', 'transient'],
    ['code: 226 might be automated', 'transient'],
    ['HTTP 401: Unauthorized', 'auth_failure'],
    ['Could not authenticate you', 'auth_failure'],
    ['HTTP 429: Too Many Requests', 'rate_limit'],
    ['code: 88 Rate limit exceeded', 'rate_limit'],
    ['code: 187 — duplicate', 'duplicate_posted'],
    ['code: 353 — shadowban', 'stealth_ban'],
    ['account is suspended', 'stealth_ban'],
    ['code: 64 — suspended', 'stealth_ban'],
  ] as [string, ErrorClass][])('classifies "%s" as %s', (error, expected) => {
    expect(classifyError(error)).toBe(expected)
  })

  it('returns terminal for unrecognized errors', () => {
    expect(classifyError('something went wrong')).toBe('terminal')
  })
})

describe('parseDirectPostResponse', () => {
  it('returns success when tweetId present', () => {
    const body = {
      data: {
        create_tweet: {
          tweet_results: {
            result: { rest_id: '1234567890' },
          },
        },
      },
    }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('success')
    if (outcome.kind === 'success') {
      expect(outcome.tweetId).toBe('1234567890')
    }
  })

  it('returns empty_results when tweet_results is empty object', () => {
    const body = {
      data: {
        create_tweet: {
          tweet_results: {},
        },
      },
    }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('empty_results')
  })

  it('returns empty_results when tweet_results is null', () => {
    const body = {
      data: {
        create_tweet: {
          tweet_results: null,
        },
      },
    }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('empty_results')
  })

  it('returns graphql_error when errors array present', () => {
    const body = {
      errors: [
        { message: 'Rate limit exceeded', code: 88 },
      ],
    }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('graphql_error')
    if (outcome.kind === 'graphql_error') {
      expect(outcome.error).toContain('Rate limit exceeded')
      expect(outcome.errorClass).toBe('rate_limit')
    }
  })

  it('handles GraphQL error without code (uses "unknown")', () => {
    const body = {
      errors: [
        { message: 'Something went wrong' },
      ],
    }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('graphql_error')
    if (outcome.kind === 'graphql_error') {
      expect(outcome.error).toContain('code: unknown')
    }
  })

  it('handles multiple GraphQL errors', () => {
    const body = {
      errors: [
        { message: 'Error 1', code: 100 },
        { message: 'Error 2', code: 200 },
      ],
    }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('graphql_error')
    if (outcome.kind === 'graphql_error') {
      expect(outcome.error).toContain('Error 1')
      expect(outcome.error).toContain('Error 2')
    }
  })

  it('returns unknown_failure for unrecognized response', () => {
    const body = { foo: 'bar' }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('unknown_failure')
  })

  it('prioritizes tweetId over errors (GraphQL partial success)', () => {
    const body = {
      data: {
        create_tweet: {
          tweet_results: {
            result: { rest_id: '999' },
          },
        },
      },
      errors: [{ message: 'Some warning', code: 0 }],
    }
    const outcome = parseDirectPostResponse(body)
    expect(outcome.kind).toBe('success')
  })
})

describe('shouldRetry', () => {
  it('returns clear_and_continue for stale_cache on first attempt', () => {
    expect(shouldRetry(0, 'stale_cache')).toBe('clear_and_continue')
  })

  it('returns bail for stale_cache on retry (attempt > 0)', () => {
    expect(shouldRetry(1, 'stale_cache')).toBe('bail')
  })

  it('returns continue for transient when attempts remain', () => {
    expect(shouldRetry(0, 'transient')).toBe('continue')
    expect(shouldRetry(1, 'transient')).toBe('continue')
    expect(shouldRetry(MAX_DIRECT_ATTEMPTS - 2, 'transient')).toBe('continue')
  })

  it('returns bail for transient on last attempt', () => {
    expect(shouldRetry(MAX_DIRECT_ATTEMPTS - 1, 'transient')).toBe('bail')
  })

  it('returns bail for auth_failure', () => {
    expect(shouldRetry(0, 'auth_failure')).toBe('bail')
  })

  it('returns bail for terminal', () => {
    expect(shouldRetry(0, 'terminal')).toBe('bail')
  })

  it('returns bail for rate_limit', () => {
    expect(shouldRetry(0, 'rate_limit')).toBe('bail')
  })
})
