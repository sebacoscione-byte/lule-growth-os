import sharp from "sharp"
import { convertImageToJpeg } from "@/lib/image-processing"

describe("convertImageToJpeg", () => {
  it("convierte PNG con transparencia a un JPEG válido", async () => {
    const png = await sharp({
      create: { width: 32, height: 24, channels: 4, background: { r: 178, g: 59, b: 52, alpha: 0.5 } },
    }).png().toBuffer()

    const jpeg = await convertImageToJpeg(png)
    const metadata = await sharp(jpeg).metadata()

    expect(metadata).toEqual(expect.objectContaining({ format: "jpeg", width: 32, height: 24 }))
    expect(metadata.hasAlpha).toBe(false)
  })
})
