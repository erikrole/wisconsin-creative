import { env } from "@/lib/env";

export const EMAIL_THEME = {
  /** Outer page behind the card. */
  page: "#F4F5F7",
  /** The card itself. */
  background: "#FFFFFF",
  border: "#E8E8EC",
  text: "#1C2024",
  body: "#3B3F45",
  muted: "#60646C",
  surface: "#FBFBFC",
  divider: "#EEEEF1",
  brand: "#A00000",
  brandSoft: "#F6E8E8",
  onBrand: "#FFFFFF",
  danger: "#B42318",
} as const;

const FONT_STACK = "Lato, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_LINK = "https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap";

export function escapeEmailHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type EmailFact = { label: string; value: string };

export type EmailContent = {
  /** Shown in the inbox list beside the subject. Keep under about 90 characters. */
  preheader?: string;
  /** Small caps line above the headline. */
  eyebrow?: string;
  /** Use the danger color for the eyebrow (overdue, damage). */
  urgent?: boolean;
  headline: string;
  /** Plain text paragraphs. Escaped here. */
  paragraphs: string[];
  /** A short numbered list under the paragraphs. */
  steps?: { heading: string; items: string[] };
  /** Label and value rows in a quiet card. */
  facts?: EmailFact[];
  action?: { label: string; url: string };
  /** Small grey line under the button. */
  note?: string;
  /** Small grey lines under the card. */
  footer?: string[];
  /** Adds a "Manage notifications" link to the footer. */
  manageNotifications?: boolean;
  /** Adds the raw action URL to the footer for clients that block buttons. */
  showFallbackLink?: boolean;
};

export type RenderedEmail = { html: string; text: string };

function paragraphHtml(text: string): string {
  return `<p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: ${EMAIL_THEME.body};">${escapeEmailHtml(text)}</p>`;
}

function stepsHtml(steps: NonNullable<EmailContent["steps"]>): string {
  const rows = steps.items
    .map(
      (item, index) => `
        <tr>
          <td width="24" valign="top" style="padding: 0 14px 14px 0;"><div style="width: 24px; height: 24px; line-height: 24px; border-radius: 12px; background-color: ${EMAIL_THEME.brandSoft}; color: ${EMAIL_THEME.brand}; font-size: 13px; font-weight: 900; text-align: center;">${index + 1}</div></td>
          <td valign="top" style="padding: 0 0 14px; font-size: 15px; line-height: 24px; color: ${EMAIL_THEME.text};">${escapeEmailHtml(item)}</td>
        </tr>`
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 20px; background-color: ${EMAIL_THEME.surface}; border: 1px solid ${EMAIL_THEME.divider}; border-radius: 12px;">
      <tr><td style="padding: 20px 22px 6px; font-size: 13px; font-weight: 700; color: ${EMAIL_THEME.muted};">${escapeEmailHtml(steps.heading)}</td></tr>
      <tr><td style="padding: 8px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
    </table>`;
}

function factsHtml(facts: EmailFact[]): string {
  const rows = facts
    .map((fact, index) => {
      const border = index === facts.length - 1 ? "" : `border-bottom: 1px solid ${EMAIL_THEME.divider};`;
      return `
        <tr>
          <td valign="top" style="padding: 14px 16px 14px 0; ${border} font-size: 14px; line-height: 20px; color: ${EMAIL_THEME.muted};">${escapeEmailHtml(fact.label)}</td>
          <td valign="top" align="right" style="padding: 14px 0; ${border} font-size: 15px; line-height: 20px; font-weight: 700; color: ${EMAIL_THEME.text}; text-align: right;">${escapeEmailHtml(fact.value)}</td>
        </tr>`;
    })
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 20px; background-color: ${EMAIL_THEME.surface}; border: 1px solid ${EMAIL_THEME.divider}; border-radius: 12px;">
      <tr><td style="padding: 0 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
    </table>`;
}

function buttonHtml(action: NonNullable<EmailContent["action"]>): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 4px;">
      <tr><td bgcolor="${EMAIL_THEME.brand}" style="background-color: ${EMAIL_THEME.brand}; border-radius: 10px;"><a href="${escapeEmailHtml(action.url)}" style="display: inline-block; padding: 14px 26px; font-family: ${FONT_STACK}; font-size: 16px; line-height: 20px; font-weight: 700; color: ${EMAIL_THEME.onBrand}; text-decoration: none; border-radius: 10px;">${escapeEmailHtml(action.label)}</a></td></tr>
    </table>`;
}

/**
 * One shared shell for every email the app sends: logo header, one headline,
 * one action, a quiet footer. Table layout with inline styles so it holds up in
 * Gmail and Outlook; Lato loads where the client allows web fonts and falls back
 * to the system sans elsewhere.
 */
export function renderEmail(content: EmailContent): RenderedEmail {
  const logoUrl = `${env.appUrl}/email/logo.png`;
  const settingsUrl = `${env.appUrl}/settings/notifications`;
  const eyebrowColor = content.urgent ? EMAIL_THEME.danger : EMAIL_THEME.muted;

  const footerLines: string[] = [...(content.footer ?? [])];
  const footerHtml: string[] = footerLines.map((line) => escapeEmailHtml(line));
  if (content.manageNotifications) {
    footerHtml.push(
      `<a href="${escapeEmailHtml(settingsUrl)}" style="color: ${EMAIL_THEME.brand};">Manage notifications</a>`
    );
  }
  if (content.showFallbackLink && content.action) {
    footerHtml.unshift(
      `Button not working? Paste this into your browser:<br><a href="${escapeEmailHtml(content.action.url)}" style="color: ${EMAIL_THEME.brand}; word-break: break-all;">${escapeEmailHtml(content.action.url)}</a>`
    );
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeEmailHtml(content.headline)}</title>
<link href="${FONT_LINK}" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background-color: ${EMAIL_THEME.page}; font-family: ${FONT_STACK}; color: ${EMAIL_THEME.text};">
${
  content.preheader
    ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; mso-hide: all;">${escapeEmailHtml(content.preheader)}</div>`
    : ""
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_THEME.page}" style="background-color: ${EMAIL_THEME.page};">
  <tr><td align="center" style="padding: 36px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px;">
      <tr><td style="padding: 0 0 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" style="padding-right: 10px;"><img src="${escapeEmailHtml(logoUrl)}" width="32" height="32" alt="" style="display: block; width: 32px; height: 32px; border-radius: 8px;"></td>
          <td valign="middle" style="font-family: ${FONT_STACK}; font-size: 15px; font-weight: 900; color: ${EMAIL_THEME.text};">Wisconsin Creative</td>
        </tr></table>
      </td></tr>
      <tr><td bgcolor="${EMAIL_THEME.background}" style="background-color: ${EMAIL_THEME.background}; border: 1px solid ${EMAIL_THEME.border}; border-radius: 14px; padding: 40px;">
        ${
          content.eyebrow
            ? `<div style="margin: 0 0 20px; font-size: 13px; line-height: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: ${eyebrowColor};">${escapeEmailHtml(content.eyebrow)}</div>`
            : ""
        }
        <h1 style="margin: 0 0 20px; font-size: 32px; line-height: 1.15; font-weight: 900; letter-spacing: -0.02em; color: ${EMAIL_THEME.text};">${escapeEmailHtml(content.headline)}</h1>
        ${content.paragraphs.map(paragraphHtml).join("")}
        ${content.steps ? stepsHtml(content.steps) : ""}
        ${content.facts && content.facts.length > 0 ? factsHtml(content.facts) : ""}
        ${content.action ? buttonHtml(content.action) : ""}
        ${
          content.note
            ? `<p style="margin: 16px 0 0; font-size: 14px; line-height: 1.5; color: ${EMAIL_THEME.muted};">${escapeEmailHtml(content.note)}</p>`
            : ""
        }
      </td></tr>
      ${
        footerHtml.length > 0
          ? `<tr><td style="padding: 20px 8px 0; font-size: 12px; line-height: 1.6; color: ${EMAIL_THEME.muted};">${footerHtml.join("<br><br>")}</td></tr>`
          : ""
      }
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const textParts: string[] = [];
  if (content.eyebrow) textParts.push(content.eyebrow.toUpperCase());
  textParts.push(content.headline);
  textParts.push(...content.paragraphs);
  if (content.steps) {
    textParts.push(
      [content.steps.heading, ...content.steps.items.map((item, index) => `${index + 1}. ${item}`)].join("\n")
    );
  }
  if (content.facts && content.facts.length > 0) {
    textParts.push(content.facts.map((fact) => `${fact.label}: ${fact.value}`).join("\n"));
  }
  if (content.action) textParts.push(`${content.action.label}: ${content.action.url}`);
  if (content.note) textParts.push(content.note);
  textParts.push(...footerLines);
  if (content.manageNotifications) textParts.push(`Manage notifications: ${settingsUrl}`);
  textParts.push("Wisconsin Creative");

  return { html, text: textParts.join("\n\n") };
}
