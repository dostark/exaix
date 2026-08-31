/**
 * @module XmlPlanParser
 * @path packages/core/src/planning/xml_plan_parser.ts
 * @description Converts XML plan format (model-friendly alternative to JSON) into a
 *   PlanSchema-compatible JSON object. LLMs that struggle with JSON generation (e.g.
 *   deepseek-v4-flash through opencode CLI) can output this XML format instead.
 *   Part of Phase 141 — XML plan format as a fallback for models with weak JSON output.
 * @architectural-layer Core
 * @dependencies [PlanSchema from @exaix/schemas/plan_schema.ts]
 * @related-files [packages/core/src/planning/plan_adapter.ts]
 */

export interface IXmlPlanParseSuccess {
  success: true;
  plan: IXmlPlanObject;
}

export interface IXmlPlanParseError {
  success: false;
  error: string;
}

export type IXmlPlanParseResult = IXmlPlanParseSuccess | IXmlPlanParseError;

/**
 * Represents a parsed plan object matching PlanSchema shape.
 */
export interface IXmlPlanObject {
  title?: string;
  description: string;
  steps?: IXmlPlanStep[];
  estimatedDuration?: string;
}

interface IXmlPlanStep {
  step: number;
  title: string;
  description: string;
  actions?: IXmlPlanAction[];
  successCriteria?: string[];
}

interface IXmlPlanAction {
  tool: string;
  params: IXmlPlanParams;
  description?: string;
}

interface IXmlPlanParams {
  [key: string]: string | number | undefined;
}

const XML_TAG_TOOL = "tool";

/** Validate the returned plan with PlanSchema.safeParse(). */
export function tryParseXmlPlan(input: string): IXmlPlanParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false, error: "Empty input" };
  }

  // Must have a <plan> tag
  if (!trimmed.startsWith("<plan>")) {
    return { success: false, error: "Input does not start with <plan> tag" };
  }

  // Extract plan-level fields (only from the portion before the first <step>)
  const planHeader = trimmed.split("<step")[0];
  const title = extractElementText(planHeader, "title");
  const description = extractElementText(planHeader, "description");
  const estimatedDuration = extractElementText(planHeader, "estimatedDuration");

  if (!description) {
    return { success: false, error: "Missing required <description> element" };
  }

  // Extract step blocks
  const stepBlocks = extractBlocks(trimmed, "step");
  if (stepBlocks.length === 0) {
    return { success: false, error: "No <step> elements found in plan" };
  }

  const steps = parseStepBlocks(stepBlocks);
  if (!steps.success) return steps;

  const plan: IXmlPlanObject = {
    description,
    steps: steps.steps,
  };
  if (title) plan.title = title;
  if (estimatedDuration) plan.estimatedDuration = estimatedDuration;

  return { success: true, plan };
}

/**
 * Parse all <step> blocks into an array of IXmlPlanStep.
 */
function parseStepBlocks(
  stepBlocks: string[],
): { success: true; steps: IXmlPlanStep[] } | { success: false; error: string } {
  const steps: IXmlPlanStep[] = [];

  for (let i = 0; i < stepBlocks.length; i++) {
    const block = stepBlocks[i];
    const stepNumAttr = extractAttribute(block, "number");
    const stepNumber = stepNumAttr ? parseInt(stepNumAttr, 10) : i + 1;
    const stepTitle = extractElementText(block, "title");
    const stepDescription = extractElementText(block, "description");

    if (!stepTitle) {
      return { success: false, error: `Step ${stepNumber} is missing <title>` };
    }

    const rawToolElements = extractRawElements(block, XML_TAG_TOOL);
    const rawParamsBlocks = extractBlocks(block, "params");
    const rawDescriptions = extractElementTexts(block, "actionDescription");

    if (rawToolElements.length === 0) {
      const step: IXmlPlanStep = {
        step: stepNumber,
        title: stepTitle,
        description: stepDescription || stepTitle,
      };
      addSuccessCriteria(step, block);
      steps.push(step);
      continue;
    }

    const actions: IXmlPlanAction[] = [];
    for (let j = 0; j < rawToolElements.length; j++) {
      const action: IXmlPlanAction = {
        tool: rawToolElements[j].trim(),
        params: {},
      };
      if (j < rawDescriptions.length) {
        action.description = rawDescriptions[j].trim();
      }
      if (j < rawParamsBlocks.length) {
        action.params = parseParamsBlock(rawParamsBlocks[j]);
      }
      actions.push(action);
    }

    const step: IXmlPlanStep = {
      step: stepNumber,
      title: stepTitle,
      description: stepDescription || stepTitle,
      actions,
    };
    addSuccessCriteria(step, block);
    steps.push(step);
  }

  return { success: true, steps };
}

/**
 * Extract the text content of the first occurrence of an XML element.
 */
function extractElementText(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const match = xml.match(regex);
  if (!match) return undefined;
  return match[1].trim();
}

/**
 * Extract text contents of ALL occurrences of an XML element.
 */
function extractElementTexts(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

/**
 * Extract the value of an attribute from an XML element.
 */
function extractAttribute(xml: string, attr: string): string | undefined {
  const regex = new RegExp(`${attr}="([^"]*)"`);
  const match = xml.match(regex);
  return match ? match[1] : undefined;
}

/** Extract all raw XML blocks for a given tag (including the tag wrappers), e.g. `<params>`. */
function extractBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[0]);
  }
  return results;
}

/**
 * Extract raw element content (WITHOUT the XML tags) for simple elements.
 */
function extractRawElements(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g");
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[2].trim());
  }
  return results;
}

/** Parse a `<params>` block into a flat key-value record (child element names -> text content). */
function parseParamsBlock(paramsXml: string): IXmlPlanParams {
  const params: IXmlPlanParams = {};
  // Strip the outer <params> wrapper first
  const inner = paramsXml.replace(/^<params[^>]*>([\s\S]*)<\/params>$/, "$1").trim();
  if (!inner) return params;
  const childRegex = /<([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = childRegex.exec(inner)) !== null) {
    const key = match[1];
    let value: string | number = match[2].trim();
    // Try to parse numbers
    const num = Number(value);
    if (value !== "" && !isNaN(num)) {
      value = num;
    }
    params[key] = value;
  }
  return params;
}

/**
 * Extract successCriteria from a step block and add to the step object.
 */
function addSuccessCriteria(step: IXmlPlanStep, stepXml: string): void {
  const criteriaBlock = extractBlocks(stepXml, "successCriteria");
  if (criteriaBlock.length === 0) return;
  const items = extractRawElements(criteriaBlock[0], "item");
  if (items.length > 0) {
    step.successCriteria = items;
  }
}
