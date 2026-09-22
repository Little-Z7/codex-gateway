import { createError } from "h3";
import { z } from "zod";

export const optionalPositiveInt = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const GENERIC_NOT_FOUND = /not found|not configured/i;

export function requireRecord<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    // `data.code` lets clients localize; the resource label stays in `statusMessage` for logs.
    throw createError({
      statusCode: 404,
      statusMessage: message,
      data: { code: GENERIC_NOT_FOUND.test(message) ? "common.notFound" : "common.missing" },
    });
  }
  return value;
}
