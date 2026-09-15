import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
async function sha256Hex(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const username = Deno.env.get("PHONEPE_WEBHOOK_USERNAME") || Deno.env.get("PHONEPE_CALLBACK_USERNAME");
    const password = Deno.env.get("PHONEPE_WEBHOOK_PASSWORD") || Deno.env.get("PHONEPE_CALLBACK_PASSWORD");
    if (!username || !password) return new Response("Webhook credentials are not configured", { status: 500 });
    const authorization = req.headers.get("authorization") || "";
    const expected = await sha256Hex(`${username}:${password}`);
    if (!safeEqual(authorization, expected)) return new Response("Unauthorized", { status: 401 });
    const event = JSON.parse(await req.text());
    const eventType = String(event.event || event.type || "unknown");
    const payload = event.payload || {};
    const providerOrderId = String(payload.merchantOrderId || payload.orderId || "");
    let registrationId: string | null = null;
    if (providerOrderId) {
      const { data: payment } = await db.from("hpc_payments").select("registration_id").eq("provider_order_id", providerOrderId).maybeSingle();
      registrationId = payment?.registration_id || null;
    }
    await db.from("hpc_payment_events").insert({ registration_id: registrationId, provider: "phonepe", event_type: eventType, payload: event });
    if (!registrationId || !providerOrderId) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const completed = eventType === "checkout.order.completed" || eventType === "PG_ORDER_COMPLETED" || payload.state === "COMPLETED";
    const failed = eventType === "checkout.order.failed" || eventType === "PG_ORDER_FAILED" || payload.state === "FAILED";
    if (completed) {
      const transactionId = payload.paymentDetails?.[0]?.transactionId || payload.transactionId || null;
      await db.from("hpc_payments").update({ status: "SUCCESS", provider_transaction_id: transactionId, payment_method: payload.paymentDetails?.[0]?.paymentMode || "PHONEPE_CHECKOUT" }).eq("provider_order_id", providerOrderId);
      await db.from("hpc_registrations").update({ registration_status: "CONFIRMED", payment_status: "SUCCESS" }).eq("id", registrationId);
    } else if (failed) {
      await db.from("hpc_payments").update({ status: "FAILED" }).eq("provider_order_id", providerOrderId);
      await db.from("hpc_registrations").update({ registration_status: "PAYMENT_FAILED", payment_status: "FAILED" }).eq("id", registrationId);
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) { console.error(error); return new Response("Webhook processing failed", { status: 500 }); }
});
