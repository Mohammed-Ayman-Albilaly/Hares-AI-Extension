import type { CategoryId, Tier } from './categories';

/** Where a detection came from: the rule engine or the NER model. */
export type DetectionSource = 'rule' | 'ner';

/** One sensitive span found in a prompt. Offsets index the original string. */
export interface Detection {
  category: CategoryId;
  /** Placeholder label, e.g. `EMAIL`, `API_KEY` → `[EMAIL_1]`. */
  label: string;
  value: string;
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  source: DetectionSource;
  /** 1 for rule matches; the model score for NER spans. */
  confidence: number;
  /** The value starts in (or was announced by) the previous message. */
  crossesMessages?: boolean;
  /** Set when the match comes from an organisation rule of the policy bundle. */
  rule?: {
    id: string;
    name: string;
    /** Risk the rule declares (SAFE = NONE). */
    risk: Tier;
    /** Enforcement level of the rule's action (BLOCK = HIGH, WARN = MEDIUM, ALLOW = LOW). */
    enforce: Tier;
    /** Position in the bundle: breaks ties when several rules match. */
    order: number;
  };
}
