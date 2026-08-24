export const BUSINESS_INFO = {
  name: "Husnalogy",
  tagline: "Timeless Invitations & Gifts",
  email: "hello@husnalogy.com",
  phone: "+880 1575 004432",
  phoneHref: "tel:+8801575004432",
  whatsappHref: "https://wa.me/8801575004432",
  address: "42/4c Nurani, Bonkolapara, Subidbazar, Sylhet, Bangladesh",
  city: "Sylhet",
  country: "Bangladesh",
  socialProfiles: {
    instagram: "https://www.instagram.com/husnalogy",
    facebook: "https://www.facebook.com/husnalogy/",
  },
} as const;

export const LAUNCH_FEATURES = {
  sslCommerz: false,
  emailSettings: false,
  marketingEmail: false,
  fixedShippingRates: false,
} as const;

export const ORDER_POLICY = {
  paymentMethod: "Cash on Delivery",
  deliveryCharge:
    "For delivery orders, Husnalogy reviews the destination and confirms the delivery charge before fulfillment. Store pickup has no delivery charge.",
  personalizedReturns:
    "Personalized items cannot be returned for a change of mind. Contact Husnalogy promptly if an item arrives damaged, defective, or different from the approved order.",
} as const;
