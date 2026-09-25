import nodemailer from 'nodemailer';
import { secret } from './config.js';

// Shared by the worker and the connection check so both use identical settings.
export function createMailTransport() {
  if (!process.env.SMTP_HOST) throw new Error('Missing SMTP_HOST');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || (process.env.SMTP_SECURE === 'true' ? 465 : 587)),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    ...(process.env.SMTP_USER ? {
      auth: { user: process.env.SMTP_USER, pass: secret('SMTP_PASSWORD', true) },
    } : {}),
  });
}

export async function sendEmailCode(email: string, purpose: string, code: string) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('Missing SMTP_FROM');
  const transport = createMailTransport();
  try {
    await transport.sendMail({
      from,
      to: email,
      subject: purpose === 'register' ? 'DreamFly 注册验证码' : 'DreamFly 重置密码验证码',
      text: `您的验证码：${code}\n请在有效期内使用。若非本人操作，请忽略。`,
      textEncoding: 'base64',
    });
  } finally {
    transport.close();
  }
}
