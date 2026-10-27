import { z } from "zod";
import { normalizedPhoneDigits } from "@/lib/profile-phone";

export const profilePhoneSchema = z.string()
  .trim()
  .max(18)
  .refine(
    (value) => normalizedPhoneDigits(value).length === 10,
    "Enter a 10-digit phone number",
  );

export const nullableProfilePhoneSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  profilePhoneSchema.nullable().optional(),
);
