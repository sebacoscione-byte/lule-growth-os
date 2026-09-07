import sharp from "sharp"
import { composeContentPlate } from "@/lib/content-plate"

const PHOTO_RGB = [20, 100, 160] as const

function sampleRgb(raw: Buffer, width: number, x: number, y: number): [number, number, number] {
  const index = (y * width + x) * 4
  return [raw[index], raw[index + 1], raw[index + 2]]
}

describe("composeContentPlate V2.1", () => {
  it("integra foto full-bleed con cobertura marfil gradual, sin un corte vertical", async () => {
    const photo = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 100, b: 160 } },
    }).png().toBuffer()
    const output = await composeContentPlate({
      photoBuffer: photo,
      headline: "TU CONTROL CARDIOVASCULAR EN LANÚS",
      subtitle: "Atención médica personalizada y sin apuro",
      format: "post",
    })
    const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const paperZone = sampleRgb(data, info.width, 40, 40)
    const transitionZone = sampleRgb(data, info.width, 670, 40)
    const photoZone = sampleRgb(data, info.width, 900, 40)

    expect(info).toEqual(expect.objectContaining({ width: 1080, height: 1350, channels: 4 }))
    expect(paperZone[0]).toBeGreaterThan(235)
    expect(paperZone[1]).toBeGreaterThan(235)
    expect(paperZone[2]).toBeGreaterThan(225)
    expect(transitionZone).not.toEqual(paperZone)
    expect(transitionZone).not.toEqual(photoZone)
    expect(transitionZone[0]).toBeGreaterThan(PHOTO_RGB[0] + 30)
    expect(transitionZone[0]).toBeLessThan(paperZone[0] - 20)
    photoZone.forEach((channel, index) => {
      expect(Math.abs(channel - PHOTO_RGB[index])).toBeLessThanOrEqual(2)
    })
  })
})
