/** HTTPS is required for real servers; plain http only for localhost / private networks (development). */
export function isAllowedServerUrl(u: string): boolean {
  const m = /^(https?):\/\/([^/:?#]+)(?::\d{1,5})?(?:[/?#].*)?$/i.exec(u.trim()); if (!m) return false;
  if (m[1].toLowerCase() === 'https') return true; const h = m[2].toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h === '10.0.2.2') return true;
  const p = h.split('.').map(Number); if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}
