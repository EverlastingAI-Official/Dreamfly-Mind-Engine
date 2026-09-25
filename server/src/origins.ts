const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];

export function allowedOrigins(appOrigin: string, production: boolean): Set<string> {
  const origins = new Set([appOrigin]);
  const url = new URL(appOrigin);
  // Local development addresses name the same app. Keep its exact protocol
  // and port, and never extend a production or non-loopback allowlist.
  if (!production && loopbackHosts.includes(url.hostname)) {
    for (const hostname of loopbackHosts) {
      url.hostname = hostname;
      origins.add(url.origin);
    }
  }
  return origins;
}
