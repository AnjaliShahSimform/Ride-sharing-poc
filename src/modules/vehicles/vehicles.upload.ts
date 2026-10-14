import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ValidationError } from "../../lib/AppError";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
}).single("file");

// MulterError isn't an AppError, so without this a too-big file would be a 500.
export function uploadSingleFile(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(
        new ValidationError(
          err.code === "LIMIT_FILE_SIZE" ? "File must be 5 MB or smaller" : "Upload one file in the 'file' field",
        ),
      );
      return;
    }
    next(err);
  });
}
