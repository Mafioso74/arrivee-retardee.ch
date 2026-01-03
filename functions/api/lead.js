export async function onRequestPost(context) {
  try {
    const req = context.request;
    const formData = await req.formData();

    // 1) Champs formulaire
    const email = (formData.get("email") || "").toString().trim();
    const flightNumber = (formData.get("flight_number") || "").toString().trim();
    const flightDate = (formData.get("flight_date") || "").toString().trim();
    const comment = (formData.get("comment") || "").toString().trim();

    // 2) Turnstile token (injecté automatiquement par le widget)
    const turnstileToken = (formData.get("cf-turnstile-response") || "").toString().trim();

    // Validation minimale
    if (!email || !flightNumber || !flightDate) {
      return new Response("Champs manquants", { status: 400 });
    }
    if (!turnstileToken) {
      return new Response("Turnstile manquant", { status: 400 });
    }

    const secret = context.env.TURNSTILE_SECRET;
    if (!secret) {
      return new Response("TURNSTILE_SECRET non défini", { status: 500 });
    }

    // IP du visiteur (utile pour la vérification)
    const ip =
      req.headers.get("CF-Connecting-IP") ||
      req.headers.get("X-Forwarded-For") ||
      "";

    // 3) Vérification Turnstile
    const verifyBody = new URLSearchParams();
    verifyBody.append("secret", secret);
    verifyBody.append("response", turnstileToken);
    if (ip) verifyBody.append("remoteip", ip);

    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: verifyBody.toString(),
    });

    const verifyJson = await verifyRes.json();
    if (!verifyJson.success) {
      return new Response("Échec Turnstile", { status: 403 });
    }

    // 4) Email (Phase 4.2.4) — via Resend
    const resendKey = context.env.RESEND_API_KEY;
    const resendFrom = context.env.RESEND_FROM; // ex: "Arrivée Retardée <no-reply@arrivee-retardee.ch>"
    const resendTo = context.env.RESEND_TO || "contact@arrivee-retardee.ch";

    if (!resendKey || !resendFrom) {
      // Pour éviter de “perdre” le lead en cas de config incomplète
      console.log("Lead reçu mais RESEND_* non configuré:", { email, flightNumber, flightDate, comment });
      return new Response(JSON.stringify({ ok: true, emailSent: false }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const subject = "[Arrivée Retardée] Nouvelle demande de vérification";

    const text =
`Nouvelle demande

Email: ${email}
Numéro de vol: ${flightNumber}
Date du vol: ${flightDate}
Commentaire: ${comment || "(vide)"}

— Arrivée Retardée`;

    const mailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [resendTo],
        subject,
        text,
      }),
    });

    if (!mailRes.ok) {
      const errText = await mailRes.text();
      console.log("Resend error:", errText);
      return new Response("Erreur envoi email", { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true, emailSent: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  } catch (err) {
    console.log("API lead error:", err);
    return new Response("Erreur serveur", { status: 500 });
  }
}
