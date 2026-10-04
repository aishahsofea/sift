// Scopes a search with include_domains, not a `site:` query hack (verified against Tavily /search).
export function scopeToDomain(pageUrl: string): string {
  return new URL(pageUrl).hostname
}
