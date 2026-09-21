export const BOOKING_EMAIL = "booking@warrenwilliam.de";

type Inquiry = {
  name: string;
  email: string;
  eventType: string;
  eventDate: string;
  cityVenue: string;
  message: string;
};

// The recipient is fixed server-side. Never send to an address from the request.
export async function notifyBooking(
  inquiry: Inquiry,
  config: { apiKey: string; from: string },
  interactionId: string,
  send: typeof fetch = fetch,
): Promise<{ status: "accepted" | "unavailable" | "failed"; reason?: string }> {
  if (!config.apiKey || !config.from) {
    return { status: "unavailable", reason: "email_not_configured" };
  }
  const text = [
    "New booking inquiry from warrenwill.net",
    "",
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    `Event type: ${inquiry.eventType || "Not specified"}`,
    `Preferred date(s): ${inquiry.eventDate || "Flexible"}`,
    `City / venue: ${inquiry.cityVenue || "Not specified"}`,
    "",
    "Event details:",
    inquiry.message || "No additional details.",
    "",
    "Reply to this email to contact the booker.",
  ].join("\n");
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Idempotency-Key": `booking-${interactionId}`,
      },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        from: config.from,
        to: [BOOKING_EMAIL],
        reply_to: inquiry.email,
        subject: `Booking inquiry — ${inquiry.eventType || "Event"} · ${inquiry.cityVenue || "Location TBC"}`.replace(/[\r\n]/g, " "),
        text,
      }),
    });
    const result = await response.json();
    if (!response.ok || typeof result.id !== "string" || !result.id) {
      console.error("Booking notification rejected", response.status);
      return { status: "failed", reason: "email_provider_rejected" };
    }
    // Accepted by the provider does not guarantee final inbox placement.
    return { status: "accepted" };
  } catch {
    console.error("Booking notification request failed");
    return { status: "failed", reason: "email_request_failed" };
  }
}
