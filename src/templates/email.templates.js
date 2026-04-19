export const emailTemplates = {
  REGISTRATION: {
    subject: "Welcome to GZMart - Verify Your Email",
    getContent: ({ name, verificationLink }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Welcome to GZMart!</h1>
        </div>
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Thank you for registering with GZMart. To complete your registration and access all features, please verify your email address by clicking the button below:</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #B13C36; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email Address</a>
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
    subject: "Verify Your Email - GZMart",
    getContent: ({ name, verificationLink }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Verify Your Email Address</h1>
        </div>
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Please verify your email address by clicking the button below to access your GZMart account:</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #B13C36; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email Address</a>
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
    subject: "Reset Your Password - GZMart",
    getContent: ({ name, resetLink }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Password Reset Request</h1>
        </div>
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">We received a request to reset your password for your GZMart account.</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Click the button below to reset your password:</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #B13C36; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
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
    subject: "Your Verification Code - GZMart",
    getContent: ({ name, otp, expiresIn = "5 minutes" }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Verification Code</h1>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name || "User"},</p>
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

  ORDER_CONFIRMATION: {
    subject: "Đơn hàng của bạn đã được xác nhận - GZMart",
    getContent: ({
      name,
      orderNumber,
      orderDate,
      totalPrice,
      items,
      shippingAddress,
    }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">🎉 Thanh toán thành công!</h1>
        </div>
        
        <div style="background-color: #d4edda; padding: 20px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #28a745;">
          <p style="color: #155724; margin: 0; font-size: 16px;">
            <strong>Xin chào ${name},</strong>
          </p>
          <p style="color: #155724; margin: 15px 0 0 0;">
            Cảm ơn bạn đã mua sắm tại GZMart! Đơn hàng của bạn đã được thanh toán thành công và đang được xử lý.
          </p>
        </div>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">📦 Thông tin đơn hàng</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #7f8c8d;">Mã đơn hàng:</td>
              <td style="padding: 8px 0; color: #2c3e50; font-weight: bold; text-align: right;">${orderNumber}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #7f8c8d;">Ngày đặt:</td>
              <td style="padding: 8px 0; color: #2c3e50; text-align: right;">${orderDate}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #7f8c8d;">Tổng tiền:</td>
              <td style="padding: 8px 0; color: #e74c3c; font-weight: bold; text-align: right; font-size: 18px;">${totalPrice}</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">🛍️ Sản phẩm</h2>
          ${items}
        </div>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">🚚 Địa chỉ giao hàng</h2>
          <p style="color: #34495e; margin: 0; line-height: 1.6;">${shippingAddress}</p>
        </div>

        <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
          <p style="color: #856404; margin: 0; font-size: 14px;">
            <strong>Lưu ý:</strong> Đơn hàng sẽ được giao trong vòng 2-3 ngày làm việc. Bạn sẽ nhận được thông báo khi đơn hàng được giao.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL}/orders/${orderNumber}" style="background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Xem chi tiết đơn hàng</a>
        </div>

        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
          <p style="margin: 0;">Nếu bạn có thắc mắc, vui lòng liên hệ với chúng tôi.</p>
          <p style="margin: 10px 0 0 0;">Trân trọng,<br>Đội ngũ GZMart</p>
        </div>
      </div>
    `,
  },

  WELCOME: {
    subject: "Welcome to GZMart - Registration Successful!",
    getContent: ({ name }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2c3e50; margin: 0;">Welcome to GZMart! 🚀</h1>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
          <p style="color: #34495e; margin: 0;">Hi ${name},</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">Congratulations! Your account has been successfully verified.</p>
          <p style="color: #34495e; margin: 15px 0 0 0;">We are verified excited to have you on board. You can now log in and start shopping for the best deals.</p>
        </div>
        <div style="text-align: center; color: #7f8c8d; font-size: 14px;">
          <p style="margin: 0;">If you have any questions, feel free to contact our support team.</p>
          <p style="margin: 10px 0 0 0;">Happy Shopping! 🛒</p>
          <p style="margin: 10px 0 0 0;">Best regards,<br>GZMart Team</p>
        </div>
      </div>
    `,
  },

  /** Email thông báo seller: cảnh cáo campaign hoặc campaign bị admin dừng */
  CAMPAIGN_SELLER_NOTICE: {
    subject: "Thông báo từ GZMart — Campaign / Flash Sale",
    getContent: ({ name, heading, bodyHtml }) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <div style="border-bottom: 2px solid #B13C36; padding-bottom: 12px; margin-bottom: 20px;">
          <h1 style="color: #1e293b; margin: 0; font-size: 20px;">${heading}</h1>
        </div>
        <p style="color: #334155; margin: 0 0 16px 0;">Xin chào ${name || "Quý seller"},</p>
        <div style="background: #fff7ed; border-left: 4px solid #ea580c; padding: 16px; border-radius: 6px; color: #431407; font-size: 14px; line-height: 1.6;">
          ${bodyHtml}
        </div>
        <p style="color: #64748b; font-size: 13px; margin: 20px 0 0 0;">
          Bạn cũng nhận được thông báo này trong mục Thông báo trên trang seller.
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Trân trọng,<br>Đội ngũ GZMart</p>
      </div>
    `,
  },
};
