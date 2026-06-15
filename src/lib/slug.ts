// Lowercase a label to an id/url-safe slug: runs of non-alphanumerics collapse to a single dash, trimmed
// at the ends. Shared by the setup screens (team / driver creation) so ids are generated one way.
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
