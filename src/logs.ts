export interface LogEntry {
  ip: string;
  userAgent: string;
}

// host ident authuser [date] "request" status bytes "referer" "user-agent"
const COMBINED = /^(\S+) \S+ \S+ \[[^\]]*\] "(?:[^"\\]|\\.)*" \d{3} \S+ "(?:[^"\\]|\\.)*" "((?:[^"\\]|\\.)*)"/;

/**
 * Extracts the client IP and User-Agent from one access-log line in the
 * Apache/Nginx "combined" format (Caddy and most CDNs can emit it too).
 * Returns `null` for lines in another format.
 */
export function parseLogLine(line: string): LogEntry | null {
  const match = COMBINED.exec(line);
  if (!match) return null;
  return { ip: match[1] as string, userAgent: (match[2] as string).replace(/\\(.)/g, '$1') };
}
