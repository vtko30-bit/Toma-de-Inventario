// Edge Function: envía el Excel del inventario cerrado a administradores (Resend).
// Secrets requeridos en Supabase:
//   RESEND_API_KEY
//   RESEND_FROM   (ej. "Inventario <onboarding@resend.dev>" o dominio verificado)

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

    const payload = await req.json();
    const to = Array.isArray(payload?.to)
      ? [...new Set(payload.to.map((e: string) => String(e || "").trim().toLowerCase()).filter(Boolean))]
      : [];
    const folio = String(payload?.folio || "inventario");
    const fileName = String(payload?.fileName || `${folio}.xlsx`);
    const fileBase64 = String(payload?.fileBase64 || "");
    const meta = payload?.meta || {};

    if (!to.length) return json(400, { error: "No hay destinatarios" });
    if (!fileBase64) return json(400, { error: "Falta el archivo Excel" });

    const lines = [
      `Se cerró el inventario ${folio}.`,
      "",
      `Usuario: ${meta.usuario || "—"}`,
      `Fecha: ${meta.fecha || "—"} ${meta.hora || ""}`.trim(),
      `Sucursal: ${meta.sucursal || "—"}`,
      `Bodega: ${meta.bodega || "—"}`,
      `Items: ${meta.items ?? "—"}`,
      meta.observacion ? `Observación: ${meta.observacion}` : "",
      "",
      "El detalle completo va adjunto en Excel."
    ].filter(Boolean);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Inventario cerrado ${folio}`,
        text: lines.join("\n"),
        attachments: [
          {
            filename: fileName,
            content: fileBase64
          }
        ]
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
