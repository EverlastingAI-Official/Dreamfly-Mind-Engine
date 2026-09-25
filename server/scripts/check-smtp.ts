import { createMailTransport } from '../src/mail.js';

try {
  const transport = createMailTransport();
  try {
    await transport.verify();
    console.log('SMTP 连接与认证成功。此检查不发送邮件；实际验证码由 worker 投递。');
  } finally {
    transport.close();
  }
} catch (error: any) {
  // Do not print server responses or credentials.
  const category = error.code === 'EAUTH' ? '认证失败，请检查 SMTP 服务是否开启及授权码是否有效'
    : error.code === 'ENOENT' ? '授权码文件不存在，请检查 SMTP_PASSWORD_FILE'
    : '请检查 SMTP 主机、端口、TLS 配置、授权码和网络连接';
  console.error(`SMTP 检查失败：${category}。`);
  process.exitCode = 1;
}
