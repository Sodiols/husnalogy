import OpenAI from "openai";
import { rateLimit, rejectLargeRequest } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const SODIOL_FACEBOOK_LINK = process.env.SODIOL_FACEBOOK_LINK || "";
const SODIOL_INSTAGRAM_LINK = process.env.SODIOL_INSTAGRAM_LINK || "";

// Logy uses the live AI whenever a funded OPENAI_API_KEY is configured, and
// falls back to its local brain otherwise. Set LOGY_USE_OPENAI=false to force
// the local-only mode even when a key is present.
const USE_OPENAI = Boolean(process.env.OPENAI_API_KEY) && process.env.LOGY_USE_OPENAI !== "false";
const OPENAI_COOLDOWN_MS = 5 * 60 * 1000;
let openaiCooldownUntil = 0;

function sodiolLinks() {
  return SODIOL_FACEBOOK_LINK && SODIOL_INSTAGRAM_LINK
    ? ` You can find Sodiol here. Facebook: ${SODIOL_FACEBOOK_LINK} Instagram: ${SODIOL_INSTAGRAM_LINK}`
    : "";
}

/* ----------------------------------------------------------------------------
   Logy's local brain: a keyword-scored knowledge base. Each intent lists trigger
   words (phrases score higher) and the warm reply Logy gives. The best-scoring
   intent wins, so order does not matter and many phrasings are handled.
---------------------------------------------------------------------------- */

const INTENTS = [
  // About the brand
  {
    keywords: ["what is husnalogy", "about husnalogy", "tell me about", "what do you sell", "what do you offer", "what is this store", "what is this site"],
    reply:
      "Husnalogy is an elegant online store for wedding invitations, save the dates, nikah and birthday invitations, cards, personalized gifts, and stationery, all designed to feel personal and timeless.",
  },

  // Where to find — navigation
  {
    keywords: ["save the date", "save-the-date", "savethedate"],
    reply: "You can find Save the Dates on the Save the Dates page at /save-the-dates, also inside the Weddings section.",
  },
  {
    keywords: ["wedding invitation", "wedding card", "wedding", "nikah", "marriage", "engagement"],
    reply:
      "Wedding and nikah invitations are in the Weddings section at /weddings. Would you like elegant, minimal, floral, classic, rustic, or luxury styles?",
  },
  {
    keywords: ["stationery", "menu card", "menus", "rsvp", "envelope", "program", "place card", "table"],
    reply: "Stationery such as menus, RSVP cards, programs, and envelopes is on the Stationery page at /stationery.",
  },
  {
    keywords: ["gift", "present", "hamper", "personalized gift", "personalised gift"],
    reply: "Gifts and personalized gift ideas are on the Gifts page at /gifts. Who is the gift for, so I can suggest something thoughtful?",
  },
  {
    keywords: ["thank you card", "greeting card", "cards", "card"],
    reply: "Cards, including greeting and thank you cards, are on the Cards page at /cards.",
  },
  {
    keywords: ["birthday"],
    reply: "For birthdays, browse the Products page at /products and filter by occasion, or tell me the style and I will guide you.",
  },
  {
    keywords: ["browse", "shop", "all products", "see products", "product page", "catalog", "catalogue", "everything you have", "show me", "explore"],
    reply: "You can browse everything on the Products page at /products, then filter by theme, occasion, format, colour, and price.",
  },
  {
    keywords: ["where can i find", "where do i find", "where are the", "which page", "which section", "navigate", "find products"],
    reply:
      "I can point you to the right page. Weddings are at /weddings, Save the Dates at /save-the-dates, Gifts at /gifts, Stationery at /stationery, Cards at /cards, and everything together at /products.",
  },

  // Contact and support
  {
    keywords: ["contact", "reach you", "reach the team", "phone", "whatsapp", "email", "message you", "talk to someone", "customer service", "support"],
    reply: "You can reach the Husnalogy team any time through the Contact page at /contact, and the team will reply with care.",
  },
  {
    keywords: ["studio", "visit", "address", "location", "where are you located"],
    reply: "Husnalogy is an online studio. The best way to reach the team is through the Contact page at /contact.",
  },

  // Buying journey
  {
    keywords: ["how to order", "how do i order", "place an order", "order process", "buy", "purchase", "checkout", "add to cart"],
    reply:
      "To order, open the product you love, personalize the details, add it to your cart, and continue to checkout. The team then confirms the final details with you.",
  },
  {
    keywords: ["payment", "pay", "card payment", "bkash", "cash", "online payment"],
    reply: "Payment is arranged after your order is reviewed, so the team can confirm the type, quantity, and customization first. They will guide you through it.",
  },
  {
    keywords: ["price", "cost", "how much", "charge", "rate", "budget", "expensive", "cheap"],
    reply: "The final price depends on the product type, quantity, and customization. Tell me what you would like and I will guide you.",
  },
  {
    keywords: ["delivery", "shipping", "deliver", "ship", "arrive", "how long to receive", "when will i get"],
    reply: "Husnalogy offers reliable delivery. Timing depends on the product and customization, and the team confirms the details after your order is placed.",
  },
  {
    keywords: ["return", "refund", "exchange", "cancel", "change my order", "wrong order"],
    reply: "If something is not right, please reach the team through the Contact page at /contact and they will help you with changes, cancellations, or any concern.",
  },
  {
    keywords: ["track", "my order", "order status", "where is my order", "delivered"],
    reply: "You can see your orders and their latest status on the My Orders page after signing in. The status updates as Husnalogy moves your order forward.",
  },
  {
    keywords: ["account", "sign in", "log in", "login", "register", "sign up", "my profile"],
    reply: "You can sign in from the account icon at the top of the site to save your orders, wishlist, and addresses.",
  },
  {
    keywords: ["wishlist", "favourite", "favorite", "save for later", "heart"],
    reply: "Tap the heart on any product to save it to your wishlist, then open the wishlist from the heart icon at the top of the site.",
  },
  {
    keywords: ["cart", "basket", "bag"],
    reply: "Your cart is at the top of the site under the bag icon. Add the pieces you love, then continue to checkout when you are ready.",
  },
  {
    keywords: ["review", "rating", "feedback", "can i review"],
    reply: "You can leave a review on a product once your order for it has been delivered. Your kind words help other customers too.",
  },

  // Design help
  {
    keywords: ["who designs", "who design", "designer", "who makes"],
    reply: "Husnalogy designs are created by the Husnalogy design team with great care and attention to detail.",
  },
  {
    keywords: ["design", "style", "theme", "aesthetic", "look", "modern", "minimal", "classic", "luxury", "rustic", "floral", "elegant"],
    reply:
      "Husnalogy designs are elegant and refined. For invitations you can choose minimal, modern, classic, floral, rustic, or luxury styles. Which feels right for your moment?",
  },
  {
    keywords: ["colour", "color", "shade", "palette", "tone"],
    reply: "Lovely colour choices include ivory, white, champagne, gold, beige, soft pink, deep green, navy, and brown. Would you like calm and classic, or something bolder?",
  },
  {
    keywords: ["paper", "material", "quality", "texture", "card stock", "finish", "foil", "matte"],
    reply: "Husnalogy uses refined papers and finishes that feel premium, including soft matte and elegant foil options on selected designs.",
  },
  {
    keywords: ["size", "dimension", "how big", "measurements"],
    reply: "Sizes vary by product, and many invitations come in classic card sizes. Tell me the product you like and I will share the available options.",
  },
  {
    keywords: ["photo", "picture", "image on", "add my photo"],
    reply: "Many designs support adding your own photos. Look for photo based styles, or share your idea and I will point you to the right pieces.",
  },
  {
    keywords: ["quantity", "bulk", "minimum order", "how many", "set of"],
    reply: "You can choose your quantity during personalization, and the team will confirm options for larger sets. How many do you think you need?",
  },
  {
    keywords: ["custom", "personalize", "personalise", "personalized", "names", "wording", "edit text", "change text"],
    reply:
      "Yes, pieces are personalized for you, including names, dates, wording, and colours. Open a product, fill in your details, and the team refines it before printing.",
  },
  {
    keywords: ["wording", "what to write", "etiquette", "message ideas", "what should i say"],
    reply: "I am happy to help with wording. Tell me the occasion and the names, and I will suggest warm, elegant phrasing for your card.",
  },
  {
    keywords: ["when should i order", "how early", "timeline", "how soon", "planning", "before the wedding"],
    reply: "For weddings, ordering a few weeks ahead is comfortable so there is time to personalize and deliver. Share your date and I will help you plan.",
  },
  {
    keywords: ["sample", "preview", "see a sample", "proof"],
    reply: "You can preview each design on its product page, and the team confirms the personalized details with you before printing.",
  },
  {
    keywords: ["discount", "offer", "sale", "coupon", "promo", "deal"],
    reply: "For current offers, keep an eye on the store and the newsletter. I can also help you find beautiful pieces that suit your budget.",
  },
  {
    keywords: ["language", "bangla", "bengali", "english", "arabic"],
    reply: "Designs can be personalized with your preferred wording. Share the language and text you want, and the team will set it beautifully.",
  },

  // Small talk
  {
    keywords: ["how are you", "how r u", "how do you do", "how is it going"],
    reply: "I am wonderful, thank you. I am here and happy to help you find something beautiful. What occasion are you shopping for?",
  },
  {
    keywords: ["your name", "who are you", "what are you", "what is your name"],
    reply: "I am Logy, the Husnalogy shopping assistant. I can help you with designs, gifts, and finding the right page on the site.",
  },
  {
    keywords: ["what can you do", "how can you help", "help me", "what do you do"],
    reply:
      "I can help you choose invitations, cards, and gifts, suggest styles and colours, and guide you to the right page like Weddings, Save the Dates, Gifts, Stationery, or Cards. What would you like to explore?",
  },
  {
    keywords: ["thank", "thanks", "shukria", "shukran", "appreciate"],
    reply: "You are most welcome. I am always here to help you find something beautiful for your special moment.",
  },
  {
    keywords: ["bye", "goodbye", "see you", "take care"],
    reply: "Take care, and congratulations on your special moment. Come back any time and I will be right here to help.",
  },
  {
    keywords: ["love you", "you are great", "you are amazing", "good job", "well done"],
    reply: "That is very kind of you, thank you. It is my joy to help you create something meaningful.",
  },
  {
    keywords: ["hi", "hello", "hey", "salam", "assalam", "hola", "good morning", "good evening", "good afternoon"],
    reply: "Welcome to Husnalogy. Tell me what occasion you are shopping for, and I will point you to the right section.",
  },
];

function asksAboutOrigin(text) {
  return ["found", "made", "create", "built", "developer", "behind", "owner", "who is", "who's", "who runs"].some((w) =>
    text.includes(w)
  );
}

function scoreIntent(text, intent) {
  if (intent.exclude && intent.exclude.some((word) => text.includes(word))) return 0;
  let score = 0;
  for (const keyword of intent.keywords) {
    if (text.includes(keyword)) score += keyword.includes(" ") || keyword.includes("-") ? 3 : 1;
  }
  return score;
}

function answerLocally(rawMessage) {
  const text = String(rawMessage || "").toLowerCase();

  // Founders — Husnalogy checked first because "husnalogy" contains the substring "logy".
  if (asksAboutOrigin(text) && text.includes("husnalogy")) {
    return "Husnalogy was founded by Sodiol Foyez.";
  }
  if (
    (asksAboutOrigin(text) && (text.includes("logy") || /assistant|chatbot|\bbot\b/.test(text))) ||
    /(made|built|created|founded|developed|behind)\s+you/.test(text)
  ) {
    return `Logy was founded by Sodiol Sayem.${sodiolLinks()}`;
  }

  let best = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    const score = scoreIntent(text, intent);
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }

  if (best && bestScore > 0) {
    return typeof best.reply === "function" ? best.reply(text) : best.reply;
  }

  return "I would love to help. Are you looking for wedding invitations, save the dates, gifts, stationery, or cards? Tell me the occasion and I will point you to the right page.";
}

/* ---------------------- Optional OpenAI enhancement ---------------------- */

function buildLogyInstructions() {
  const linkRule =
    SODIOL_FACEBOOK_LINK && SODIOL_INSTAGRAM_LINK
      ? `When you mention Sodiol Sayem, you may include these exact links. Facebook: ${SODIOL_FACEBOOK_LINK} Instagram: ${SODIOL_INSTAGRAM_LINK}`
      : `Do not invent Facebook or Instagram links.`;

  return `
You are Logy, the warm shopping assistant for Husnalogy.
Your name is Logy. Never call yourself Ask Logy.

Founders:
If someone asks who founded Logy, made you, or built the AI, reply: Logy was founded by Sodiol Sayem.
If someone asks who founded Husnalogy, reply: Husnalogy was founded by Sodiol Foyez.
${linkRule}

Husnalogy is an elegant online store for wedding invitations, save the dates, nikah invitations, birthday invitations, cards, personalized gifts, and stationery.
Help customers with design choices and guide them to the right page.
Wedding invitations are at /weddings, save the dates at /save-the-dates, gifts at /gifts, stationery at /stationery, cards at /cards, all products at /products, and contact at /contact.

Speak warmly and clearly. No markdown, asterisks, hashtags, bullets, or code formatting.
Do not mention OpenAI or that you are an AI model.
Keep answers under 55 words.
`;
}

/* ------------------------------- Utilities ------------------------------- */

function cleanMessage(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 1000);
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && ["user", "assistant"].includes(item.role))
    .map((item) => ({ role: item.role, content: cleanMessage(item.content) }))
    .filter((item) => item.content)
    .slice(-6);
}

function cleanReply(value) {
  if (typeof value !== "string") return "";

  return value
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1: $2")
    .replace(/\bAsk\s+Logy\b/gi, "Logy")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "")
    .replace(/`/g, "")
    .replace(/#{1,6}\s?/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(request) {
  let message = "";

  try {
    const largeRequest = rejectLargeRequest(request, 24 * 1024);
    if (largeRequest) return largeRequest;

    const limited = rateLimit(request, {
      name: "ask-logy",
      limit: 30,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const body = await request.json();
    message = cleanMessage(body?.message);
    const history = cleanHistory(body?.history);

    if (!message) {
      return Response.json({ error: "Message is required." }, { status: 400 });
    }

    const localReply = cleanReply(answerLocally(message));

    // Fully local by default. Only call OpenAI when explicitly enabled with a funded key.
    const canUseOpenAI =
      USE_OPENAI && process.env.OPENAI_API_KEY && Date.now() >= openaiCooldownUntil;

    if (!canUseOpenAI) {
      return Response.json({ reply: localReply });
    }

    const input = [...history];
    const lastMessage = input[input.length - 1];
    if (!lastMessage || lastMessage.role !== "user" || lastMessage.content !== message) {
      input.push({ role: "user", content: message });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 9000 });

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: buildLogyInstructions(),
      input,
      temperature: 0.5,
      max_output_tokens: 220,
    });

    const reply = cleanReply(response.output_text || localReply);
    return Response.json({ reply });
  } catch (error) {
    console.error("LOGY ERROR:", error?.status, error?.code, error?.message);
    // Only back off for quota/auth failures, where retrying soon is pointless.
    // Transient timeouts should not disable the AI for everyone.
    if (error?.status === 429 || error?.status === 401) {
      openaiCooldownUntil = Date.now() + OPENAI_COOLDOWN_MS;
    }
    return Response.json({ reply: cleanReply(answerLocally(message)) });
  }
}
