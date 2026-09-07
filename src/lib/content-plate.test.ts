import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"
import { composeContentPlate } from "@/lib/content-plate"

const PHOTO_RGB = [20, 100, 160] as const

function solidPhotoPpm(): Buffer {
  const pixels = Buffer.from(Array.from({ length: 4 }, () => [...PHOTO_RGB]).flat())
  return Buffer.concat([Buffer.from("P6\n2 2\n255\n"), pixels])
}

function sampleRgb(path: string, x: number, y: number): [number, number, number] {
  const pixel = execFileSync(ffmpegInstaller.path, [
    "-v", "error",
    "-i", path,
    "-vf", `format=rgb24,crop=1:1:${x}:${y}`,
    "-frames:v", "1",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "pipe:1",
  ])
  return [pixel[0], pixel[1], pixel[2]]
}

describe("composeContentPlate V2.1", () => {
  it("integra foto full-bleed con cobertura marfil gradual, sin un corte vertical", async () => {
    const output = await composeContentPlate({
      photoBuffer: solidPhotoPpm(),
      headline: "TU CONTROL CARDIOVASCULAR EN LANÚS",
      subtitle: "Atención médica personalizada y sin apuro",
      format: "post",
    })
    const workDir = mkdtempSync(join(tmpdir(), "content-plate-test-"))
    const outputPath = join(workDir, "plate.png")
    try {
      writeFileSync(outputPath, output)
      const paperZone = sampleRgb(outputPath, 40, 40)
      const transitionZone = sampleRgb(outputPath, 670, 40)
      const photoZone = sampleRgb(outputPath, 900, 40)

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
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})
