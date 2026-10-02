/**
 * Customer-facing business details. Contact, Support, the footer and the
 * structured data all read from here so they cannot drift apart.
 */
export const BUSINESS_INFO: {
  name: string;
  tagline: string;
  founder: string;
  email: string;
  phone: string;
  phoneHref: string;
  whatsappHref: string;
  address: string;
  city: string;
  country: string;
  /**
   * Published support hours, e.g. "Sun–Thu, 10:00 AM–8:00 PM (BST)". Left
   * null until the business confirms them: the storefront previously showed
   * two conflicting schedules, and pages hide the hours while this is unset.
   */
  supportHours: string | null;
  socialProfiles: { instagram: string; facebook: string };
} = {
  name: "Husnalogy",
  tagline: "Timeless Invitations & Gifts",
  founder: "Foyez Ahmed",
  email: "hello@husnalogy.com",
  phone: "+880 1575 004432",
  phoneHref: "tel:+8801575004432",
  whatsappHref: "https://wa.me/8801575004432",
  address: "42/4c Nurani, Bonkolapara, Subidbazar, Sylhet, Bangladesh",
  city: "Sylhet",
  country: "Bangladesh",
  supportHours: null,
  socialProfiles: {
    instagram: "https://www.instagram.com/husnalogy",
    facebook: "https://www.facebook.com/husnalogy/",
  },
};

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
