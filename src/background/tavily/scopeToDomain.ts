// Scopes a Tavily search to the domain the user is currently reading, via
// include_domains — not a `site:` query hack (verified against the real
// Tavily /search endpoint; results come back correctly scoped to one domain).
export function scopeToDomain(pageUrl: string): string {
  return new URL(pageUrl).hostname
}
