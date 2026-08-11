/**
 * Shared validation for video variable updates.
 *
 * Every entry point that reaches `updateVideoVariables()` uses this schema, so
 * the REST, MCP and tRPC paths cannot drift apart on what they accept.
 */

import { z } from "zod";

/** A template rarely has more than a handful of variables; this is a sanity bound. */
export const MAX_VARIABLES_PER_REQUEST = 500;

/** Names come from `{{...}}` placeholders in template content. */
export const MAX_VARIABLE_NAME_LENGTH = 200;

/** A value is substituted into a YouTube description, which caps at 5000 characters. */
export const MAX_VARIABLE_VALUE_LENGTH = 5000;

export const videoVariableUpdateSchema = z.object({
  templateId: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(MAX_VARIABLE_NAME_LENGTH)
    // A name containing braces could never match a parsed `{{name}}` placeholder.
    .refine((name) => !/[{}]/.test(name), {
      message: "Variable names cannot contain { or }",
    })
    .refine((name) => name.trim().length > 0, {
      message: "Variable names cannot be blank",
    }),
  value: z.string().max(MAX_VARIABLE_VALUE_LENGTH),
});

export const videoVariableUpdatesSchema = z
  .array(videoVariableUpdateSchema)
  .max(MAX_VARIABLES_PER_REQUEST);

/**
 * Flattens a Zod error into one line an API caller can act on, e.g.
 * `variables.0.templateId: Invalid uuid`.
 */
export function formatVariableIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = ["variables", ...issue.path].join(".");
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
