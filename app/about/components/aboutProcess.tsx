import Reveal from "./Reveal";

const steps = [
  { number: "01", title: "Conversation", body: "We learn your story and your date before we draw a single line." },
  { number: "02", title: "Sketch", body: "Each design is shaped around your names, dates and details." },
  { number: "03", title: "Proof", body: "We revise until the design feels clear, balanced and ready." },
  { number: "04", title: "Craft", body: "Printing, cutting and assembly are handled with careful attention." },
  { number: "05", title: "Send", body: "Your order is checked, packed and prepared for its final journey." },
];

export default function AboutProcess() {
  return (
    <section aria-labelledby="about-process-heading" className="bg-cream">
      <div className="page-container section">
        <Reveal className="max-w-[560px]">
          <p className="eyebrow">From sketch to send</p>
          <h2 id="about-process-heading" className="heading-section mt-3">
            Five steps, never skipped.
          </h2>
        </Reveal>

        {/* A vertical timeline on small screens, one connected row on desktop. */}
        <div className="relative mt-10 lg:mt-14">
          <span aria-hidden="true" className="absolute bottom-6 left-6 top-6 w-px bg-ink/15 lg:bottom-auto lg:right-6 lg:h-px lg:w-auto" />
          <ol className="relative grid gap-8 lg:grid-cols-5 lg:gap-6">
            {steps.map((step, index) => (
              <Reveal as="li" key={step.number} delay={index * 90} className="relative flex gap-5 lg:block">
                <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full border border-ink/20 bg-cream font-display text-[17px] font-medium text-ink">
                  {step.number}
                </span>
                <span className="block pt-2 lg:pt-6">
                  <span className="block font-display text-[1.5rem] font-medium leading-tight text-ink">{step.title}</span>
                  <span className="mt-2 block max-w-[34ch] text-[15px] leading-[1.7] text-muted">{step.body}</span>
                </span>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
