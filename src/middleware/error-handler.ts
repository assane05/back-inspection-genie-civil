import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/api-error";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "not_found" });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) return;
  if (err instanceof ApiError) {
    return res
      .status(err.status)
      .json({ error: err.code, message: err.message, details: err.details });
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
}
