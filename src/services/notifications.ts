import { db } from "../db/knex";

export async function createNotification(input: {
  agencyId: string;
  type: string;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
}) {
  const [notification] = await db("notifications")
    .insert({
      id: crypto.randomUUID(),
      agency_id: input.agencyId,
      type: input.type,
      title: input.title,
      body: input.body,
      meta: input.meta ?? null,
    })
    .returning("*");

  return notification;
}
