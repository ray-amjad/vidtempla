import { sendEmail } from "../utils/sendEmail";
import { BRAND_COLOR, CARD_STYLE, MUTED_TEXT_STYLE, renderEmail } from "../templates/layout";

// Operator alert inbox. Override with ALERT_EMAIL; falls back to the support
// address used on the Google API audit form.
const ALERT_TO = process.env.ALERT_EMAIL || "support@vidtempla.com";

interface SendQuotaExhaustedEmailParams {
  resetsAt: Date;
}

export async function sendQuotaExhaustedEmail({
  resetsAt,
}: SendQuotaExhaustedEmailParams): Promise<void> {
  const subject = "⚠ VidTempla: YouTube API daily quota exhausted";
  // Explicit field options, not dateStyle/timeStyle: the latter throw
  // "TypeError: Invalid option" when combined with timeZoneName in Node.
  const formatIn = (timeZone: string) =>
    resetsAt.toLocaleString("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  const resetPacific = formatIn("America/Los_Angeles");
  const resetTokyo = formatIn("Asia/Tokyo");
  const resetGmt = formatIn("UTC");

  const bodyHtml = `
    <h1 style="color:${BRAND_COLOR};margin-top:0;margin-bottom:16px;font-size:24px;">YouTube quota exhausted</h1>
    <p style="margin-bottom:16px;color:#4b5563;font-size:16px;">
      The YouTube Data API daily quota has been used up. Channel syncs and
      description pushes will fail with a 403 until the quota resets.
    </p>
    <div style="${CARD_STYLE}">
      <p style="margin:0;color:#4b5563;font-size:15px;">
        <strong>Quota resets (approx):</strong><br/>
        ${resetPacific}<br/>
        ${resetTokyo}<br/>
        ${resetGmt}
      </p>
    </div>
    <p style="margin:16px 0;color:#4b5563;font-size:15px;">
      Background syncs are paused until then to preserve any remaining quota for
      user-initiated writes. If this keeps happening, request a quota increase
      via the YouTube Data API audit form.
    </p>
    <p style="${MUTED_TEXT_STYLE}margin-bottom:0;">
      You'll only get one of these per reset cycle.
    </p>
  `;

  await sendEmail({
    to: ALERT_TO,
    subject,
    html: renderEmail({ title: subject, bodyHtml }),
    emailType: "workflow_failure",
  });
}
