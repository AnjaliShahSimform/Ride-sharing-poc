export type DocumentMime = "image/jpeg" | "image/png" | "application/pdf";

// Decides the type from the file's own bytes. The client-supplied Content-Type
// and filename are never trusted: a renamed executable must not get through.
export function sniffDocumentType(buf: Buffer): DocumentMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}
