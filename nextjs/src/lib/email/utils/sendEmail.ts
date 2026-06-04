import sgMail from "@sendgrid/mail";
import { logSendGridError } from "./logSendGridError";

export type EmailType = "magic_link" | "org_invite";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  emailType: EmailType;
  from?: string;
}

const DEFAULT_FROM = "VidTempla <noreply@vidtempla.com>";

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { to, subject, html, emailType, from } = options;

  try {
    await sgMail.send({
      from: from ?? DEFAULT_FROM,
      to,
      subject,
      html,
      // Disable SendGrid click/open tracking + the unsubscribe footer for
      // 1:1 transactional mail. ct.sendgrid.net link rewriting is a bulk-mail
      // classifier signal at Gmail/Outlook, and the visible/hover URL mismatch
      // reads as phishing — both hurt inbox placement for magic links + org
      // invites. Every caller of sendEmail today is transactional; if a bulk
      // path is added later, override via an explicit option.
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
        openTracking: { enable: false },
        subscriptionTracking: { enable: false },
      },
    });
  } catch (err) {
    logSendGridError(emailType, to, err);
    throw err;
  }
}
