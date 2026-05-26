export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
};

const AGENT_PRICING: Record<string, ModelPricing> = {
  claude: { inputPerMillion: 3, outputPerMillion: 15 },
  codex: { inputPerMillion: 2, outputPerMillion: 8 },
  trae: { inputPerMillion: 0, outputPerMillion: 0 },
};

export function estimateCost(inputTokens: number, outputTokens: number, agentType?: string): number {
  const pricing = (agentType ? AGENT_PRICING[agentType] : undefined) ?? DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}
