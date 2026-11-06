/** The exact drawing file decisions are made on: its name and SHA-256 (null when the browser refuses crypto.subtle: https or localhost only). */
export interface FileRef { file: string; sha256: string | null }

export async function fileIdentity(file: File): Promise<FileRef> {
  try {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    return { file: file.name, sha256: [...hash].map(b => b.toString(16).padStart(2, '0')).join('') };
  } catch {
    return { file: file.name, sha256: null };
  }
}

/** What a page selection is bound to: the file's SHA-256, or (only when hashing is refused) name + size + modified time — never the name alone. */
export const fileKey = (file: File, ref: FileRef) => ref.sha256 ?? `nohash:${file.name}:${file.size}:${file.lastModified}`;
