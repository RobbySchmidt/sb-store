import nodemailer, { type Transporter } from 'nodemailer'

let transporter: Transporter | null = null

/** Lazily built from MAIL_* env vars. Locally this points at the Mailpit container. */
function mailer(): Transporter {
  if (!transporter) {
    const host = process.env.MAIL_HOST
    const port = Number(process.env.MAIL_PORT)
    if (!host || !port || !process.env.MAIL_FROM) {
      throw new Error('MAIL_HOST / MAIL_PORT / MAIL_FROM missing in env')
    }
    const user = process.env.MAIL_USER
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.MAIL_SECURE === 'true',
      // Mailpit needs no credentials — only send auth when a user is configured
      auth: user ? { user, pass: process.env.MAIL_PASS ?? '' } : undefined,
    })
  }
  return transporter
}

export interface OutgoingMail {
  to: string
  subject: string
  html: string
  text: string
}

export function sendMail(mail: OutgoingMail) {
  return mailer().sendMail({ from: process.env.MAIL_FROM, ...mail })
}
