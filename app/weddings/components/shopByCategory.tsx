import Reveal from "../../components/reveal";
import RightArrowIcon from "../../components/RightArrowIcon";

const weddingCategories = [
  {
    title: "Wedding Stationery",
    image: "/images/heroIMG.png",
    imageAlt: "Wedding stationery collection",
    groups: [
      [
        { label: "Wedding Invitations", href: "/collections/wedding-invitations" },
        { label: "Save the Dates", href: "/collections/save-the-dates" },
        { label: "Wedding Announcements", href: "/collections/wedding-announcements" },
        { label: "Enclosure Cards", href: "/collections/enclosure-cards" },
        { label: "Rehearsal Dinner Invitations", href: "/collections/rehearsal-dinner-invitations" },
      ],
      [
        { label: "Response Cards", href: "/collections/response-cards" },
        { label: "Thank You Cards", href: "/collections/thank-you-cards" },
        { label: "Mailing Accessories", href: "/collections/mailing-accessories" },
        { label: "Envelopes", href: "/collections/envelopes" },
        {
          label: "Shop All Wedding Stationery",
          href: "/collections/all-wedding-stationery",
          bold: true,
        },
      ],
    ],
  },
  {
    title: "Wedding Supplies & Decorations",
    image: "/images/weddings/weddingHeroImg.png",
    imageAlt: "Wedding supplies and decorations",
    groups: [
      [
        { label: "Signs", href: "/collections/signs" },
        { label: "Posters & Prints", href: "/collections/posters-prints" },
        { label: "Seating Charts", href: "/collections/seating-charts" },
        { label: "Guest Books", href: "/collections/guest-books" },
        { label: "Table Serving & Decor", href: "/collections/table-serving-decor" },
      ],
      [
        { label: "Napkins", href: "/collections/napkins" },
        { label: "Menus", href: "/collections/menus" },
        { label: "Programs", href: "/collections/programs" },
        { label: "Games & Activities", href: "/collections/games-activities" },
        {
          label: "Shop All Wedding Supplies",
          href: "/collections/all-wedding-supplies",
          bold: true,
        },
      ],
    ],
  },
];

const weddingExtraCategories = [
  {
    title: "Wedding Parties",
    groups: [
      [
        { label: "Bridal Shower Invitations", href: "/collections/bridal-shower-invitations" },
        { label: "Bridesmaid Cards", href: "/collections/bridesmaid-cards" },
        { label: "Bachelorette Invitations", href: "/collections/bachelorette-invitations" },
        { label: "Bachelor Invitations", href: "/collections/bachelor-invitations" },
        { label: "Bridal Party Proposal Cards", href: "/collections/bridal-party-proposal" },
      ],
      [
        { label: "Bridal Shower Supplies", href: "/collections/bridal-shower-invitations" },
        { label: "Bridal Shower Games", href: "/collections/wedding-parties" },
        { label: "Bachelorette Supplies", href: "/collections/bachelorette-invitations" },
        { label: "Bachelor Supplies", href: "/collections/bachelor-invitations" },
        {
          label: "Shop All Wedding Party Supplies",
          href: "/collections/all-wedding-party-supplies",
          bold: true,
        },
      ],
    ],
  },
  {
    title: "Wedding Favors & Gifts",
    groups: [
      [
        { label: "Wedding Favors", href: "/collections/wedding-favors" },
        { label: "Matches", href: "/collections/matches" },
        { label: "Candy Favors", href: "/collections/candy-favors" },
        { label: "Packaging", href: "/collections/packaging" },
        { label: "Favor Tags", href: "/collections/favor-tags" },
      ],
      [
        { label: "Wedding Party Gifts", href: "/collections/wedding-party-gifts" },
        { label: "Newlywed Gifts", href: "/collections/newlywed-gifts" },
        { label: "Wedding Albums", href: "/collections/wedding-albums" },
        { label: "Wedding Anniversary Gifts", href: "/collections/wedding-anniversary-gifts" },
        {
          label: "Shop All Wedding Gifts",
          href: "/collections/all-wedding-gifts",
          bold: true,
        },
      ],
    ],
  },
];

function CategoryLinks({ groups }) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {groups.map((group, groupIndex) => (
        <ul key={groupIndex} className="flex flex-col">
          {group.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                className={`group block rounded-none px-3 py-2 text-[0.92rem] transition duration-200 ${
                  link.bold
                    ? "mt-1 font-semibold text-[#303839] hover:text-[#303839]"
                    : "font-normal text-[#303839]/80 hover:bg-[#f8f6f1] hover:text-[#303839]"
                }`}
              >
                {link.bold ? (
                  <span className="inline-flex items-center gap-1.5">
                    {link.label}
                    <Arrow />
                  </span>
                ) : (
                  link.label
                )}
              </a>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export default function WeddingCategorySection() {
  return (
    <section className="overflow-hidden bg-[#f8f6f1] px-4 py-16 sm:px-6 sm:py-20 lg:px-12 lg:py-24 xl:px-16">
      <div className="mx-auto max-w-[1480px]">
        <Reveal as="header" className="mx-auto max-w-[680px] text-center">
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#303839]/55">
            Everything for the day
          </p>
          <h2 className="font-display text-[2rem] font-medium leading-[1.08] text-[#303839] sm:text-[2.5rem] lg:text-[2.75rem]">
            Shop by Category
          </h2>
          <p className="mt-5 text-[0.98rem] leading-[1.6] text-[#303839]/65">
            Everything you need for the whole celebration, beautifully organized.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:mt-14">
          {weddingCategories.map((category, i) => (
            <Reveal key={category.title} delay={i * 120} className="h-full">
              <div className="group flex h-full flex-col rounded-none border border-[#303839]/[0.06] bg-white p-5 shadow-[0_12px_35px_rgba(48,56,57,0.05)] transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_24px_55px_rgba(48,56,57,0.12)] sm:p-6">
                <div className="overflow-hidden rounded-none bg-[#f8f6f1]">
                  <img
                    src={category.image}
                    alt={category.imageAlt}
                    className="aspect-[16/9] h-full w-full object-cover"
                  />
                </div>

                <h3 className="mt-6 text-center font-display text-[1.7rem] font-medium leading-tight text-[#303839] sm:text-[1.95rem]">
                  {category.title}
                </h3>

                <CategoryLinks groups={category.groups} />
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="group mt-6 overflow-hidden rounded-none bg-[#f8f6f1] shadow-[0_12px_35px_rgba(48,56,57,0.05)]">
          <img
            src="/images/weddings/wedding-parties-gifts.png"
            alt="Wedding parties, favors, and gifts collection"
            className="h-[210px] w-full object-cover sm:h-[280px] lg:h-[340px]"
          />
        </Reveal>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {weddingExtraCategories.map((category, i) => (
            <Reveal key={category.title} delay={i * 120} className="h-full">
              <div className="flex h-full flex-col rounded-none border border-[#303839]/[0.06] bg-white p-5 shadow-[0_12px_35px_rgba(48,56,57,0.05)] transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_24px_55px_rgba(48,56,57,0.12)] sm:p-6">
                <h3 className="text-center font-display text-[1.7rem] font-medium leading-tight text-[#303839] sm:text-[1.95rem]">
                  {category.title}
                </h3>

                <CategoryLinks groups={category.groups} />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Arrow() {
  return <RightArrowIcon className="group-hover:translate-x-1" />;
}
