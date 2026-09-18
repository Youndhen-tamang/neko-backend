export type Role = "super_admin" | "agency_admin";

export type OrderStatus =
  | "lead"
  | "ordered"
  | "dispatched"
  | "delivered"
  | "cancelled";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  agencyId?: string;
  name?: string;
};

export type Agency = {
  id: string;
  name: string;
  slug: string;
  brand_name: string;
  logo_url: string | null;
  primary_color: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tagline: string | null;
  status: string;
};

export const ORDER_STATUSES: OrderStatus[] = [
  "lead",
  "ordered",
  "dispatched",
  "delivered",
  "cancelled",
];
