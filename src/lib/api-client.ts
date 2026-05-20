// ============================================================
// Tweetfess — Centralized API Client
// ============================================================

import type {
  AuthCheckResponse,
  AdminLoginResponse,
  Submission,
  PaginatedSubmissions,
  Stats,
  FilterSettings,
  SubmitterWithStats,
  SubmitMessageRequest,
  SaveFilterSettingsRequest,
  SubmissionStatus,
  SubmissionLimitsData,
} from '@/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const API_PREFIX_WHITELIST: readonly string[] = [
  '/api/auth/', '/api/submissions', '/api/admin/',
]

/** Validate path against allowed API route prefixes (SAST: prevent SSRF). */
function validateApiPath(path: string): string {
  if (!API_PREFIX_WHITELIST.some(p => path.startsWith(p))) {
    throw new ApiError(400, 'Invalid API path: must be a relative /api/ path')
  }
  return path
}

class ApiClient {
  private async request<T>(
    path: string,
    options?: RequestInit & { silent?: boolean }
  ): Promise<T> {
    const safePath = validateApiPath(path)

    const headers: Record<string, string> = {}
    if (options?.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(safePath, { // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
      ...options,
      headers: { ...headers, ...options?.headers as Record<string, string> },
    })

    if (!res.ok) {
      let message = `Request failed (${res.status})`
      let data: Record<string, unknown> | undefined
      try {
        data = await res.json()
        const errVal = typeof data?.error === 'string' ? data.error : undefined
        const msgVal = typeof data?.message === 'string' ? data.message : undefined
        message = errVal ?? msgVal ?? message
      } catch {
        // ignore parse error
      }
      throw new ApiError(res.status, message, data)
    }

    return res.json()
  }

  // --- Auth ---

  async checkAuth(): Promise<AuthCheckResponse> {
    return this.request<AuthCheckResponse>('/api/auth/me')
  }

  async logout(): Promise<void> {
    await this.request('/api/auth/logout', { method: 'POST' })
  }

  // --- Submissions ---

  async submitMessage(data: SubmitMessageRequest): Promise<Submission & { autoPosted?: boolean; queued?: boolean; postFailed?: boolean; postCapped?: boolean; censored?: boolean; censoredReason?: 'ai' | 'filter' | 'both'; message?: string; error?: string }> {
    return this.request('/api/submissions', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async getMyPosts(): Promise<{ submissions: Submission[]; limits?: SubmissionLimitsData; stats?: Record<string, number> }> {
    return this.request('/api/submissions/mine')
  }

  async getSubmissions(params: {
    status?: SubmissionStatus | 'all'
    page?: number
    limit?: number
    search?: string
  }): Promise<PaginatedSubmissions> {
    const searchParams = new URLSearchParams()
    if (params.status && params.status !== 'all') searchParams.set('status', params.status)
    if (params.page) searchParams.set('page', String(params.page))
    if (params.limit) searchParams.set('limit', String(params.limit))
    if (params.search) searchParams.set('search', params.search)
    const query = searchParams.toString()
    return this.request<PaginatedSubmissions>(`/api/submissions${query ? `?${query}` : ''}`)
  }

  async approveSubmission(id: string): Promise<{
    autoPosted?: boolean
    postMethod?: string
    description?: string
    warning?: string
    error?: string
  }> {
    return this.request(`/api/submissions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    })
  }

  async rejectSubmission(id: string): Promise<{ error?: string }> {
    return this.request(`/api/submissions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    })
  }

  async deleteSubmission(id: string): Promise<void> {
    await this.request(`/api/submissions/${id}`, { method: 'DELETE' })
  }

  async retryPost(id: string): Promise<{ tweetId?: string; error?: string }> {
    return this.request(`/api/submissions/${id}/post`, { method: 'POST' })
  }

  // --- Admin ---

  async adminLogin(password: string): Promise<AdminLoginResponse> {
    return this.request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  }

  async adminLogout(): Promise<void> {
    await this.request('/api/admin/logout', { method: 'POST' })
  }

  async checkSession(): Promise<{ authenticated: boolean }> {
    return this.request('/api/admin/session')
  }

  async getStats(): Promise<Stats> {
    return this.request<Stats>('/api/admin/stats')
  }

  async saveSetting(key: string, value: string): Promise<{
    parsed?: { auth_token: string; ct0: string; twid: string }
    autoLogin?: { attempted: boolean; success: boolean; error?: string }
    error?: string
  }> {
    return this.request('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    })
  }

  async deleteSetting(key: string): Promise<void> {
    await this.request(`/api/admin/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
  }

  async getFilterSettings(): Promise<FilterSettings> {
    return this.request<FilterSettings>('/api/admin/filter-settings')
  }

  async saveFilterSettings(data: SaveFilterSettingsRequest): Promise<{ error?: string }> {
    return this.request('/api/admin/filter-settings', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async clearCache(): Promise<{ error?: string }> {
    return this.request('/api/admin/clear-cache', { method: 'POST' })
  }

  async resetCircuitBreaker(): Promise<{ error?: string }> {
    return this.request('/api/admin/circuit-breaker/reset', { method: 'POST' })
  }

  async getSubmitters(params?: { cursor?: string; limit?: number }): Promise<{ submitters: SubmitterWithStats[]; nextCursor: string | null; hasMore: boolean }> {
    const searchParams = new URLSearchParams()
    if (params?.cursor) searchParams.set('cursor', params.cursor)
    if (params?.limit) searchParams.set('limit', String(params.limit))
    const query = searchParams.toString()
    return this.request(`/api/admin/submitters${query ? `?${query}` : ''}`)
  }

  async blockUser(username: string): Promise<{ error?: string }> {
    return this.request('/api/admin/submitters/block', {
      method: 'POST',
      body: JSON.stringify({ username }),
    })
  }

  async unblockUser(username: string): Promise<{ error?: string }> {
    return this.request('/api/admin/submitters/unblock', {
      method: 'POST',
      body: JSON.stringify({ username }),
    })
  }

  async setCustomLimits(username: string, customLimits: Record<string, number | null> | null): Promise<{
    success?: boolean
    submitter?: { id: string; username: string; customLimits: Record<string, number> | null }
    error?: string
  }> {
    return this.request('/api/admin/submitters/limits', {
      method: 'PATCH',
      body: JSON.stringify({ username, customLimits }),
    })
  }

  async whitelistUser(username: string): Promise<{ success?: boolean; whitelisted?: string; error?: string }> {
    return this.request('/api/admin/submitters/whitelist', {
      method: 'POST',
      body: JSON.stringify({ username }),
    })
  }

  async unwhitelistUser(username: string): Promise<{ success?: boolean; removed?: string; error?: string }> {
    return this.request('/api/admin/submitters/whitelist', {
      method: 'DELETE',
      body: JSON.stringify({ username }),
    })
  }

  async getLimitHits(): Promise<{
    summary: { limitType: string; label: string; totalHits: number; uniqueUsers: number }[]
    topUsers: { username: string; hits: number }[]
    totalHits: number
    windowLabel: string
  }> {
    return this.request('/api/admin/limit-hits')
  }
}

export const apiClient = new ApiClient()
