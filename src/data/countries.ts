export interface Country {
  tag: string
  name: string
  /** Path of the focus tree file, relative to the game installation folder. */
  focusTreeFile: string
  /** Path of the file most likely to define this country's ideas; other files are a fallback. */
  ideasFile: string
}

/** Countries available in the selector. Only Romania for now; more (ideally auto-detected) later. */
export const countries: Country[] = [
  {
    tag: 'ROM',
    name: 'Romania',
    focusTreeFile: 'common/national_focus/romania.txt',
    ideasFile: 'common/ideas/romania.txt',
  },
]
