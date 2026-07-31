declare module 'msdf-bmfont-xml' {
  interface GenerateOptions {
    outputType?: 'xml' | 'json' | 'txt'
    fieldType?: 'msdf' | 'sdf' | 'psdf'
    fontSize?: number
    distanceRange?: number
    charset?: string
    textureSize?: [number, number]
    texturePadding?: number
    smartSize?: boolean
    pot?: boolean
    square?: boolean
  }

  function generateBMFont(
    fontPath: string,
    options: GenerateOptions,
    callback: (
      error: Error | null,
      textures: { filename: string, texture: Buffer }[],
      font: { filename: string, data: string }
    ) => void
  ): void

  export default generateBMFont
}
