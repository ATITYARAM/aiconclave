import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://atityaram.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getPhonePeToken() {
  const clientId = Deno.env.get("PHONEPE_CLIENT_ID");
  const clientSecret = Deno.env.get("PHONEPE_CLIENT_SECRET");
  const clientVersion = Deno.env.get("PHONEPE_CLIENT_VERSION");
  if (!clientId || !clientSecret || !clientVersion) throw new Error("PhonePe credentials are not configured");
  const production = (Deno.env.get("PHONEPE_ENV") || "SANDBOX").toUpperCase() === "PRODUCTION";
  const url = production ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token" : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";
  const form = new URLSearchParams({ client_id: clientId, client_version: clientVersion, client_secret: clientSecret, grant_type: "client_credentials" });
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(d.message || "PhonePe authorization failed");
  return d.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { registrationId } = await req.json();
    if (!registrationId) return json({ error: "registrationId is required" }, 400);
    const client = db();
    const { data: registration, error } = await client.from("hpc_registrations").select("id,registration_id,email,amount,registration_status").eq("registration_id", String(registrationId)).single();
    if (error || !registration) return json({ error: "Registration not found" }, 404);
    if (registration.amount < 100) return json({ error: "No PhonePe payment is required" }, 400);
    if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(registration.registration_status)) return json({ error: "Registration is not awaiting payment" }, 409);

    const { data: existing } = await client.from("hpc_payments").select("provider_order_id,checkout_url,status,amount").eq("registration_id", registration.id).eq("status", "PENDING").maybeSingle();
    if (existing?.checkout_url && existing.provider_order_id) return json({ ok: true, registrationId, merchantOrderId: existing.provider_order_id, checkoutUrl: existing.checkout_url, amount: existing.amount });

    const merchantOrderId = `HPC27-${registration.registration_id}-${crypto.randomUUID().slice(0, 8)}`;
    const redirectUrl = `https://atityaram.github.io/aiconclave/payment-status/?registration=${encodeURIComponent(registration.registration_id)}`;
    const production = (Deno.env.get("PHONEPE_ENV") || "SANDBOX").toUpperCase() === "PRODUCTION";
    const payUrl = production ? "https://api.phonepe.com/apis/pg/checkout/v2/pay" : "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay";
    const token = await getPhonePeToken();
    const payload = { merchantOrderId, amount: Number(registration.amount) * 100, expireAfter: 1800, paymentFlow: { type: "PG_CHECKOUT", merchantUrls: { redirectUrl } }, metaInfo: { udf1: registration.registration_id, udf2: registration.email } };
    const r = await fetch(payUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}` }, body: JSON.stringify(payload) });
    const phonepe = await r.json();
    if (!r.ok || !phonepe.redirectUrl) { console.error("PhonePe create payment failed", phonepe); return json({ error: "Unable to create PhonePe checkout order" }, 502); }

    const { error: paymentError } = await client.from("hpc_payments").insert({ registration_id: registration.id, provider: "phonepe", provider_order_id: merchantOrderId, amount: registration.amount, currency: "INR", status: "PENDING", payment_method: "PHONEPE_CHECKOUT", checkout_url: phonepe.redirectUrl });
    if (paymentError) { console.error(paymentError); return json({ error: "Payment order was created but could not be recorded" }, 500); }
    await client.from("hpc_registrations").update({ registration_status: "PAYMENT_PROCESSING", payment_status: "PROCESSING" }).eq("id", registration.id);
    return json({ ok: true, registrationId: registration.registration_id, merchantOrderId, checkoutUrl: phonepe.redirectUrl, amount: registration.amount });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Payment order creation failed" }, 500);
  }
});
