/** Match the reference editor's A–Z names, then use the numeric version. */
export function formatVersion(version: number, locale: string): string {
  const name = version >= 1 && version <= 26 ? String.fromCharCode(64 + version) : String(version);
  return locale === "en" ? `Version ${name}` : `${name} 版`;
}
