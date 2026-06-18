interface RateLoopEmailTemplateParams {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  eyebrow?: string;
  footerNote?: string;
  footerLinkLabel?: string;
  footerLinkHref?: string;
  linkIntro?: string;
}

const EMAIL_BG = "#050505";
const EMAIL_TEXT = "#f5f5f5";
const EMAIL_PRIMARY = "#f5f5f5";
const EMAIL_SURFACE_TOP = "#181818";
const EMAIL_SURFACE_BOTTOM = "#101010";
const EMAIL_SURFACE_GLOW = "rgba(245,245,245,0.08)";
const EMAIL_MUTED_TEXT = "rgba(245,245,245,0.82)";
const EMAIL_MUTED_LABEL = "rgba(245,245,245,0.58)";
const EMAIL_FOOTER = "rgba(139,133,142,0.92)";
const EMAIL_BORDER = "rgba(245,245,245,0.1)";
const EMAIL_SHADOW = "rgba(5,4,8,0.42)";
const EMAIL_BLUE = "#359EEE";
const EMAIL_GREEN = "#03CEA4";
const EMAIL_YELLOW = "#FFC43D";
const EMAIL_PINK = "#EF476F";
const EMAIL_SPECTRUM_GRADIENT = `linear-gradient(90deg, ${EMAIL_BLUE}, ${EMAIL_GREEN}, ${EMAIL_YELLOW}, ${EMAIL_PINK})`;
const EMAIL_ACTION_INNER_GRADIENT = "linear-gradient(180deg, rgba(24,24,24,0.98), rgba(16,16,16,0.96))";
const EMAIL_GRADIENT_TEXT_STYLE = [
  `color:${EMAIL_TEXT}`,
  `background:${EMAIL_SPECTRUM_GRADIENT}`,
  "-webkit-background-clip:text",
  "background-clip:text",
  "-webkit-text-fill-color:transparent",
  "display:inline-block",
].join("; ");

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderGradientText(value: string) {
  const safeValue = escapeHtml(value);
  return `<!--[if mso]><span style="color:${EMAIL_TEXT};">${safeValue}</span><![endif]--><!--[if !mso]><!--><span style="${EMAIL_GRADIENT_TEXT_STYLE};">${safeValue}</span><!--<![endif]-->`;
}

function renderHighlightedText(value: string, options: { highlightEmail?: boolean } = {}) {
  if (!options.highlightEmail) {
    return escapeHtml(value);
  }

  const pattern = /\bemail\b/gi;
  let cursor = 0;
  let html = "";

  for (const match of value.matchAll(pattern)) {
    const matchedText = match[0];
    const index = match.index ?? 0;
    html += escapeHtml(value.slice(cursor, index));
    html += renderGradientText(matchedText);
    cursor = index + matchedText.length;
  }

  html += escapeHtml(value.slice(cursor));
  return html;
}

export function buildRateLoopEmailHtml(params: RateLoopEmailTemplateParams) {
  const titleHtml = renderHighlightedText(params.title, { highlightEmail: true });
  const bodyHtml = renderHighlightedText(params.body);
  const safeCtaLabel = escapeHtml(params.ctaLabel);
  const safeCtaHref = escapeHtml(params.ctaHref);
  const safeEyebrow = escapeHtml(params.eyebrow ?? "RATELOOP NOTIFICATIONS");
  const footerNoteHtml = renderHighlightedText(
    params.footerNote ?? "You are receiving this email because you signed up for RateLoop email notifications.",
  );
  const safeFooterLinkLabel = params.footerLinkLabel ? escapeHtml(params.footerLinkLabel) : null;
  const safeFooterLinkHref = params.footerLinkHref ? escapeHtml(params.footerLinkHref) : null;
  const safeLinkIntro = escapeHtml(params.linkIntro ?? "If the button does not work, open this link manually:");

  return `
    <div style="margin:0; padding:32px 16px; background:${EMAIL_BG}; color:${EMAIL_TEXT};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; width:100%; background:${EMAIL_BG};">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate; width:100%; max-width:640px;">
              <tr>
                <td style="padding:0 0 16px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td
                        style="color:${EMAIL_TEXT}; font-family:Arial, Helvetica, sans-serif; font-size:26px; line-height:1; font-weight:700; letter-spacing:0;"
                      >
                        RateLoop
                        <div style="margin-top:5px; color:${EMAIL_MUTED_LABEL}; font-size:11px; line-height:1.2; font-weight:700; letter-spacing:0.8px; text-transform:uppercase;">
                          Level Up Your Agent
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td
                  style="
                    background:
                      radial-gradient(circle at top right, ${EMAIL_SURFACE_GLOW}, transparent 42%),
                      linear-gradient(180deg, ${EMAIL_SURFACE_TOP} 0%, ${EMAIL_SURFACE_BOTTOM} 100%);
                    border:1px solid ${EMAIL_BORDER};
                    border-radius:28px;
                    padding:0;
                    box-shadow:0 24px 54px ${EMAIL_SHADOW};
                    overflow:hidden;
                  "
                >
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; width:100%;">
                    <tr>
                      <td width="25%" height="4" bgcolor="${EMAIL_BLUE}" style="height:4px; background:${EMAIL_BLUE}; font-size:0; line-height:0;"></td>
                      <td width="25%" height="4" bgcolor="${EMAIL_GREEN}" style="height:4px; background:${EMAIL_GREEN}; font-size:0; line-height:0;"></td>
                      <td width="25%" height="4" bgcolor="${EMAIL_YELLOW}" style="height:4px; background:${EMAIL_YELLOW}; font-size:0; line-height:0;"></td>
                      <td width="25%" height="4" bgcolor="${EMAIL_PINK}" style="height:4px; background:${EMAIL_PINK}; font-size:0; line-height:0;"></td>
                    </tr>
                  </table>
                  <div style="padding:36px 34px 30px;">
                    <div style="margin:0 0 14px; color:${EMAIL_PRIMARY}; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase;">
                      ${safeEyebrow}
                    </div>
                    <h1 style="margin:0 0 16px; color:${EMAIL_TEXT}; font-family:Arial, Helvetica, sans-serif; font-size:34px; line-height:1.12; font-weight:700;">
                      ${titleHtml}
                    </h1>
                    <p style="margin:0 0 28px; color:${EMAIL_MUTED_TEXT}; font-family:Arial, Helvetica, sans-serif; font-size:18px; line-height:1.65;">
                      ${bodyHtml}
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate; margin:0 0 28px;">
                      <tr>
                        <td
                          align="center"
                          bgcolor="${EMAIL_BLUE}"
                          style="
                            border-radius:10px;
                            background:${EMAIL_SPECTRUM_GRADIENT};
                            padding:2px;
                            box-shadow:0 0 0 1px rgba(245,245,245,0.08), 0 18px 36px rgba(0,0,0,0.32);
                          "
                        >
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                            <tr>
                              <td
                                align="center"
                                bgcolor="${EMAIL_SURFACE_BOTTOM}"
                                style="
                                  border-radius:8px;
                                  background:${EMAIL_ACTION_INNER_GRADIENT};
                                  box-shadow:inset 0 1px 0 rgba(245,245,245,0.08);
                                "
                              >
                                <a
                                  href="${safeCtaHref}"
                                  style="
                                    display:inline-block;
                                    padding:14px 22px;
                                    color:${EMAIL_TEXT};
                                    font-family:Arial, Helvetica, sans-serif;
                                    font-size:16px;
                                    font-weight:700;
                                    line-height:1;
                                    text-decoration:none;
                                  "
                                >
                                  ${safeCtaLabel}
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                    <div
                      style="
                        margin:0 0 22px;
                        padding:18px 20px;
                        background:${EMAIL_BG};
                        border:1px solid ${EMAIL_BORDER};
                        border-left:4px solid ${EMAIL_GREEN};
                        border-radius:18px;
                      "
                    >
                      <p style="margin:0 0 10px; color:${EMAIL_MUTED_LABEL}; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:1.6;">
                        ${safeLinkIntro}
                      </p>
                      <a
                        href="${safeCtaHref}"
                        style="
                          color:${EMAIL_PRIMARY};
                          font-family:Arial, Helvetica, sans-serif;
                          font-size:14px;
                          line-height:1.7;
                          text-decoration:underline;
                          word-break:break-all;
                        "
                      >
                        ${safeCtaHref}
                      </a>
                    </div>
                    <div style="padding-top:18px; border-top:1px solid ${EMAIL_BORDER}; color:${EMAIL_FOOTER}; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:1.6;">
                      ${footerNoteHtml}
                      ${
                        safeFooterLinkHref && safeFooterLinkLabel
                          ? `
                        <div style="margin-top:10px;">
                          <a
                            href="${safeFooterLinkHref}"
                            style="
                              color:${EMAIL_PRIMARY};
                              font-family:Arial, Helvetica, sans-serif;
                              font-size:13px;
                              line-height:1.6;
                              text-decoration:underline;
                            "
                          >
                            ${safeFooterLinkLabel}
                          </a>
                        </div>
                      `
                          : ""
                      }
                    </div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}
