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
  SaveSettingRequest,
  SaveFilterSettingsRequest,
  SubmissionStatus,
  SubmissionLimitsData,
} from '@/types'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

class ApiClient {
  private adminToken: string | null = null

  setAdminToken(token: string | null) {
    this.adminToken = token
  }

  getAdminToken(): string | null {
    return this.adminToken
  }

  private async request<T>(
    path: string,
    options?: RequestInit & { silent?: boolean }
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.adminToken) {
      headers['Authorization'] = `Bearer ${this.adminToken}`
    }
    if (options?.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(path, {
      ...options,
      headers: { ...headers, ...options?.headers as Record<string, string> },
    })

    if (!res.ok) {
      let message = `Request failed (${res.status})`
      try {
        const data = await res.json()
        message = data.error || data.message || message
      } catch {
        // ignore parse error
      }
      throw new ApiError(res.status, message)
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

  async submitMessage(data: SubmitMessageRequest): Promise<Submission & { autoPosted?: boolean; queued?: boolean; postCapped?: boolean; filtered?: boolean; message?: string; error?: string }> {
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

  async getStats(): Promise<Stats> {
    return this.request<Stats>('/api/admin/stats')
  }

  async getSummary(): Promise<{ cookieAuthStatus: Stats['cookieAuthStatus']; apiCredits: Stats['apiCredits']; apiLoginStatus: Stats['apiLoginStatus']; postMethodSetting: string; filterSettings: Stats['filterSettings']; circuitBreaker: Stats['circuitBreaker'] }> {
    return this.request('/api/admin/summary')
  }

  async saveSetting(key: string, value: string): Promise<{
    parsed?: { auth_token: string; ct0: string }
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

  async getSubmitters(): Promise<{ submitters: SubmitterWithStats[] }> {
    return this.request('/api/admin/submitters')
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
export { ApiError }
