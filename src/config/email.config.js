export const emailConfig = {
  // Google OAuth2 Configuration
  googleMailerClientId: process.env.GOOGLE_MAILER_CLIENT_ID,
  googleMailerClientSecret: process.env.GOOGLE_MAILER_CLIENT_SECRET,
  googleMailerRefreshToken: process.env.GOOGLE_MAILER_REFRESH_TOKEN,

  // Email Addresses
  adminEmailAddress: process.env.ADMIN_EMAIL_ADDRESS,
  fromName: process.env.FROM_NAME,

  // SMTP Configuration (Fallback)
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  },

  // Email Settings
  maxRetries: parseInt(process.env.EMAIL_MAX_RETRIES || '3'),
  retryDelay: parseInt(process.env.EMAIL_RETRY_DELAY || '1000'),
  timeout: parseInt(process.env.EMAIL_TIMEOUT || '5000'),

  // Email Templates
  defaultLanguage: process.env.EMAIL_DEFAULT_LANGUAGE || 'en',
  defaultTimezone: process.env.EMAIL_DEFAULT_TIMEZONE || 'UTC',
};

// Validate required configuration - chỉ throw error trong production
// Trong development, cho phép thiếu config (email sẽ được skip)
const isProduction = process.env.NODE_ENV === 'production';
const hasEmailConfig = 
  emailConfig.googleMailerClientId &&
  emailConfig.googleMailerClientSecret &&
  emailConfig.googleMailerRefreshToken &&
  emailConfig.adminEmailAddress;

if (isProduction && !hasEmailConfig) {
  console.warn('⚠️ Warning: Missing email configuration. Email features will be disabled.');
}

export const isEmailConfigured = hasEmailConfig;