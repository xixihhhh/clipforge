const LOCAL_MEDIA_PATTERN = /^\/api\/(?:files|output)\/([^/?#]+)(?:[/?#]|$)/;

/**
 * Return the project namespace embedded in a local media URL.
 * External URLs and data URIs intentionally return null.
 */
export function projectIdFromLocalMediaReference(reference: string): string | null {
  const match = LOCAL_MEDIA_PATTERN.exec(reference);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

/** Prevent a project-scoped request from reading another project's local media. */
export function mediaReferencesBelongToProject(
  projectId: string,
  references: unknown[],
): boolean {
  return references.every((reference) => {
    if (typeof reference !== "string" || !reference) return true;
    const referencedProjectId = projectIdFromLocalMediaReference(reference);
    return referencedProjectId === null || referencedProjectId === projectId;
  });
}
