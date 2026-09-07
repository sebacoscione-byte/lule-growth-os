import sharp from "sharp"

/** Convierte una imagen a JPEG para portadas de reels sin cargar los binarios de procesamiento de video. */
export async function convertImageToJpeg(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .rotate()
    .flatten({ background: "#FFFFFF" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer()
}
