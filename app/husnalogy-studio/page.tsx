export const metadata = {
  title: "Husnalogy Studio",
  description: "Learn about Husnalogy studio, its design direction, and its refined wedding stationery and gift products.",
};

export default function HusnalogyStudioPage() {
  return (
    <main className="bg-[#f8f6f1] px-4 py-16 text-[#303839]">
      <section className="mx-auto max-w-[1060px] rounded-none border border-[#303839]/8 bg-white p-6 md:p-10 lg:p-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/50">About the studio</p>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-tight md:text-5xl">Husnalogy Studio</h1>
        <p className="mt-5 max-w-3xl text-sm leading-7 text-[#303839]/75">
          Husnalogy creates clean, elegant, and meaningful wedding stationery, invitations, personalized gifts, and keepsake products for customers who want their moments to feel carefully designed.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <div className="rounded-none border border-[#303839]/10 bg-[#f8f6f1] p-6">
            <h2 className="text-lg font-bold">Designed with care</h2>
            <p className="mt-3 text-sm leading-6 text-[#303839]/70">Each product keeps the focus on the customer's names, story, event details, and memory.</p>
          </div>
          <div className="rounded-none border border-[#303839]/10 bg-[#f8f6f1] p-6">
            <h2 className="text-lg font-bold">Refined visual style</h2>
            <p className="mt-3 text-sm leading-6 text-[#303839]/70">The studio uses clean composition, intentional spacing, and timeless typography.</p>
          </div>
          <div className="rounded-none border border-[#303839]/10 bg-[#f8f6f1] p-6">
            <h2 className="text-lg font-bold">Customer focused</h2>
            <p className="mt-3 text-sm leading-6 text-[#303839]/70">Products are made for people who want to browse, customize, order, and keep something meaningful.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
