// Edge Function: envía invitación por correo (Resend).
// Reutiliza los mismos secrets que enviar-inventario-excel:
//   RESEND_API_KEY
//   RESEND_FROM

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("RESEND_FROM") || "Inventario <onboarding@resend.dev>";
    if (!resendKey) {
      return json(500, { error: "Falta RESEND_API_KEY en los secrets de la función" });
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "No autorizado" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return json(401, { error: "Sesión inválida" });
    }

    const { data: profile, error: profileError } = await supabase
      .from("usuarios")
      .select("role,tenant_id,nombre,email")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return json(403, { error: "No se encontró tu perfil" });
    }
    if (String(profile.role || "").toLowerCase() !== "admin") {
      return json(403, { error: "Solo un administrador puede enviar invitaciones" });
    }

    const payload = await req.json();
    const to = String(payload?.to || "").trim().toLowerCase();
    const appUrl = String(payload?.appUrl || "").trim();
    const tenantId = String(payload?.tenantId || profile.tenant_id || "").trim();
    const invitador = String(payload?.invitador || profile.nombre || profile.email || "").trim();

    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json(400, { error: "Correo destino inválido" });
    }
    if (!appUrl || !tenantId) {
      return json(400, { error: "Faltan datos de la invitación" });
    }

    const text = [
      "Te invitaron a Control de Inventario.",
      "",
      invitador ? `Quién invita: ${invitador}` : "",
      `Enlace: ${appUrl}`,
      `Nombre de empresa (escríbelo exactamente al crear la cuenta): ${tenantId}`,
      "",
      "Pasos:",
      "1. Abre el enlace",
      "2. Pulsa Crear cuenta",
      "3. Usa tu correo y ese mismo nombre de empresa",
      "4. Un admin te asignará el rol después"
    ].filter(Boolean).join("\n");

    const html = `
      <p>Te invitaron a <strong>Control de Inventario</strong>.</p>
      ${invitador ? `<p>Quién invita: ${invitador}</p>` : ""}
      <p><a href="${appUrl}">${appUrl}</a></p>
      <p>Nombre de empresa (escríbelo exactamente al crear la cuenta):<br><strong>${tenantId}</strong></p>
      <ol>
        <li>Abre el enlace</li>
        <li>Pulsa <em>Crear cuenta</em></li>
        <li>Usa tu correo y ese mismo nombre de empresa</li>
        <li>Un admin te asignará el rol después</li>
      </ol>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Invitación a Control de Inventario",
        text,
        html
      })
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(502, {
        error: result?.message || result?.error || `Resend respondió ${res.status}`
      });
    }

    return json(200, { ok: true, sentTo: to, id: result?.id || null });
  } catch (e) {
    return json(500, { error: e?.message || "Error interno" });
  }
});
