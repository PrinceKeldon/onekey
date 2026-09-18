import html
import json
from datetime import datetime
from urllib.request import Request, urlopen

from app.database import settings


def send_transfer_email(
    *,
    recipient: str,
    recipient_name: str,
    thing_name: str,
    onekey_code: str,
    role: str,
    confirmation_url: str,
    expires_at: datetime,
) -> None:
    if not settings.resend_api_key or not settings.email_from:
        raise RuntimeError("RESEND_API_KEY and EMAIL_FROM are required to send transfer emails")

    if role == "current":
        subject = f"Confirm transfer of {thing_name} — ONEKEY #{onekey_code}"
        heading = "Confirm ownership transfer"
        intro = "A request was made to transfer this ONEKEY record away from you."
        action = "If you initiated this transfer, confirm it below."
    else:
        subject = f"Confirm ownership of {thing_name} — ONEKEY #{onekey_code}"
        heading = "Confirm new ownership"
        intro = "You have been named as the new owner of this ONEKEY record."
        action = "If you accept the transfer, confirm it below."

    safe_name = html.escape(recipient_name or "there")
    safe_thing = html.escape(thing_name)
    safe_code = html.escape(onekey_code)
    safe_url = html.escape(confirmation_url, quote=True)
    expiry = html.escape(expires_at.strftime("%d %B %Y at %H:%M UTC"))

    body = f"""<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
    <h2>{heading}</h2>
    <p>Hello {safe_name},</p>
    <p>{intro}</p>
    <p><strong>{safe_thing}</strong><br>ONEKEY #{safe_code}</p>
    <p>{action}</p>
    <p><a href="{safe_url}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:7px">Confirm transfer</a></p>
    <p>This link is single-use and expires {expiry}.</p>
    <p>If you did not expect this request, you can ignore this email.</p>
  </body>
</html>"""

    payload = json.dumps({
        "from": settings.email_from,
        "to": [recipient],
        "subject": subject,
        "html": body,
    }).encode("utf-8")

    request = Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"email provider returned HTTP {response.status}")
