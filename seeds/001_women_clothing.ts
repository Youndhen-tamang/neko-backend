import type { Knex } from "knex";
import bcrypt from "bcryptjs";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_EMAIL = "iva@lumina.test";
const ADMIN_PASSWORD = "password123";

function photo(id: string) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;
}

type SeedProduct = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  images: string[];
  price_cents: number;
  stock: number;
  low_stock_threshold?: number;
  status?: "draft" | "published";
};

const products: SeedProduct[] = [
  {
    id: "33333333-3333-4333-8333-333333333001",
    name: "Silk Slip Dress",
    description:
      "Bias-cut silk slip with a cowl neckline and adjustable straps. Drapes close to the body and works from dinner to a summer wedding.",
    category: "Dresses",
    tags: ["silk", "evening", "minimal"],
    images: [photo("photo-1515372039744-b8f02a3ae446"), photo("photo-1490481651871-ab68de25d43d")],
    price_cents: 14800,
    stock: 18,
  },
  {
    id: "33333333-3333-4333-8333-333333333002",
    name: "Floral Midi Dress",
    description:
      "Soft viscose midi with a defined waist, puff sleeves, and a hidden side zip. The print is exclusive to Lumina this season.",
    category: "Dresses",
    tags: ["floral", "midi", "daywear"],
    images: [photo("photo-1572804013309-59a88b7e92f1")],
    price_cents: 16800,
    stock: 14,
  },
  {
    id: "33333333-3333-4333-8333-333333333003",
    name: "Little Black Dress",
    description:
      "Tailored crepe sheath with a square neck and back vent. Fully lined, with a discreet center-back zip.",
    category: "Dresses",
    tags: ["classic", "evening", "crepe"],
    images: [photo("photo-1595777457583-95e059d581b8")],
    price_cents: 18800,
    stock: 11,
  },
  {
    id: "33333333-3333-4333-8333-333333333004",
    name: "Linen Wrap Blouse",
    description:
      "Lightweight European linen wrap with a self-tie waist and three-quarter sleeves. Breathable enough for warm afternoons.",
    category: "Tops",
    tags: ["linen", "wrap", "summer"],
    images: [photo("photo-1485968579580-b6d095142e6e")],
    price_cents: 7800,
    stock: 22,
  },
  {
    id: "33333333-3333-4333-8333-333333333005",
    name: "Cotton Poplin Shirt",
    description:
      "Crisp poplin shirt with mother-of-pearl buttons, a slightly oversized fit, and extra-long cuffs meant to be rolled.",
    category: "Tops",
    tags: ["shirt", "cotton", "workwear"],
    images: [photo("photo-1564257631407-4deb1f99d3a5")],
    price_cents: 6800,
    stock: 26,
  },
  {
    id: "33333333-3333-4333-8333-333333333006",
    name: "High-Rise Wide-Leg Trousers",
    description:
      "Pressed wide-leg trousers in a fluid viscose blend. High rise, side pockets, and a hook-and-bar close.",
    category: "Bottoms",
    tags: ["trousers", "wide-leg", "tailoring"],
    images: [photo("photo-1594633312681-425c7b97ccd1")],
    price_cents: 12800,
    stock: 16,
  },
  {
    id: "33333333-3333-4333-8333-333333333007",
    name: "Tailored Wool Trousers",
    description:
      "Italian wool trousers with a slim, straight leg and crease that holds through the day. Unfinished hem for a proper tailor.",
    category: "Bottoms",
    tags: ["wool", "tailoring", "workwear"],
    images: [photo("photo-1509631179647-0177331693ae")],
    price_cents: 15800,
    stock: 9,
  },
  {
    id: "33333333-3333-4333-8333-333333333008",
    name: "Pleated Midi Skirt",
    description:
      "Sunburst-pleated midi that moves without clinging. Elastic back waist and a smooth front panel.",
    category: "Bottoms",
    tags: ["skirt", "pleated", "midi"],
    images: [photo("photo-1583496661160-fb5886a0aaaa")],
    price_cents: 9800,
    stock: 19,
  },
  {
    id: "33333333-3333-4333-8333-333333333009",
    name: "Oversized Wool Coat",
    description:
      "Double-faced wool coat with dropped shoulders, notch lapels, and a concealed button placket. Cut to layer over tailoring.",
    category: "Outerwear",
    tags: ["coat", "wool", "winter"],
    images: [photo("photo-1539533018447-63fcce2678e3")],
    price_cents: 24800,
    stock: 7,
  },
  {
    id: "33333333-3333-4333-8333-333333333010",
    name: "Cropped Tweed Blazer",
    description:
      "Cropped bouclé blazer with structured shoulders, flap pockets, and gold-tone buttons. Hits at the high hip.",
    category: "Outerwear",
    tags: ["blazer", "tweed", "tailoring"],
    images: [photo("photo-1591369822096-ffd140ec948f")],
    price_cents: 19800,
    stock: 10,
  },
  {
    id: "33333333-3333-4333-8333-333333333011",
    name: "Cashmere Crew Sweater",
    description:
      "Grade-A cashmere crew with a relaxed body and ribbed cuffs. Knit in a mid-weight that stands on its own.",
    category: "Knitwear",
    tags: ["cashmere", "crew", "layering"],
    images: [photo("photo-1434389677669-e08b4cac3105")],
    price_cents: 13800,
    stock: 4,
    low_stock_threshold: 5,
  },
  {
    id: "33333333-3333-4333-8333-333333333012",
    name: "Merino Cardigan",
    description:
      "Fine merino cardigan with a deep V, patch pockets, and horn buttons. Light enough to wear indoors year-round.",
    category: "Knitwear",
    tags: ["merino", "cardigan", "layering"],
    images: [photo("photo-1576566588028-4147f3842f27")],
    price_cents: 11800,
    stock: 15,
  },
  {
    id: "33333333-3333-4333-8333-333333333013",
    name: "Leather Shoulder Bag",
    description:
      "Compact Italian leather shoulder bag with a magnetic flap, interior slip pocket, and an adjustable strap.",
    category: "Accessories",
    tags: ["bag", "leather", "everyday"],
    images: [photo("photo-1584917865442-de89df76afd3")],
    price_cents: 22000,
    stock: 12,
  },
  {
    id: "33333333-3333-4333-8333-333333333014",
    name: "Sculptural Heels",
    description:
      "Nappa leather heels with a squared toe and 70mm sculpted heel. Cushioned insole and a leather sole.",
    category: "Accessories",
    tags: ["shoes", "heels", "evening"],
    images: [photo("photo-1543163521-1bf539c55dd2")],
    price_cents: 16800,
    stock: 3,
    low_stock_threshold: 5,
  },
  {
    id: "33333333-3333-4333-8333-333333333015",
    name: "Sequin Evening Gown",
    description:
      "Floor-length column gown in tonal sequins with a draped cowl back. Still in fittings — not yet on the floor.",
    category: "Dresses",
    tags: ["evening", "sequin", "gown"],
    images: [photo("photo-1566174053879-31528523f8ae")],
    price_cents: 42000,
    stock: 2,
    status: "draft",
  },
];

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function productById(id: string): SeedProduct {
  const product = products.find((item) => item.id === id);
  if (!product) throw new Error(`Unknown seed product ${id}`);
  return product;
}

export async function seed(knex: Knex): Promise<void> {
  await knex.raw("TRUNCATE TABLE agencies CASCADE");

  await knex("agencies").insert({
    id: AGENCY_ID,
    name: "Lumina Atelier",
    slug: "lumina",
    brand_name: "Lumina",
    primary_color: "#7a3e4a",
    email: "hello@lumina.test",
    phone: "+1 212 555 0148",
    address: "184 Mercer Street, New York, NY 10012",
    tagline: "Elevated essentials for modern women",
    landing_template: "atelier",
    status: "active",
  });

  await knex("users").insert({
    id: ADMIN_ID,
    agency_id: AGENCY_ID,
    email: ADMIN_EMAIL,
    password_hash: await bcrypt.hash(ADMIN_PASSWORD, 10),
    name: "Iva Chen",
    role: "agency_admin",
  });

  await knex("products").insert(
    products.map((product) => ({
      id: product.id,
      agency_id: AGENCY_ID,
      name: product.name,
      description: product.description,
      category: product.category,
      tags: JSON.stringify(product.tags),
      images: JSON.stringify(product.images),
      price_cents: product.price_cents,
      currency: "usd",
      stock: product.stock,
      low_stock_threshold: product.low_stock_threshold ?? 5,
      status: product.status ?? "published",
    }))
  );

  const orders = [
    {
      id: "44444444-4444-4444-8444-444444444001",
      invoice_number: "INV-LUMINA-1001",
      status: "ordered",
      customer_name: "Amelia Brooks",
      customer_email: "amelia.brooks@example.com",
      customer_phone: "+1 917 555 0192",
      shipping_address: "88 Jane Street, Apt 4B, New York, NY 10014",
      email_sent: true,
      created_at: daysAgo(1),
      items: [
        { productId: "33333333-3333-4333-8333-333333333001", quantity: 1 },
        { productId: "33333333-3333-4333-8333-333333333014", quantity: 1 },
      ],
    },
    {
      id: "44444444-4444-4444-8444-444444444002",
      invoice_number: "INV-LUMINA-1002",
      status: "dispatched",
      customer_name: "Priya Raman",
      customer_email: "priya.raman@example.com",
      customer_phone: "+1 646 555 0174",
      shipping_address: "210 Lafayette Street, New York, NY 10012",
      email_sent: true,
      created_at: daysAgo(3),
      items: [{ productId: "33333333-3333-4333-8333-333333333010", quantity: 1 }],
    },
    {
      id: "44444444-4444-4444-8444-444444444003",
      invoice_number: "INV-LUMINA-1003",
      status: "delivered",
      customer_name: "Sofia Alvarez",
      customer_email: "sofia.alvarez@example.com",
      customer_phone: "+1 347 555 0118",
      shipping_address: "41 Walker Street, New York, NY 10013",
      email_sent: true,
      created_at: daysAgo(9),
      items: [
        { productId: "33333333-3333-4333-8333-333333333006", quantity: 1 },
        { productId: "33333333-3333-4333-8333-333333333004", quantity: 2 },
      ],
    },
    {
      id: "44444444-4444-4444-8444-444444444004",
      invoice_number: "INV-LUMINA-1004",
      status: "lead",
      customer_name: "Hannah Cole",
      customer_email: "hannah.cole@example.com",
      customer_phone: "+1 929 555 0160",
      shipping_address: "15 Bond Street, New York, NY 10012",
      email_sent: false,
      created_at: daysAgo(0),
      items: [{ productId: "33333333-3333-4333-8333-333333333009", quantity: 1 }],
    },
    {
      id: "44444444-4444-4444-8444-444444444005",
      invoice_number: "INV-LUMINA-1005",
      status: "cancelled",
      customer_name: "Maya Patel",
      customer_email: "maya.patel@example.com",
      customer_phone: "+1 212 555 0133",
      shipping_address: "90 Prince Street, New York, NY 10012",
      email_sent: false,
      created_at: daysAgo(5),
      items: [{ productId: "33333333-3333-4333-8333-333333333013", quantity: 1 }],
    },
  ];

  for (const order of orders) {
    const lineItems = order.items.map((item) => {
      const product = productById(item.productId);
      return {
        product,
        quantity: item.quantity,
        unitPriceCents: product.price_cents,
      };
    });
    const totalCents = lineItems.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0
    );

    await knex("orders").insert({
      id: order.id,
      agency_id: AGENCY_ID,
      invoice_number: order.invoice_number,
      status: order.status,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      shipping_address: order.shipping_address,
      subtotal_cents: totalCents,
      total_cents: totalCents,
      currency: "usd",
      email_sent: order.email_sent,
      created_at: order.created_at,
      updated_at: order.created_at,
    });

    await knex("order_items").insert(
      lineItems.map((item) => ({
        id: crypto.randomUUID(),
        order_id: order.id,
        product_id: item.product.id,
        name: item.product.name,
        quantity: item.quantity,
        unit_price_cents: item.unitPriceCents,
        image_url: item.product.images[0],
      }))
    );
  }

  await knex("notifications").insert([
    {
      id: crypto.randomUUID(),
      agency_id: AGENCY_ID,
      type: "order",
      title: "New order INV-LUMINA-1001",
      body: "Amelia Brooks placed an order for $316.00.",
      read: false,
      meta: JSON.stringify({ orderId: "44444444-4444-4444-8444-444444444001" }),
      created_at: daysAgo(1),
      updated_at: daysAgo(1),
    },
    {
      id: crypto.randomUUID(),
      agency_id: AGENCY_ID,
      type: "low_stock",
      title: "Sculptural Heels is low on stock",
      body: "Only 3 left in inventory.",
      read: false,
      meta: JSON.stringify({ productId: "33333333-3333-4333-8333-333333333014" }),
      created_at: daysAgo(2),
      updated_at: daysAgo(2),
    },
    {
      id: crypto.randomUUID(),
      agency_id: AGENCY_ID,
      type: "order_status",
      title: "Order INV-LUMINA-1002 marked dispatched",
      body: "Priya Raman's order is now dispatched.",
      read: true,
      meta: JSON.stringify({
        orderId: "44444444-4444-4444-8444-444444444002",
        status: "dispatched",
      }),
      created_at: daysAgo(2),
      updated_at: daysAgo(2),
    },
  ]);

  console.log("Seeded Lumina Atelier (women's clothing)");
  console.log(`  Store slug:  lumina`);
  console.log(`  Admin email: ${ADMIN_EMAIL}`);
  console.log(`  Admin pass:  ${ADMIN_PASSWORD}`);
}
