import type { Subject } from "./criteria";

// ---------------------------------------------------------------------------
// Topic-level dimension templates.
//
// A per-QUESTION answer bank is useless for UPSC (questions almost never
// repeat). But the THEMES recur: the GS1 syllabus is ~13 fixed areas, and a new
// question on, say, regionalism still wants the same canonical dimensions a
// strong answer always covers. So the "bank" is keyed at the syllabus-area
// level — reusable across unseen wordings, slow to go stale.
//
// At eval time we match the question text to the best-overlapping template and
// inject its dimensions as soft guidance ("strong answers here usually cover…"),
// NOT as rigid demands — the question's own demand still leads.
// ---------------------------------------------------------------------------

export type TopicTemplate = {
  subject: Subject;
  // The syllabus area label (for the prompt + traceability).
  area: string;
  // Lowercase keywords used to score relevance against the question text.
  keywords: string[];
  // The canonical angles a topper answer on this theme tends to span.
  dimensions: string[];
};

// GS1's 13 official syllabus areas, plus templates for both PSIR papers keyed
// to the syllabus sections. An unmatched question yields no template (graceful
// fallback).
const TEMPLATES: TopicTemplate[] = [
  {
    subject: "gs1",
    area: "GS1.1 Indian Art, Culture, Literature & Architecture",
    keywords: ["art", "culture", "architecture", "painting", "sculpture", "temple", "dance", "music", "literature", "stupa", "cave", "heritage", "theatre", "festival", "craft"],
    dimensions: [
      "name specific schools/styles/sites with their location and period",
      "link the form to the philosophy/religion/society that produced it",
      "trace continuity and change / regional variation",
      "note patronage (dynasty, guild, state) and present-day relevance or UNESCO/GI status",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.2-3 Modern Indian History & the Freedom Struggle",
    keywords: ["freedom", "struggle", "british", "colonial", "congress", "gandhi", "revolt", "nationalism", "movement", "swadeshi", "partition", "revolutionary", "peasant", "reform", "1857", "satyagraha"],
    dimensions: [
      "place the event/figure in its phase of the movement with dates",
      "identify the actors and their differing strategies/ideologies",
      "weigh causes vs consequences / successes vs limitations",
      "name the specific acts, sessions, organisations, leaders involved",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.4 Post-independence Consolidation & Reorganization",
    keywords: ["independence", "integration", "princely", "states", "reorganization", "linguistic", "patel", "nehru", "consolidation", "accession", "1950", "fazl", "commission"],
    dimensions: [
      "the specific challenge (integration, linguistic states, tribal, border)",
      "the institutional/constitutional response and key personalities",
      "outcomes and unresolved legacies into the present",
      "named commissions/agreements (States Reorganisation, accession instruments)",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.5 History of the World (industrial revolution, world wars, ideologies, decolonization)",
    keywords: ["world", "industrial", "revolution", "war", "colonization", "decolonization", "communism", "capitalism", "socialism", "fascism", "cold", "europe", "boundaries", "imperialism"],
    dimensions: [
      "the global cause and its chronological sequence",
      "effects across society/economy/politics, not just events",
      "comparison across regions / competing ideologies",
      "the link forward to the present world order",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.6 Salient features of Indian Society & Diversity",
    keywords: ["society", "diversity", "caste", "family", "kinship", "tribe", "unity", "pluralism", "social", "tradition", "culture", "identity"],
    dimensions: [
      "the defining feature with sociological concept + example",
      "factors sustaining or eroding it",
      "regional/community variation",
      "contemporary stresses and the constitutional/policy response",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.7 Role of Women & Women's Organizations; Population",
    keywords: ["women", "gender", "feminist", "patriarchy", "population", "fertility", "demographic", "empowerment", "shg", "maternal", "sex", "ratio", "dividend"],
    dimensions: [
      "the structural/patriarchal root, not just symptoms",
      "data and a named scheme/organisation/movement",
      "intersection with caste/class/region",
      "way ahead tied to SDGs / a named mission",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.8 Poverty, Development, Urbanization — problems & remedies",
    keywords: ["poverty", "development", "urban", "urbanization", "slum", "migration", "inequality", "employment", "housing", "city", "informal", "remedy"],
    dimensions: [
      "define + quantify the problem with a sourced figure",
      "multi-causal analysis (economic, social, spatial)",
      "map remedies to REAL schemes/missions (AMRUT, PMAY, MGNREGA…)",
      "balance the structural with the immediate",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.9 Effects of Globalization on Indian Society",
    keywords: ["globalization", "globalisation", "global", "liberalization", "market", "culture", "consumerism", "homogenization", "diaspora", "technology", "media"],
    dimensions: [
      "separate economic, cultural and social effects",
      "show BOTH gains and disruptions (balance)",
      "named examples (sectors, communities, regions affected)",
      "the policy/identity response",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.10 Social Empowerment, Communalism, Regionalism & Secularism",
    keywords: ["empowerment", "communalism", "regionalism", "secularism", "minority", "dalit", "reservation", "ethnic", "separatist", "identity", "religion", "autonomy"],
    dimensions: [
      "define the concept and its Indian constitutional basis",
      "causes / drivers with named real movements or episodes",
      "consequences for the polity and social fabric",
      "remedies — constitutional provisions, commissions, way ahead",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.11 World's Physical Geography",
    keywords: ["physical", "geography", "plate", "tectonic", "ocean", "current", "wind", "climate", "monsoon", "atmosphere", "landform", "mountain", "jet", "stream", "pressure"],
    dimensions: [
      "the mechanism/process explained step by step",
      "a LABELLED diagram or sketch where it locates/illustrates",
      "global pattern + a named regional example",
      "human/climatic significance of the phenomenon",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.12 Distribution of Natural Resources & Industrial Location",
    keywords: ["resource", "mineral", "industry", "industrial", "location", "agriculture", "energy", "factor", "distribution", "sector", "manufacturing", "supply", "raw"],
    dimensions: [
      "the locating factors (raw material, market, labour, power, policy)",
      "a sketch map / where resources or industry cluster and why",
      "named regions/belts/examples (in India and the world)",
      "shifts over time and policy levers",
    ],
  },
  {
    subject: "gs1",
    area: "GS1.13 Geophysical Phenomena (earthquakes, tsunami, volcanoes, cyclones)",
    keywords: ["earthquake", "tsunami", "volcano", "volcanic", "cyclone", "disaster", "hazard", "flood", "landslide", "seismic", "eruption", "mitigation", "geophysical"],
    dimensions: [
      "the formation mechanism with a labelled diagram",
      "distribution / why it occurs where it does",
      "impacts (both destructive and, where asked, beneficial)",
      "mitigation tied to a framework (Sendai, NDMA) and a named event",
    ],
  },

  // ------------------------- PSIR Paper I -------------------------
  {
    subject: "psir1",
    area: "PSIR1.A Core concepts of political theory (justice, equality, rights, liberty, democracy, power)",
    keywords: ["justice", "equality", "rights", "liberty", "freedom", "democracy", "power", "hegemony", "legitimacy", "citizenship", "affirmative", "rawls", "nozick", "berlin", "deliberative", "participatory", "representative"],
    dimensions: [
      "open by locating the concept (contested/architectonic/normative) and the thinker who anchors the modern debate",
      "march the concept through the competing schools — liberal → libertarian → communitarian → Marxist → feminist → multiculturalist → post-modern — each position attributed to a named thinker with the counter marked",
      "2-4 short attributed quotes anchoring key positions",
      "bridge to the Indian constitutional/contemporary context (Article 21, reservation, Basic Structure, a live episode)",
      "synthesising conclusion that takes a defended position, not a summary",
    ],
  },
  {
    subject: "psir1",
    area: "PSIR1.A Theories of state & political ideologies",
    keywords: ["state", "ideology", "liberalism", "socialism", "marxism", "fascism", "gandhism", "feminism", "pluralist", "neoliberal", "postcolonial", "anarchism", "welfare"],
    dimensions: [
      "define the theory/ideology's core claims via its canonical thinkers and texts",
      "contrast it with the rival theories of the state, marking each turn",
      "internal variants and evolution (classical vs contemporary strands)",
      "critiques from other schools + the ideology's continuing relevance, with an Indian illustration where apt",
    ],
  },
  {
    subject: "psir1",
    area: "PSIR1.A Western political thought (Plato → Arendt)",
    keywords: ["plato", "aristotle", "machiavelli", "hobbes", "locke", "rousseau", "mill", "marx", "gramsci", "arendt", "thinker", "philosopher", "kant", "bentham", "hegel"],
    dimensions: [
      "locate the thinker in their historical context and the problem they answered",
      "core concepts with the texts they come from, accurately attributed",
      "major critiques and who made them",
      "comparison/dialogue with other thinkers on the same question",
      "contemporary relevance of the idea",
    ],
  },
  {
    subject: "psir1",
    area: "PSIR1.A Indian political thought (Dharamshastra → M.N. Roy)",
    keywords: ["kautilya", "arthashastra", "dharamshastra", "buddhist", "gandhi", "ambedkar", "aurobindo", "roy", "syed", "vivekananda", "tagore", "swaraj", "sarvodaya", "humanism"],
    dimensions: [
      "the thinker's key concepts with their texts/speeches, accurately attributed",
      "the Western frame or contemporaries they engage (Gandhi–Ambedkar, Roy vs orthodox Marxism, Aurobindo vs liberal nationalism)",
      "evolution of the thinker's position over time where relevant",
      "contemporary application of the idea in Indian politics",
    ],
  },
  {
    subject: "psir1",
    area: "PSIR1.B Indian nationalism & perspectives on the national movement",
    keywords: ["nationalism", "freedom", "satyagraha", "noncooperation", "civil", "disobedience", "revolutionary", "peasant", "perspectives", "movement", "constitutionalism"],
    dimensions: [
      "the phase/strategy with dates and named episodes",
      "perspective-wise treatment — Liberal, Socialist, Marxist, Radical Humanist, Dalit — each with its named scholars/proponents",
      "debates between strategies (moderates vs extremists, Gandhi vs revolutionaries)",
      "assessment: what each perspective illuminates and misses",
    ],
  },
  {
    subject: "psir1",
    area: "PSIR1.B Constitution, Union organs, federalism & institutions",
    keywords: ["constitution", "preamble", "parliament", "judiciary", "judicial", "supreme", "court", "president", "governor", "federalism", "centre", "basic", "structure", "amendment", "commission", "panchayati", "grassroots", "election"],
    dimensions: [
      "the constitutional provisions and their intent (envisaged role)",
      "actual working with named cases, episodes, and commissions",
      "scholarly framing (Granville Austin, Morris-Jones, K.C. Wheare's 'quasi-federal', Rajni Kothari)",
      "current debates/reform proposals and a balanced judgement",
    ],
  },
  {
    subject: "psir1",
    area: "PSIR1.B Parties, caste, elections & social movements",
    keywords: ["party", "parties", "coalition", "caste", "religion", "ethnicity", "electoral", "voting", "pressure", "groups", "movements", "civil", "women", "environmental"],
    dimensions: [
      "the empirical trend with named parties/movements/elections",
      "scholarly interpretation (Rajni Kothari's 'Congress system', Yogendra Yadav's 'democratic upsurge', Kanchan Chandra on ethnic parties)",
      "social bases and changing profile over time",
      "significance for Indian democracy, judged both ways",
    ],
  },

  // ------------------------- PSIR Paper II -------------------------
  {
    subject: "psir2",
    area: "PSIR2.A Comparative politics: approaches & the state in comparative perspective",
    keywords: ["comparative", "approaches", "political", "economy", "sociology", "systems", "structural", "functionalism", "capitalist", "socialist", "developing", "advanced", "industrial", "representation", "participation"],
    dimensions: [
      "the approach's core claims with named theorists (Easton's systems theory, Almond & Powell, political sociology — Béteille/Kothari/Yadav)",
      "its limitations and the critique (Hedley Bull's 'model-building exercise'; ethnocentrism of the comparative method)",
      "application across state types (capitalist/socialist, advanced/developing) with named country examples",
      "a judged position on the approach's continuing utility",
    ],
  },
  {
    subject: "psir2",
    area: "PSIR2.A IR theory (realism, liberalism, Marxism, constructivism, feminism, post-modernism)",
    keywords: ["realism", "neorealism", "morgenthau", "waltz", "liberalism", "neoliberalism", "keohane", "nye", "constructivism", "wendt", "wallerstein", "dependency", "feminist", "tickner", "postmodern", "idealist", "theory", "anarchy"],
    dimensions: [
      "define the school via its canonical thinkers and signature concepts (animus dominandi, security dilemma, complex interdependence, 'anarchy is what states make of it')",
      "stage the inter-school debate: each rival's counter-position, attributed and marked",
      "correct IR vocabulary (national interest, balance of power, deterrence, security dilemma, soft/hard power)",
      "apply to a live episode (Ukraine, Indo-Pacific, climate regime) to ground the theory",
    ],
  },
  {
    subject: "psir2",
    area: "PSIR2.A Global order: UN, globalisation, regionalisation, contemporary concerns",
    keywords: ["united", "nations", "unsc", "globalisation", "globalization", "regionalisation", "asean", "european", "union", "wto", "bretton", "nieo", "cold", "war", "unipolarity", "multipolarity", "terrorism", "proliferation", "environment", "human", "rights"],
    dimensions: [
      "envisaged role vs actual record, with named episodes/agencies",
      "theoretical framing (which school explains the institution/trend best)",
      "developed vs developing world responses — the Global South angle",
      "reform debates and India's stake, ending with a judged position",
    ],
  },
  {
    subject: "psir2",
    area: "PSIR2.B Indian foreign policy & India and the world",
    keywords: ["india", "foreign", "policy", "nam", "nonalignment", "saarc", "neighbourhood", "china", "pakistan", "usa", "russia", "nuclear", "doctrine", "act", "east", "indo", "pacific", "quad", "peacekeeping", "africa", "multialignment"],
    dimensions: [
      "determinants/continuity-and-change frame (Nehruvian idealism → strategic autonomy → multialignment) with named phases",
      "concrete policy specifics: named agreements, doctrines, summits, disputes (Indo-US nuclear deal, Act East, no-first-use)",
      "scholarly/officials' framing (C. Raja Mohan, S. Jaishankar's 'multialignment', Nehru's 'rightful place in the comity of nations')",
      "assessment against national interest + the institutional angle (PMO, MEA, Parliament) where asked",
    ],
  },
];

// Minimal content-word tokenizer (keeps the matcher self-contained).
const STOP = new Set(
  "the a an of to in on for and or is are be as by with at from that this it its their our we you not but how do does the".split(" "),
);
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

// Pick the best-matching template for the combined question text, or null if
// nothing clears a minimum keyword-overlap bar (so off-syllabus or PSIR
// questions get no injected template rather than a wrong one).
export function matchTopicTemplate(questionText: string, subject: Subject): TopicTemplate | null {
  const pool = TEMPLATES.filter((t) => t.subject === subject);
  if (!pool.length) return null;
  const qt = tokens(questionText);
  let best: TopicTemplate | null = null;
  let bestScore = 0;
  for (const t of pool) {
    let score = 0;
    for (const k of t.keywords) {
      // multi-word keyword → substring test; single word → token test
      if (k.includes(" ") ? questionText.toLowerCase().includes(k) : qt.has(k)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore >= 1 ? best : null;
}

// Render the topic-guidance block for the user turn, or "" if no template
// matches. Soft guidance, not rigid demands.
export function topicGuidance(questionText: string, subject: Subject): string {
  const t = matchTopicTemplate(questionText, subject);
  if (!t) return "";
  return `TOPIC GUIDANCE — this question falls under ${t.area}. Strong answers on this theme usually cover:\n${t.dimensions
    .map((d) => `  - ${d}`)
    .join("\n")}\nTreat these as the expected dimensions when judging coverage; the question's own specific demand still leads.`;
}
