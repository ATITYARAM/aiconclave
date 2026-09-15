import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "https://atityaram.github.io", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
async function getToken() {
  const form = new URLSearchParams({ client_id: Deno.env.get("PHONEPE_CLIENT_ID")!, client_version: Deno.env.get("PHONEPE_CLIENT_VERSION")!, client_secret: Deno.env.get("PHONEPE_CLIENT_SECRET")!, grant_type: "client_credentials" });
  const production = (Deno.env.get("PHONEPE_ENV") || "SANDBOX").toUpperCase() === "PRODUCTION";
  const url = production ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token" : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }); const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error("PhonePe authorization failed"); return d.access_token as string;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { registrationId } = await req.json(); if (!registrationId) return json({ error: "registrationId is required" }, 400);
    const { data: registration } = await db.from("hpc_registrations").select("id,registration_id,full_name,email,track,amount,registration_status,payment_status").eq("registration_id", String(registrationId)).single();
    if (!registration) return json({ error: "Registration not found" }, 404);
    const { data: payment } = await db.from("hpc_payments").select("provider_order_id,provider_transaction_id,amount,status,payment_method").eq("registration_id", registration.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (payment?.provider_order_id && ["PENDING", "PROCESSING"].includes(payment.status)) {
      try {
        const token = await getToken(); const production = (Deno.env.get("PHONEPE_ENV") || "SANDBOX").toUpperCase() === "PRODUCTION";
        const base = production ? "https://api.phonepe.com/apis/pg/checkout/v2/order" : "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order";
        const r = await fetch(`${base}/${encodeURIComponent(payment.provider_order_id)}/status?details=false`, { headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}` } }); const p = await r.json();
        if (r.ok && p.state === "COMPLETED") { await db.from("hpc_payments").update({ status: "SUCCESS", provider_transaction_id: p.paymentDetails?.[0]?.transactionId || null }).eq("provider_order_id", payment.provider_order_id); await db.from("hpc_registrations").update({ registration_status: "CONFIRMED", payment_status: "SUCCESS" }).eq("id", registration.id); return json({ ok: true, registrationId: registration.registration_id, status: "CONFIRMED", paymentStatus: "SUCCESS", amount: registration.amount }); }
        if (r.ok && p.state === "FAILED") { await db.from("hpc_payments").update({ status: "FAILED" }).eq("provider_order_id", payment.provider_order_id); await db.from("hpc_registrations").update({ registration_status: "PAYMENT_FAILED", payment_status: "FAILED" }).eq("id", registration.id); }
      } catch (error) { console.error("PhonePe status refresh failed", error); }
    }
    return json({ ok: true, registrationId: registration.registration_id, status: registration.registration_status, paymentStatus: registration.payment_status, amount: registration.amount, paymentMethod: payment?.payment_method || null });
  } catch (error) { console.error(error); return json({ error: "Unable to fetch payment status" }, 500); }
});
