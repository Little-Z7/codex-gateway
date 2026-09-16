import { createError, readValidatedBody } from "h3";
import { z } from "zod";
import { requireAdmin } from "../../utils/gateway/auth/context";
import { userStore } from "../../utils/gateway/auth/users";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";

const createUserSchema = z
  .object({
    username: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/)),
    password: z.string().min(8),
    role: z.enum(["admin", "user"]).default("user"),
  })
  .strict();

export default defineGatewayEventHandler(async (event) => {
  requireAdmin(event);
  const input = await readValidatedBody(event, (body) => createUserSchema.parse(body));
  if (userStore.findByUsername(input.username)) {
    throw createError({
      statusCode: 409,
      statusMessage: "Conflict",
      message: "Username already exists",
    });
  }
  const user = userStore.createUser(input.username, input.password, input.role);
  return { user: { id: user!.id, username: user!.username, role: user!.role } };
});
