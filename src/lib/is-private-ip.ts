/**
 * Checks whether a hostname points to a private/internal IP address.
 * Used for SSRF protection — prevents proxy URLs from reaching internal services.
 *
 * Covers: RFC 1918, loopback, link-local, cloud metadata, IPv6 ULA.
 */
export function isPrivateIP(hostname: string): boolean {
  // Named hostnames
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return true
  }

  // IPv6 ULA (fc00::/7 — unique local addresses, prefixes fc or fd)
  if (hostname.startsWith('fc') || hostname.startsWith('fd')) {
    return true
  }

  // IPv4 dotted-decimal check
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(isNaN)) {
    return false
  }

  const [a, b] = octets as [number, number, number, number]

  // Loopback 127.0.0.0/8
  if (a === 127) return true
  // Link-local 169.254.0.0/16 (AWS/GCP metadata endpoint)
  if (a === 169 && b === 254) return true
  // RFC 1918: 10.0.0.0/8
  if (a === 10) return true
  // RFC 1918: 172.16.0.0/12 (172.16.x.x – 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true
  // RFC 1918: 192.168.0.0/16
  if (a === 192 && b === 168) return true

  return false
}
