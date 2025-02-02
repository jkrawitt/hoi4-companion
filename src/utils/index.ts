export const roundDecimal = (value: number, decimals: number) => {
  const roundingFactor = Math.pow(10, decimals)
  return Math.round(value * roundingFactor) / roundingFactor
}

export const addZeros = (baseString: string, numZeroes: number) => {
  if (numZeroes > 0 && baseString.indexOf('.') < 0) {
    return baseString + '.' + '0'.repeat(numZeroes)
  }
  return baseString
}
