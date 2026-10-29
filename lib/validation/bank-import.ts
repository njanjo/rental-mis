import { z } from "zod";

import {
  BANK_DATE_FORMATS,
  BANK_IMPORT_MAX_BYTES,
} from "@/lib/bank-import";

const column = z.coerce
  .number()
  .int({ message: "Choose a column from the file." })
  .min(-1)
  .max(500);

/**
 * Column indices are optional; an omitted field is simply not used. The import
 * service merges this over the detected mapping, so a person only sends the
 * columns they corrected.
 */
export const bankColumnMappingSchema = z.object({
  date: column.optional(),
  reference: column.optional(),
  amount: column.optional(),
  credit: column.optional(),
  debit: column.optional(),
  phone: column.optional(),
  payerName: column.optional(),
  narration: column.optional(),
});

export const bankImportSchema = z.object({
  bankCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, {
      message: "Use a short bank code, e.g. EQ or KCB.",
    }),
  fileName: z
    .string()
    .trim()
    .max(200, { message: "Keep the file name under 200 characters." })
    .optional(),
  csv: z
    .string()
    .min(1, { message: "Choose a statement file." })
    .max(BANK_IMPORT_MAX_BYTES, {
      message: "Keep the file under 2 MB. Export a smaller date range.",
    }),
  dateFormat: z.enum(BANK_DATE_FORMATS).default("auto"),
  mapping: bankColumnMappingSchema.optional(),
});

export type BankImportInput = z.infer<typeof bankImportSchema>;
