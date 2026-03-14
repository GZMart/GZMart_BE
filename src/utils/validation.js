// Email validation
export const validateEmail = email => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// Phone validation
export const validatePhone = phone => {
  const re = /^[0-9]{10,11}$/;
  return re.test(phone);
};

// Password validation
export const validatePassword = password => {
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character
  const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
  return re.test(password);
};