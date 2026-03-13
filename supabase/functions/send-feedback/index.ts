import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { name, email, subject, message } = body as {
    name: string;
    email: string;
    subject: string;
    message: string;
  };

  if (!name || !email || !subject || !message) {
    return jsonResponse({ error: "All fields are required: name, email, subject, message" }, 400);
  }

  if (typeof name !== "string" || typeof email !== "string" || typeof subject !== "string" || typeof message !== "string") {
    return jsonResponse({ error: "All fields must be strings" }, 400);
  }

  if (!isValidEmail(email)) {
    return jsonResponse({ error: "Invalid email format" }, 400);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const feedbackTo = Deno.env.get("FEEDBACK_TO");

  if (!resendApiKey || !feedbackTo) {
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">New Feedback from ConfDB Board</h2>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
    <tr>
      <td style="padding: 8px 12px; font-weight: 600; color: #374151; width: 80px; vertical-align: top;">Name</td>
      <td style="padding: 8px 12px; color: #1f2937;">${safeName}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Email</td>
      <td style="padding: 8px 12px; color: #1f2937;">${safeEmail}</td>
    </tr>
    <tr>
      <td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Subject</td>
      <td style="padding: 8px 12px; color: #1f2937;">${safeSubject}</td>
    </tr>
  </table>
  <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px;">
    <p style="margin: 0 0 8px; font-weight: 600; color: #374151;">Message</p>
    <p style="margin: 0; color: #1f2937; line-height: 1.6;">${safeMessage}</p>
  </div>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "ConfDB Feedback <onboarding@resend.dev>",
        to: [feedbackTo],
        reply_to: email,
        subject: `[ConfDB Feedback] ${subject}`,
        html,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Resend API error:", res.status, errBody);
      let detail = "Failed to send email";
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.message) detail = parsed.message;
      } catch {
        // not JSON
      }
      return jsonResponse({ error: detail }, 502);
    }

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    console.error("Resend request failed:", err);
    return jsonResponse({ error: "Failed to send email" }, 502);
  }
});
