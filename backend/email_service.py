"""
Email service module - sends emails via Amazon SES SMTP
"""
import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SES_SMTP_HOST = os.getenv("SES_SMTP_HOST", "email-smtp.us-east-2.amazonaws.com")
SES_SMTP_PORT = int(os.getenv("SES_SMTP_PORT", "587"))
SES_SMTP_USERNAME = os.getenv("SES_SMTP_USERNAME", "")
SES_SMTP_PASSWORD = os.getenv("SES_SMTP_PASSWORD", "")
SES_FROM_EMAIL = os.getenv("SES_FROM_EMAIL", "noreply@soulforgetech.com")


def send_verification_email(to_email: str, code: str, user_name: str = "") -> bool:
    """Send a 6-digit verification code email. Returns True on success."""
    subject = f"SoulLink - Your verification code is {code}"

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #fff;">
        <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #e8b4b8; font-size: 28px; margin: 0;">SoulLink</h1>
            <p style="color: #999; font-size: 13px; margin-top: 4px;">Your AI Companion</p>
        </div>
        <p style="color: #333; font-size: 15px;">Hi {user_name or 'there'},</p>
        <p style="color: #555; font-size: 14px;">Please use the following code to verify your email address:</p>
        <div style="font-size: 36px; font-weight: 700; letter-spacing: 10px;
                    color: #5a4a4a; background: linear-gradient(135deg, #fdf2f4, #f8e8ea);
                    padding: 20px; border-radius: 12px; text-align: center; margin: 24px 0;
                    border: 1px solid #f0d0d4;">
            {code}
        </div>
        <p style="color: #888; font-size: 13px; text-align: center;">This code expires in <strong>10 minutes</strong>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="color: #aaa; font-size: 12px; text-align: center;">
            If you didn't request this, you can safely ignore this email.
        </p>
    </div>
    """

    text_body = f"Hi {user_name or 'there'},\n\nYour SoulLink verification code is: {code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email."

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"SoulLink <{SES_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP(SES_SMTP_HOST, SES_SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SES_SMTP_USERNAME, SES_SMTP_PASSWORD)
            server.sendmail(SES_FROM_EMAIL, to_email, msg.as_string())
        logging.info(f"Verification email sent to {to_email}")
        return True
    except Exception as e:
        logging.error(f"Failed to send verification email to {to_email}: {e}")
        return False
