import { db } from "../db/knex";
import { HttpError } from "../utils/http";

export const MAX_COMMENTS_PER_SESSION = 3;

export type CommentRow = {
  id: string;
  agency_id: string;
  product_id: string;
  parent_id: string | null;
  session_id: string;
  invoice_number: string;
  author_name: string;
  body: string;
  created_at: string | Date;
  updated_at: string | Date;
  product_name?: string;
  agency_name?: string;
  agency_slug?: string;
};

export type PublicComment = {
  id: string;
  parent_id: string | null;
  author_name: string;
  body: string;
  created_at: string | Date;
  replies: PublicComment[];
};

export type AdminComment = Omit<PublicComment, "replies"> & {
  invoice_number: string;
  session_id: string;
  product_id: string;
  product_name?: string;
  agency_id?: string;
  agency_name?: string;
  agency_slug?: string;
  replies: AdminComment[];
};

export function engagementCountSelects() {
  return [
    db.raw(
      "(select count(*)::int from product_likes where product_likes.product_id = products.id) as like_count"
    ),
    db.raw(
      "(select count(*)::int from product_comments where product_comments.product_id = products.id) as comment_count"
    ),
  ];
}

export function toPublicComment(comment: CommentRow): PublicComment {
  return {
    id: comment.id,
    parent_id: comment.parent_id,
    author_name: comment.author_name,
    body: comment.body,
    created_at: comment.created_at,
    replies: [],
  };
}

export function toAdminComment(comment: CommentRow): AdminComment {
  return {
    ...toPublicComment(comment),
    invoice_number: comment.invoice_number,
    session_id: comment.session_id,
    product_id: comment.product_id,
    product_name: comment.product_name,
    agency_id: comment.agency_id,
    agency_name: comment.agency_name,
    agency_slug: comment.agency_slug,
    replies: [],
  };
}

export function nestComments<T extends { id: string; parent_id: string | null; replies: T[] }>(
  comments: T[]
): T[] {
  const byId = new Map(comments.map((comment) => [comment.id, { ...comment, replies: [] as T[] }]));
  const roots: T[] = [];

  for (const comment of byId.values()) {
    if (comment.parent_id && byId.has(comment.parent_id)) {
      byId.get(comment.parent_id)!.replies.push(comment);
    } else {
      roots.push(comment);
    }
  }

  return roots;
}

export async function getPublishedProduct(agencyId: string, productId: string) {
  const product = await db("products")
    .where({ id: productId, agency_id: agencyId, status: "published" })
    .first();
  if (!product) throw new HttpError(404, "Product not found");
  return product;
}

export async function getProductInScope(productId: string, agencyId?: string) {
  const query = db("products").where({ id: productId });
  if (agencyId) query.andWhere({ agency_id: agencyId });
  const product = await query.first();
  if (!product) throw new HttpError(404, "Product not found");
  return product;
}

export async function sessionCommentCount(productId: string, sessionId: string) {
  const [{ count }] = await db("product_comments")
    .where({ product_id: productId, session_id: sessionId })
    .count("id as count");
  return Number(count);
}

export async function likeCount(productId: string) {
  const [{ count }] = await db("product_likes").where({ product_id: productId }).count("id as count");
  return Number(count);
}

export async function commentCount(productId: string) {
  const [{ count }] = await db("product_comments").where({ product_id: productId }).count("id as count");
  return Number(count);
}

export async function hasSessionLiked(productId: string, sessionId: string) {
  const like = await db("product_likes").where({ product_id: productId, session_id: sessionId }).first();
  return Boolean(like);
}

export async function listProductComments(productId: string) {
  return db("product_comments").where({ product_id: productId }).orderBy("created_at", "asc");
}

export async function getPublicEngagement(productId: string, agencyId: string, sessionId?: string) {
  await getPublishedProduct(agencyId, productId);
  const comments = await listProductComments(productId);
  const remaining =
    sessionId != null
      ? Math.max(0, MAX_COMMENTS_PER_SESSION - (await sessionCommentCount(productId, sessionId)))
      : MAX_COMMENTS_PER_SESSION;

  return {
    likeCount: await likeCount(productId),
    commentCount: comments.length,
    liked: sessionId ? await hasSessionLiked(productId, sessionId) : false,
    remainingComments: remaining,
    comments: nestComments(comments.map(toPublicComment)),
  };
}

export async function toggleLike(productId: string, agencyId: string, sessionId: string) {
  const product = await getPublishedProduct(agencyId, productId);
  const existing = await db("product_likes")
    .where({ product_id: productId, session_id: sessionId })
    .first();

  let liked = false;
  if (existing) {
    await db("product_likes").where({ id: existing.id }).delete();
  } else {
    await db("product_likes").insert({
      id: crypto.randomUUID(),
      agency_id: product.agency_id,
      product_id: productId,
      session_id: sessionId,
    });
    liked = true;
  }

  return {
    liked,
    likeCount: await likeCount(productId),
  };
}

async function findValidOrder(agencyId: string, invoiceNumber: string) {
  const order = await db("orders")
    .where({ agency_id: agencyId })
    .whereRaw("upper(invoice_number) = ?", [invoiceNumber.trim().toUpperCase()])
    .first();

  if (!order) {
    throw new HttpError(400, "Enter a valid invoice number from this store to comment");
  }
  if (order.status === "cancelled") {
    throw new HttpError(400, "This invoice cannot be used to comment");
  }
  if (order.status === "lead") {
    throw new HttpError(400, "Complete your purchase before commenting");
  }
  return order;
}

export async function createComment(input: {
  productId: string;
  agencyId: string;
  sessionId: string;
  invoiceNumber: string;
  authorName?: string;
  body: string;
  parentId?: string;
}) {
  const product = await getPublishedProduct(input.agencyId, input.productId);
  const used = await sessionCommentCount(input.productId, input.sessionId);
  if (used >= MAX_COMMENTS_PER_SESSION) {
    throw new HttpError(429, "This session can post at most 3 comments on this product");
  }

  const order = await findValidOrder(input.agencyId, input.invoiceNumber);

  if (input.parentId) {
    const parent = await db("product_comments")
      .where({ id: input.parentId, product_id: input.productId })
      .first();
    if (!parent) throw new HttpError(400, "Parent comment not found");
  }

  const [comment] = await db("product_comments")
    .insert({
      id: crypto.randomUUID(),
      agency_id: product.agency_id,
      product_id: input.productId,
      parent_id: input.parentId || null,
      session_id: input.sessionId,
      invoice_number: String(order.invoice_number).toUpperCase(),
      author_name: (input.authorName || order.customer_name || "Customer").trim() || "Customer",
      body: input.body.trim(),
    })
    .returning("*");

  return {
    comment: toPublicComment(comment),
    remainingComments: Math.max(0, MAX_COMMENTS_PER_SESSION - used - 1),
  };
}

export async function listAdminComments(opts: { agencyId?: string; productId?: string; q?: string }) {
  const query = db("product_comments")
    .select(
      "product_comments.*",
      "products.name as product_name",
      "agencies.name as agency_name",
      "agencies.slug as agency_slug"
    )
    .leftJoin("products", "products.id", "product_comments.product_id")
    .leftJoin("agencies", "agencies.id", "product_comments.agency_id")
    .orderBy("product_comments.created_at", "desc");

  if (opts.agencyId) query.where("product_comments.agency_id", opts.agencyId);
  if (opts.productId) query.andWhere("product_comments.product_id", opts.productId);
  if (opts.q) {
    query.andWhere((builder) => {
      builder
        .whereILike("product_comments.body", `%${opts.q}%`)
        .orWhereILike("product_comments.author_name", `%${opts.q}%`)
        .orWhereILike("product_comments.invoice_number", `%${opts.q}%`)
        .orWhereILike("products.name", `%${opts.q}%`);
    });
  }

  const comments = (await query) as CommentRow[];
  return nestComments(comments.map(toAdminComment));
}

export async function getAdminProductEngagement(productId: string, agencyId?: string) {
  const product = await getProductInScope(productId, agencyId);
  const comments = await listAdminComments({ agencyId: product.agency_id, productId });
  return {
    productId: product.id,
    productName: product.name,
    likeCount: await likeCount(product.id),
    commentCount: await commentCount(product.id),
    comments,
  };
}

export async function deleteComment(commentId: string, agencyId?: string) {
  const query = db("product_comments").where({ id: commentId });
  if (agencyId) query.andWhere({ agency_id: agencyId });
  const deleted = await query.delete();
  if (!deleted) throw new HttpError(404, "Comment not found");
}

export async function engagementStats(agencyId?: string) {
  const likesQuery = db("product_likes");
  const commentsQuery = db("product_comments");
  if (agencyId) {
    likesQuery.where({ agency_id: agencyId });
    commentsQuery.where({ agency_id: agencyId });
  }
  const [{ count: likeTotal }] = await likesQuery.count("id as count");
  const [{ count: commentTotal }] = await commentsQuery.count("id as count");
  return {
    likeCount: Number(likeTotal),
    commentCount: Number(commentTotal),
  };
}
