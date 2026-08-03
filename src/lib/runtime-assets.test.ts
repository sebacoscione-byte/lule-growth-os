import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  CONTENT_PLATE_FONT_DISPLAY,
  CONTENT_PLATE_FONT_SANS,
  CONTENT_PLATE_FONT_SANS_BOLD,
  REEL_MUSIC_DIR,
  VIDEO_CAPTION_FONT,
} from "./runtime-assets"

describe("runtime assets", () => {
  it("ancla los assets al root real de ejecución y no al directorio virtual del bundle", () => {
    expect(CONTENT_PLATE_FONT_SANS)
      .toBe(join(process.cwd(), "src", "lib", "fonts", "Inter-Regular.ttf"))
    expect(REEL_MUSIC_DIR)
      .toBe(join(process.cwd(), "src", "lib", "audio", "reel-music"))
  })

  it.each([
    CONTENT_PLATE_FONT_DISPLAY,
    CONTENT_PLATE_FONT_SANS,
    CONTENT_PLATE_FONT_SANS_BOLD,
    VIDEO_CAPTION_FONT,
  ])("incluye la fuente trazada %s", fontPath => {
    expect(existsSync(fontPath)).toBe(true)
  })
})
