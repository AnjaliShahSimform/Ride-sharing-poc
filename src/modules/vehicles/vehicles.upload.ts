import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ValidationError } from "../../lib/AppError";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

// Only the `type` text field and the one file are expected, so cap everything
// else: a driver can't make the server buffer many or large text fields.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 64 },
}).single("file");

// MulterError isn't an AppError, so without this a too-big file would be a 500.
// Non-limit failures (no boundary, truncated or aborted body) arrive as a plain
// Error, which would also be a 500, so they're mapped to 400 as well.
export function uploadSingleFile(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      next(
        new ValidationError(
          err.code === "LIMIT_FILE_SIZE" ? "File must be 5 MB or smaller" : "Upload one file in the 'file' field",
        ),
      );
      return;
    }
    next(new ValidationError("Malformed upload"));
  });
}
