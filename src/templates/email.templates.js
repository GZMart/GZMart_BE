export const emailTemplates = {
  REGISTRATION: {
    subject: 'Welcome to GZMart - Verify Your Email',
    getContent: ({ name, verificationLink }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Welcome to GZMart!</h1>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Thank you for registering with GZMart. To complete your registration and access all features, please verify your email address by clicking the button below:</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email Address</a>
        </div>
        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
          <p style="margin: 0;">If you didn't request this, please ignore this email.</p>
          <p style="margin: 10px 0 0 0;">This verification link will expire in 1 hour.</p>
          <p style="margin: 10px 0 0 0;">Best regards,<br>GZMart Team</p>
        </div>
      </div>
    `,
  },

  VERIFICATION: {
    subject: 'Verify Your Email - GZMart',
    getContent: ({ name, verificationLink }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Verify Your Email Address</h1>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Please verify your email address by clicking the button below to access your GZMart account:</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email Address</a>
        </div>
        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
          <p style="margin: 0;">If you didn't request this, please ignore this email.</p>
          <p style="margin: 10px 0 0 0;">This verification link will expire in 1 hour.</p>
          <p style="margin: 10px 0 0 0;">Best regards,<br>GZMart Team</p>
        </div>
      </div>
    `,
  },

  PASSWORD_RESET: {
    subject: 'Reset Your Password - GZMart',
    getContent: ({ name, resetLink }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Password Reset Request</h1>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">We received a request to reset your password for your GZMart account.</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Click the button below to reset your password:</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
        </div>
        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
          <p style="margin: 0;">If you didn't request this, please ignore this email.</p>
          <p style="margin: 10px 0 0 0;">This link will expire in 1 hour.</p>
          <p style="margin: 10px 0 0 0;">Best regards,<br>GZMart Team</p>
        </div>
      </div>
    `,
  },

  OTP: {
    subject: 'Your Verification Code - GZMart',
    getContent: ({ name, otp, expiresIn = '5 minutes' }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Verification Code</h1>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name || 'User'},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Your verification code is:</p>
          <div style="text-align: center; margin: 30px 0;">
            <div style="background-color: #3498db; color: white; padding: 20px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 8px; display: inline-block;">
              ${otp}
            </div>
          </div>
          <p style="color: #34495e; margin: 15px 0 0 0;">This code will expire in ${expiresIn}.</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">If you didn't request this code, please ignore this email.</p>
        </div>
        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
          <p style="margin: 0;">Best regards,<br>GZMart Team</p>
        </div>
      </div>
    `,
  },
};