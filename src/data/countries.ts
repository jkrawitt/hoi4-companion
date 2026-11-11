export interface Country {
  tag: string
  name: string
  /** Path of the focus tree file, relative to the game installation folder. */
  focusTreeFile: string
}

/** Countries available in the selector. Only Romania for now; more (ideally auto-detected) later. */
export const countries: Country[] = [
  { tag: 'ROM', name: 'Romania', focusTreeFile: 'common/national_focus/romania.txt' },
]
