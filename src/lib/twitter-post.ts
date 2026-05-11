// Shared utility for posting tweets to X via OAuth 1.0a
// This posts from the AUTOBASE account (the X account you configured with API keys)
// NOT from the user's personal account.

/**
 * Post a tweet to X using OAuth 1.0a (server-side app credentials)
 * 
 * Required env vars:
 * - X_API_KEY: Your X app's API Key (Consumer Key)
 * - X_API_SECRET: Your X app's API Secret (Consumer Secret)
 * - X_ACCESS_TOKEN: Your autobase account's Access Token
 * - X_ACCESS_TOKEN_SECRET: Your autobase account's Access Token Secret
 * 
 * These are found in X Developer Portal → Your App → Keys and Tokens
 */
export async function postTweetViaOAuth1(
  text: string
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  const apiKey = process.env.X_API_KEY
  const apiSecret = process.env.X_API_SECRET
  const accessToken = process.env.X_ACCESS_TOKEN
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    const missing = [
      !apiKey && 'X_API_KEY',
      !apiSecret && 'X_API_SECRET',
      !accessToken && 'X_ACCESS_TOKEN',
      !accessTokenSecret && 'X_ACCESS_TOKEN_SECRET',
    ].filter(Boolean)

    return {
      success: false,
      error: `X API OAuth 1.0a credentials not configured. Missing: ${missing.join(', ')}`,
    }
  }

  try {
    const oauth = await import('oauth')

    const oauthClient = new oauth.OAuth(
      'https://api.x.com/oauth/request_token',
      'https://api.x.com/oauth/access_token',
      apiKey,
      apiSecret,
      '1.0A',
      null,
      'HMAC-SHA1'
    )

    return new Promise((resolve) => {
      const postData = JSON.stringify({ text })

      oauthClient.post(
        'https://api.x.com/2/tweets',
        accessToken,
        accessTokenSecret,
        postData,
        'application/json',
        (err, _data) => {
          if (err) {
            console.error('X API tweet post error:', err.statusCode, err.data)
            resolve({ success: false, error: String(err.data || err) })
            return
          }

          try {
            const result = JSON.parse(_data as string)
            const tweetId = result?.data?.id
            if (tweetId) {
              console.log('Tweet posted successfully:', tweetId)
              resolve({ success: true, tweetId })
            } else {
              console.error('Unexpected tweet response:', result)
              resolve({ success: false, error: `Unexpected response: ${JSON.stringify(result)}` })
            }
          } catch {
            resolve({ success: false, error: 'Failed to parse tweet response' })
          }
        }
      )
    })
  } catch (error) {
    console.error('OAuth 1.0a library error:', error)
    return { success: false, error: 'OAuth library error' }
  }
}
