export const metadata = {
  title: "Our Style",
  description: "Explore the Husnalogy style direction for clean, refined, elegant, and meaningful products.",
};

const stylePoints = [
  ["Clean", "Layouts stay calm and easy to understand, with no unnecessary clutter."],
  ["Elegant", "Typography, spacing, and image placement are chosen to feel polished and timeless."],
  ["Meaningful", "The design gives space to the names, date, photo, message, and emotional value of the product."],
  ["Customer ready", "Every page and product is made for browsing, choosing, customizing, and ordering."],
];

export default function OurStylePage() {
  return (
    <main className="bg-white px-4 py-16 text-[#303839]">
      <section className="mx-auto max-w-[980px]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/50">Brand direction</p>
        <h1 className="mt-3 font-display text-4xl font-semibold md:text-5xl">Our Style</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[#303839]/72">
          Husnalogy's style is minimal, refined, and emotionally clear. The goal is not to teach customers how to design, but to help them find products that already feel thoughtful and beautifully made.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {stylePoints.map(([title, text]) => (
            <article key={title} className="rounded-none border border-[#303839]/10 bg-[#f8f6f1] p-6">
              <h2 className="font-display text-2xl">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-[#303839]/70">{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
