import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://atityaram.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function calculateAmount(track: string, workshopOption: string | null) {
  if (track === "showcase" || track === "challenge") return 0;
  if (track !== "workshops") throw new Error("Invalid track");
  if (workshopOption === "gpu_cuda" || workshopOption === "genai_llm") return 300;
  if (workshopOption === "both") return 500;
  throw new Error("Select one or both workshops");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const mobile = String(body.mobile || "").replace(/\D/g, "");
    const institution = String(body.institution || "").trim();
    const city = String(body.city || "").trim();
    const participantType = String(body.participantType || "").trim();
    const track = String(body.track || "").trim();
    const workshopOption = body.workshopOption ? String(body.workshopOption).trim() : null;
    const challengeTeamName = body.challengeTeamName ? String(body.challengeTeamName).trim() : null;

    if (!fullName || !email || !mobile || !institution || !participantType || !track) return json({ error: "Required registration details are missing" }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Invalid email address" }, 400);
    if (!/^\d{10}$/.test(mobile)) return json({ error: "Invalid mobile number" }, 400);
    if (track === "challenge" && (!challengeTeamName || challengeTeamName.length < 2)) return json({ error: "Challenge team name is required" }, 400);

    const amount = calculateAmount(track, workshopOption);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.from("hpc_registrations").insert({
      full_name: fullName, email, mobile, institution, city, participant_type: participantType, track,
      workshop_option: track === "workshops" ? workshopOption : null,
      challenge_team_name: track === "challenge" ? challengeTeamName : null,
      amount,
      registration_status: amount === 0 ? "CONFIRMED" : "PENDING_PAYMENT",
      payment_status: amount === 0 ? "NOT_REQUIRED" : "PENDING",
    }).select("registration_id,amount,registration_status,payment_status").single();

    if (error) { console.error(error); return json({ error: "Unable to create registration" }, 500); }
    return json({ ok: true, registrationId: data.registration_id, amount: data.amount, registrationStatus: data.registration_status, paymentStatus: data.payment_status, paymentRequired: data.amount > 0 });
  } catch (error) {
    console.error(error);
    return json({ error: "Invalid registration request" }, 400);
  }
});
