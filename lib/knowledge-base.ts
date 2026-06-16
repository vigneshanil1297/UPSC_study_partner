// Topper playbook + evaluation lens. Distilled from ALL topper answer copies in
// `toppers papers/`, mined across subjects: Shakti Dubey AIR-1 2024 (culture/
// history), Aditya Srivastava AIR-1 2023 (history/society), Akansh Dhull AIR-3
// (economy/environment + VisionIAS geography: cyclones/textile/urbanisation),
// Animesh Pradhan (freedom struggle/press + physical geography: deserts),
// Raj Krishna AIR-8 (society/population/environment), Zinnia Arora (energy
// transition + physical geography: calderas/heatwaves), and the GS1 PYQ
// 2013-25 set (directive + theme distribution). Patterns below are saturated
// across these.
//
// This is the knowledge base injected into the evaluation prompt. It encodes
// what a top answer/essay actually does, and what an examiner looks for —
// derived from real topper scripts, not generic advice. Update it as more
// patterns are observed.
//
// TWO LENSES below: TOPPER_PLAYBOOK (general answer technique — applies to both
// GS analytical answers and essays) and ESSAY_LENS (Essay-paper specific, and
// it OVERRIDES the playbook's point-form/diagram presentation guidance, because
// essays are sustained prose, not boxed bullets).

export const TOPPER_PLAYBOOK = `
## What separates a topper answer (observed in AIR-1/AIR-3/AIR-8 copies)

These are the concrete, repeatable habits that distinguish high-scoring scripts.
Reward their presence; penalise their absence.

### Specificity is the #1 differentiator
- Every claim is backed by a NAMED, often DATED example. Not "ancient caves" but
  "Lakhudiyar (Uttarakhand) and Sohagighat (UP) caves"; not "a press law" but
  "Vernacular Press Act 1878"; not "a businessman helped" but "Tatas donated to
  the Tilak fund, 1920". Vague, generic content is the clearest weakness marker.
- Toppers name: people, places, dates, Acts/policies, schemes, reports,
  committees, organisations, specific sites/monuments, data points.
- They SOURCE their facts: cite the report/body behind a statistic or definition
  ("NITI Aayog: ₹92k crore food wasted yearly", "Economic Survey 2021", "World
  Bank defines blue economy as…", "UN Population report", "2011 Census: 35%
  urban", "ISRO: 29.3% land under degradation", "IMD", "Down to Earth report",
  "Press Freedom Index 161/180, 2023", named economists/thinkers, "Budget 2023:
  ₹6000 cr PM Matsya Sampada Yojana"). A sourced fact reads as authoritative; an
  unsourced sweeping claim reads as weak. Data is often paired with a benchmark
  or comparison ("$17/capita infra vs $100 required", "+1.62°C vs Paris target").

### Structure (Introduction – Body – Conclusion)
- INTRODUCTION (~3-4 lines): define or contextualise the core term, name the
  anchor (the key person/policy/source/event), and signal the direction. No long
  windup. Underline the key term. Strong openings often lead with a sourced data
  or index hook ("Press Freedom Index 161/180 (2023)…", "35% of India is urban
  (2011 Census)…") or a crisp sourced definition ("World Bank defines blue
  economy as…"); geography/science answers often open definition + a labelled
  diagram.
- BODY: organised under clear SUB-HEADINGS (toppers box or underline them), e.g.
  thematic ("Significance of X"), chronological ("Stone Age → IVC → Ancient
  India"), or stance-based ("Supported when… / Withdrew because… / Yet
  contributed…"). Each heading holds short NUMBERED points, one idea each.
- CONCLUSION: SYNTHESISE, do not summarise. Resolve the question, give a
  balanced/forward-looking close, and where natural link to a contemporary hook
  — often QUANTIFIED and visionary ("$5 trillion economy", "Viksit Bharat 2047",
  "10-100-1000 by 2030", "Minimum Government, Maximum Governance"). Ties back to
  the question's keyword.

### Directive compliance (critical)
- The answer must DO what the directive word asks:
  - "Discuss" → present multiple facets and examine them.
  - "Evaluate / Critically examine" → weigh both sides, then judge.
  - "Analyse" → break into parts and show relationships (e.g. "analyse the
    varying positions" → literally separate and treat each position).
  - "Examine the role of" → establish the role with evidence, qualify it.
- A fluent answer that ignores the directive scores poorly. Check this first.

### Multidimensionality & balance
- Strong answers span dimensions where relevant — social, economic, political,
  ethical, environmental, historical, geographical, international, S&T.
- Balance = fairly representing more than one viewpoint before judging. Toppers
  explicitly mark the turn ("However…", "Yet…", "On the other hand…").

### Presentation (visible in the scripts, rewardable)
- Sub-headings boxed/underlined; key terms underlined.
- Numbered/bulleted points rather than dense paragraphs.
- DIAGRAMS earn credit and recur in specific forms — reward an apt one, note its
  absence where it would have helped:
  - Labelled SKETCH MAPS (world or regional outlines) to LOCATE examples — e.g.
    8 named deserts on a world map, Andes→Atacama rain-shadow, Amazon/Congo
    forests, an India map shading wind/solar/geothermal zones. Core to geography.
  - CROSS-SECTIONS / process figures (caldera collapse, cyclone eye + eye-wall).
  - CYCLE / LOOP diagrams (poverty cycle, the "cobweb" price loop).
  - MIND-MAPS: a central boxed concept with arrows radiating to sub-points
    (e.g. "green energy: current status" → thermal/renewable/coal).
  - PROCESS FLOWCHARTS: vertical arrow chains (lava erupts → … → caldera left).
  - LINKAGE chains and timelines ("Ajanta → Bagh → Ellora"; press-evolution).
  - 2-COLUMN compare (Success | Challenges) and CONCLUSION-AS-DIAGRAM (a closing
    figure branching to the synthesised dimensions).
- Word-limit discipline: 150 words for a 10-marker, 250 for a 15-marker. Content
  density matters more than length; padding is penalised.

### Frameworks, scheme-mapping & contemporary hooks
- Toppers compress scope into compact FRAMEWORKS / mnemonics — e.g. textile as
  "5F: Farm → Fibre → Fabric → Fashion → Foreign". A clean framework signals
  command of the topic.
- SOLUTIONS map to REAL schemes/bodies, not vague calls to action — e.g. for
  urban poverty: Mohalla clinics, PM Awas Yojana, MGNREGA-Urban, AMRUT; for
  poverty cycle: Mid Day Meal, Skill India, NFSM. Name the instrument.
- They TAG to live frames where apt: SDGs (e.g. "SDG-10"), national missions
  (Panchamrit, LT-LEDS), and current commitments. Generic "government should
  act" is weak; "addressed via X scheme / SDG-Y" is strong.
- THINKER/QUOTE hooks open or close strong answers ("Gandhi's Sarvodaya through
  Antyodaya", "press is the breath of vibrant democracy") — used sparingly and
  aptly, not as filler.

### Independent, evidenced judgement
- The best answers TAKE A POSITION and defend it with evidence, especially on
  "evaluate/to what extent" prompts — e.g. arguing AGAINST a 2-child policy
  because India's TFR is already ~2.1 and population will stabilise (~1.2bn by
  2100), or noting Arabian-Sea cyclones are lower-intensity but their impact is
  magnified by low preparedness. Reward a defended stance over fence-sitting.

### How examiners actually grade (institute feedback grids)
- Test-series grids score on a few axes that mirror this playbook: Structure &
  Presentation, Content & Conceptual Clarity (incl. value addition), Language &
  Articulation, and "Question Interpretation" (= did the answer obey the
  directive). Weigh your dimension scores consistently with these axes.

## How to apply this when evaluating
- Quote the candidate's own words as evidence for each judgement.
- The fastest way to raise a weak answer is almost always: (1) add specific named
  examples, (2) obey the directive, (3) fix structure into intro/headed-body/
  synthesising-conclusion. Lead improvement suggestions with whichever is missing.
- Do not reward fluent but empty writing. Generic, example-free, single-viewpoint
  answers that miss the directive are weak regardless of language quality.
- Be honest and critical. Score against the topper bar above, not an average
  candidate. Tell a weak answer it is weak, with specific reasons.
`.trim();

// Essay-paper specific lens. The Essay paper is NOT a GS analytical answer.
// This OVERRIDES the playbook's presentation guidance: essays are sustained,
// flowing prose — penalise, don't reward, GS-style boxed headings and bullet
// dumps. Everything else (specificity, evidence, balance) still applies.
export const ESSAY_LENS = `
## Essay-paper lens (this is the UPSC Essay paper, ~1000-1200 words, ~3 hrs for two)

An essay is a sustained, reflective piece of prose — a coherent argument or
meditation on a theme, NOT a point-by-point GS answer. Judge it as such.

### Format expectations (overrides the playbook's point-form presentation)
- FLOWING PARAGRAPHS, not boxed sub-headings or bullet lists. A high essay reads
  as continuous prose with smooth paragraph-to-paragraph transitions. Bullet
  dumps, sub-headings, and arrow-diagrams are a WEAKNESS in an essay — flag them.
- Length and stamina: a full essay sustains a single theme across many paragraphs
  without repetition or padding.

### What lifts an essay (reward these)
- A strong OPENING HOOK: an anecdote, story, vignette, quote, paradox, or image
  that draws the reader in and seeds the central idea — not a dictionary
  definition. The best essays open with narrative.
- A clear CENTRAL THREAD / thesis that every paragraph advances; the essay must
  not drift into a disconnected list of points. Argument flow is paramount.
- MULTIDIMENSIONAL CANVAS: the theme illuminated across dimensions — social,
  political, economic, historical, cultural, ethical/philosophical, scientific,
  environmental, individual/psychological, global. Breadth distinguishes essays.
- EVIDENCE ACROSS DOMAINS: apt examples, anecdotes, historical episodes, data,
  and especially well-chosen QUOTES (thinkers, leaders, literature) woven in
  naturally — not bolted on. Range of references signals a wide-reading mind.
- DEPTH & NUANCE: engages the tension in the theme, considers counter-views, and
  resists a one-sided take. Reflective, original insight beats rehearsed content.
- LANGUAGE: clear, varied, evocative where apt; controlled tone; the occasional
  memorable line. Grammar and flow matter more here than in GS.
- A CONCLUSION that resolves the thesis and, ideally, RETURNS TO THE OPENING
  motif (closes the loop), ending on a forward-looking or uplifting note.

### What sinks an essay (penalise these)
- No discernible thesis; a string of loosely related points (reads like a GS
  answer broken into paragraphs).
- One-dimensional treatment (e.g. only the political angle of a broad theme).
- Generic, quote-free, example-thin content; clichés and platitudes.
- Definitional/textbook opening with no hook; abrupt or summary-only conclusion.
- Bullet points, headings, and diagrams used as a crutch for weak prose.
- Going off-theme or misreading the philosophical/abstract prompt literally.

### Applying it
- Weigh argument flow, multidimensional coverage, evidence/quotes, depth, and
  language most heavily for essays. Quote the candidate's own lines as evidence.
- Lead improvement suggestions with the biggest lever: usually a real opening
  hook, a sharper central thesis, more dimensions, or apter quotes/examples.
`.trim();
