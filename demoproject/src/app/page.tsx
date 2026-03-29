/**
 * Landing page: "Why You Should Move to SF"
 *
 * A single-screen, no-scroll, visually striking page presenting
 * the case for relocating to San Francisco across four pillars:
 * tech/AI, lifestyle, community, and the Founders Inc perspective.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const HERO_TITLE = "Why You Should Move to SF";
const HERO_SUBTITLE = "The gravity well for builders, dreamers, and the unreasonably ambitious.";

const STATS = [
  { value: "$112B", label: "VC raised in 2025" },
  { value: "76K+", label: "AI professionals" },
  { value: "7x7 mi", label: "Compact & walkable" },
  { value: "260", label: "Sunny days/year" },
];

const PILLARS = [
  {
    icon: "\u{1F9E0}",
    title: "AI Capital of the World",
    color: "from-violet-500 to-purple-600",
    border: "border-violet-500/20",
    items: [
      "OpenAI, Anthropic, xAI -- all HQ'd here",
      "45% of all US venture capital flows through SF",
      "Median software engineer salary: $269K",
      "80% of new office leases are AI companies",
    ],
  },
  {
    icon: "\u{1F308}",
    title: "Lifestyle Like Nowhere Else",
    color: "from-orange-500 to-pink-500",
    border: "border-orange-500/20",
    items: [
      "Mediterranean climate, no AC needed",
      "Yosemite, wine country, Big Sur -- all < 3.5hrs",
      "More restaurants per capita than any US city",
      "Golden Gate Park: 20% bigger than Central Park",
    ],
  },
  {
    icon: "\u{26A1}",
    title: "Density of Ambition",
    color: "from-cyan-400 to-blue-500",
    border: "border-cyan-500/20",
    items: [
      "\"What are you building?\" is the default small talk",
      "YC, South Park Commons, AGI House -- all here",
      "Co-founder matches happen at coffee shops",
      "The city selects for people who ship",
    ],
  },
  {
    icon: "\u{1F3D7}\u{FE0F}",
    title: "Founders Inc Says It Best",
    color: "from-amber-400 to-yellow-500",
    border: "border-amber-500/20",
    items: [
      "\"Just move to SF. It will change your life.\"",
      "1,000 founders brought to their Fort Mason campus",
      "Proximity creates surface area for opportunity",
      "Environment > strategy when barriers to start are low",
    ],
  },
];

// ============================================================================
// COMPONENTS
// ============================================================================

function StatCard({ value, label, index }: { value: string; label: string; index: number }) {
  const delayClass = `delay-${(index + 3) * 200}`;
  return (
    <div className={`animate-slide-up ${delayClass} text-center`}>
      <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
        {value}
      </div>
      <div className="text-xs text-white/50 mt-1">{label}</div>
    </div>
  );
}

function PillarCard({
  pillar,
  index,
}: {
  pillar: (typeof PILLARS)[number];
  index: number;
}) {
  const delayClass = `delay-${(index + 5) * 200}`;
  return (
    <div
      className={`animate-slide-up ${delayClass} group relative rounded-xl border ${pillar.border} bg-white/[0.03] backdrop-blur-sm p-4 hover:bg-white/[0.06] transition-all duration-300 hover:scale-[1.02]`}
    >
      {/* Glow effect on hover */}
      <div
        className={`absolute inset-0 rounded-xl bg-gradient-to-br ${pillar.color} opacity-0 group-hover:opacity-[0.07] transition-opacity duration-300`}
      />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">{pillar.icon}</span>
          <h3
            className={`text-sm font-semibold bg-gradient-to-r ${pillar.color} bg-clip-text text-transparent`}
          >
            {pillar.title}
          </h3>
        </div>
        <ul className="space-y-1.5">
          {pillar.items.map((item) => (
            <li key={item} className="text-xs text-white/60 flex items-start gap-2">
              <span className="text-white/20 mt-0.5 shrink-0">--</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ============================================================================
// RENDER
// ============================================================================

export default function Home() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#030014] flex items-center justify-center">
      {/* Ambient background orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-purple-600/20 blur-[120px] animate-pulse-glow" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-cyan-500/15 blur-[120px] animate-pulse-glow delay-1000" />
      <div className="absolute top-[30%] right-[20%] w-[300px] h-[300px] rounded-full bg-orange-500/10 blur-[100px] animate-pulse-glow delay-500" />

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Main content */}
      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="text-center mb-6">
          <h1 className="animate-slide-up delay-100 text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-white via-purple-200 to-cyan-200 bg-clip-text text-transparent animate-gradient">
              {HERO_TITLE}
            </span>
          </h1>
          <p className="animate-slide-up delay-300 mt-3 text-sm md:text-base text-white/40 max-w-xl mx-auto">
            {HERO_SUBTITLE}
          </p>
        </div>

        {/* Stats row */}
        <div className="flex justify-center gap-8 md:gap-14 mb-8">
          {STATS.map((stat, i) => (
            <StatCard key={stat.label} value={stat.value} label={stat.label} index={i} />
          ))}
        </div>

        {/* Pillar cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PILLARS.map((pillar, i) => (
            <PillarCard key={pillar.title} pillar={pillar} index={i} />
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="animate-slide-up delay-1400 text-center mt-6">
          <p className="text-xs text-white/30 italic">
            &quot;It&apos;s never been easier to start a company -- that&apos;s exactly why environment matters more than ever.&quot;
            <span className="text-white/50 ml-1">-- Founders, Inc.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
