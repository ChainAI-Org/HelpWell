/**
 * Engagements as the widget receives them from `GET /engage`.
 *
 * The same shape as `@helpwell/core`'s engage schema, minus what stays on the
 * server (targeting, schedule, frequency, the internal name). Restated here
 * rather than imported because the widget is browser code and must not pull
 * the engine in; `normalize.ts` fills anything an older or hand-fed
 * definition leaves out, so the renderers can trust these types.
 */

export type ButtonAction = 'url' | 'dismiss' | 'next' | 'tour' | 'chat' | 'article';

export interface EngageButton {
  label: string;
  action: ButtonAction;
  value: string;
  style: 'primary' | 'secondary';
  newTab: boolean;
}

export type Block =
  | {
      type: 'text';
      markdown: string;
      /**
       * Personalisation (personalize.ts): each `{{field}}` in `markdown` has
       * been swapped for a marker, and this is what each marker becomes once
       * the Markdown is drawn, as text. Absent when there were none.
       */
      values?: string[];
    }
  | { type: 'image'; url: string; alt: string; link: string }
  | { type: 'gif'; url: string; alt: string }
  | { type: 'video'; url: string; title: string }
  | { type: 'buttons'; buttons: EngageButton[] }
  | { type: 'divider' };

export type Placement = 'auto' | 'top' | 'right' | 'bottom' | 'left';
/** A tour step's: `tour` follows the tour's own placement. */
export type StepPlacement = 'tour' | Placement;

export type Trigger =
  | { type: 'load' }
  | { type: 'delay'; seconds: number }
  | { type: 'scroll'; percent: number }
  | { type: 'exit' }
  | { type: 'time_on_page'; seconds: number }
  | { type: 'inactivity'; seconds: number }
  | { type: 'click'; selector: string }
  | { type: 'event'; name: string }
  | { type: 'manual' };

interface Base {
  id: string;
  /** Whichever happens first shows it. Never empty. */
  triggers: Trigger[];
  priority: number;
  dismissible: boolean;
}

export interface ModalEngagement extends Base {
  kind: 'modal';
  modal: {
    size: 'small' | 'medium' | 'large' | 'full';
    mediaPosition: 'top' | 'side' | 'background';
    progress: 'dots' | 'bar' | 'count';
    slides: { blocks: Block[] }[];
  };
}

export interface BannerEngagement extends Base {
  kind: 'banner';
  banner: {
    position: 'top' | 'bottom';
    style: 'inline' | 'floating';
    tone: 'accent' | 'neutral' | 'warning' | 'custom';
    background: string;
    color: string;
    /** Stays in view while the page scrolls; off, it scrolls away with the page's top or end. */
    sticky: boolean;
    /** A countdown to `until` (ISO) after the text; at zero it goes (`hide`) or stays. */
    countdown: { until: string | null; onEnd: 'hide' | 'keep' };
    blocks: Block[];
  };
}

export interface HotspotEngagement extends Base {
  kind: 'hotspot';
  hotspot: {
    target: string;
    placement: Placement;
    beacon: 'pulse' | 'dot' | 'question';
    blocks: Block[];
  };
}

export interface TourStep {
  target: string;
  placement: StepPlacement;
  page: string;
  advance: 'next' | 'click' | 'url';
  url: string;
  blocks: Block[];
}

export interface TourEngagement extends Base {
  kind: 'tour';
  tour: {
    steps: TourStep[];
    placement: Placement;
    spotlight: boolean;
    showProgress: boolean;
    allowSkip: boolean;
    missingTarget: { waitSeconds: number; action: 'skip' | 'stop' };
  };
}

export type QuestionKind = 'nps' | 'csat' | 'stars' | 'single' | 'multi' | 'text';

export interface SurveyBranch {
  choices: string[];
  min: number | null;
  max: number | null;
  goto: string;
}

export interface SurveyQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  choices: string[];
  required: boolean;
  placeholder: string;
  lowLabel: string;
  highLabel: string;
  followUp: { enabled: boolean; prompt: string; when: 'detractors' | 'always' };
  branches: SurveyBranch[];
  next: string;
}

export interface SurveyEngagement extends Base {
  kind: 'survey';
  survey: {
    placement: 'corner' | 'center' | 'bar';
    theme: 'brand' | 'light' | 'dark';
    intro: Block[];
    questions: SurveyQuestion[];
    thankYou: Block[];
  };
}

export type Engagement =
  | ModalEngagement
  | BannerEngagement
  | HotspotEngagement
  | TourEngagement
  | SurveyEngagement;

export type EngagementKind = Engagement['kind'];

export type ImpressionState = 'seen' | 'clicked' | 'dismissed' | 'completed';

/** One answer, as `POST /surveys/:id/response` takes it. */
export interface SurveyAnswerBody {
  session: string;
  questionId: string;
  kind: QuestionKind;
  score?: number;
  choice?: string;
  choices?: string[];
  comment?: string;
}
