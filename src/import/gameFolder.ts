import type { GameFiles } from '@/domain/gameImport'

/** Directory prefixes the importer reads; used to avoid holding on to every file of the install. */
const NEEDED_PREFIXES = ['common/national_focus/', 'localisation/english/']

interface DirHandle {
  getDirectoryHandle(name: string): Promise<DirHandle>
  getFileHandle(name: string): Promise<{ getFile(): Promise<File> }>
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]>
}

export const canUseDirectoryPicker = () => 'showDirectoryPicker' in window

const isNotFound = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError'

const fromDirectoryHandle = (root: DirHandle): GameFiles => {
  const openDir = async (path: string): Promise<DirHandle | null> => {
    let dir = root
    try {
      for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part)
      return dir
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }
  return {
    async readText(path) {
      const parts = path.split('/')
      const dir = await openDir(parts.slice(0, -1).join('/'))
      if (!dir) return null
      try {
        return await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text()
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },
    async listFiles(path) {
      const dir = await openDir(path)
      if (!dir) return []
      const names: string[] = []
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file') names.push(name)
      }
      return names
    },
  }
}

/**
 * Chromium only: lets the user pick the install folder and reads it lazily, so only the files
 * we need are touched. Returns null if the user cancels.
 */
export const pickWithDirectoryPicker = async (): Promise<GameFiles | null> => {
  try {
    const picker = (window as unknown as { showDirectoryPicker(): Promise<DirHandle> })
      .showDirectoryPicker
    return fromDirectoryHandle(await picker.call(window))
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/** Fallback for other browsers, from `<input type="file" webkitdirectory>`'s file list. */
export const fromFileList = (list: FileList): GameFiles => {
  const files = new Map<string, File>()
  for (const file of Array.from(list)) {
    // webkitRelativePath is "<picked folder name>/<path inside it>".
    const path = file.webkitRelativePath.split('/').slice(1).join('/')
    if (NEEDED_PREFIXES.some((p) => path.startsWith(p))) files.set(path, file)
  }
  return {
    async readText(path) {
      return (await files.get(path)?.text()) ?? null
    },
    async listFiles(dir) {
      const prefix = `${dir}/`
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length))
    },
  }
}
