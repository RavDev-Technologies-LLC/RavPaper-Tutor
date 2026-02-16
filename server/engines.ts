import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const MODEL = "gpt-5-mini";
const MAX_TOKENS = 8192;

async function callAI(systemPrompt: string, userContent: string): Promise<any> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  const text = response.choices[0]?.message?.content || "{}";
  return JSON.parse(text);
}

export async function runPlagiarismEngine(content: string): Promise<any> {
  try {
    return await callAI(
      `You are an academic plagiarism detection engine. Analyze the provided text for potential plagiarism indicators including: unusual style shifts, inconsistent vocabulary levels, uncited claims, common patchwriting patterns, and passages that appear to be copied or closely paraphrased from common sources. You must respond with a JSON object containing: "score" (0-100 where 100 means no plagiarism detected), "findings" (array of objects with "text", "issue", "suggestion", "severity" where severity is "info", "warning", or "critical"), and "summary" (a brief overall assessment).`,
      content
    );
  } catch (e: any) {
    return { score: 0, findings: [], summary: `Engine error: ${e.message}` };
  }
}

export async function runRubricEngine(content: string, rubricCriteria: any[]): Promise<any> {
  try {
    return await callAI(
      `You are an academic rubric alignment engine. Compare the document against the provided rubric criteria and evaluate how well the document meets each criterion. You must respond with a JSON object containing: "score" (0-100 overall alignment), "criteriaScores" (array of objects with "criterion", "score", "maxScore", "feedback"), and "summary" (brief overall assessment). The rubric criteria are: ${JSON.stringify(rubricCriteria)}`,
      content
    );
  } catch (e: any) {
    return { score: 0, criteriaScores: [], summary: `Engine error: ${e.message}` };
  }
}

export async function runStatisticsEngine(content: string): Promise<any> {
  try {
    return await callAI(
      `You are a statistical methodology audit engine. Analyze the provided academic text for statistical methods, p-values, R² values, F-statistics, effect sizes, confidence intervals, sample sizes, and other quantitative measures. Identify potential issues such as p-hacking indicators, missing effect sizes, inappropriate test selection, underpowered studies, or misinterpreted results. You must respond with a JSON object containing: "score" (0-100 where 100 means excellent statistical methodology), "findings" (array of objects with "statistic", "value", "issue", "suggestion"), and "summary" (brief overall assessment).`,
      content
    );
  } catch (e: any) {
    return { score: 0, findings: [], summary: `Engine error: ${e.message}` };
  }
}

export async function runLiteratureEngine(content: string): Promise<any> {
  try {
    return await callAI(
      `You are a literature review synthesis engine. Analyze the provided academic text to detect whether the literature review sections demonstrate genuine synthesis (connecting and contrasting sources, identifying themes and gaps) versus mere summary (listing sources without integration). Also evaluate gap identification clarity and thematic organization. You must respond with a JSON object containing: "score" (0-100 where 100 means excellent synthesis), "findings" (array of objects with "section", "issue", "suggestion"), "synthesisScore" (0-100), "gapClarity" (0-100), and "summary" (brief overall assessment).`,
      content
    );
  } catch (e: any) {
    return { score: 0, findings: [], synthesisScore: 0, gapClarity: 0, summary: `Engine error: ${e.message}` };
  }
}

export async function runAnthropomorphismEngine(content: string): Promise<any> {
  try {
    return await callAI(
      `You are an anthropomorphism detection engine for academic writing. Find instances where non-human entities (studies, data, results, theories, tables, figures, research) are given human qualities or agency. For example: "The study found..." (studies don't find things, researchers do), "The data suggests..." (data doesn't suggest, it indicates or shows), "The results argue..." (results don't argue). You must respond with a JSON object containing: "score" (0-100 where 100 means no anthropomorphism found), "findings" (array of objects with "text", "issue", "suggestion", "severity" where severity is "info", "warning", or "critical"), and "summary" (brief overall assessment).`,
      content
    );
  } catch (e: any) {
    return { score: 0, findings: [], summary: `Engine error: ${e.message}` };
  }
}

export async function runFormattingEngine(content: string): Promise<any> {
  try {
    return await callAI(
      `You are an APA 7th edition formatting compliance engine. Analyze the provided academic text for APA formatting issues including: heading levels, in-text citations format, reference list formatting, table/figure labeling, margins/spacing indicators, abstract structure, title page elements, use of bias-free language, numbers and statistics formatting, and general APA style compliance. You must respond with a JSON object containing: "score" (0-100 where 100 means perfect APA compliance), "findings" (array of objects with "location", "issue", "correction"), and "summary" (brief overall assessment).`,
      content
    );
  } catch (e: any) {
    return { score: 0, findings: [], summary: `Engine error: ${e.message}` };
  }
}

export async function generateDefenseQuestions(content: string): Promise<any> {
  try {
    return await callAI(
      `You are a dissertation defense committee simulator. Based on the provided document content, generate 5-7 challenging but fair defense questions that a committee would ask. Cover methodology, theoretical framework, findings, implications, and limitations. You must respond with a JSON object containing: "questions" (array of objects with "question", "category" (one of: methodology, theory, findings, implications, limitations, general), "difficulty" (one of: moderate, challenging, advanced), "expectedThemes" (array of key themes the answer should address)).`,
      content
    );
  } catch (e: any) {
    return { questions: [] };
  }
}

export async function evaluateDefenseAnswer(question: string, answer: string, documentContext: string): Promise<any> {
  try {
    return await callAI(
      `You are evaluating a doctoral candidate's defense response. The candidate was asked: "${question}". Their document context is provided. Evaluate the quality, depth, and accuracy of their answer. You must respond with a JSON object containing: "score" (0-100), "feedback" (detailed feedback string), "strengths" (array of strength strings), "weaknesses" (array of weakness strings), "suggestions" (array of improvement suggestion strings).`,
      `Document context (excerpt): ${documentContext.slice(0, 3000)}\n\nCandidate's answer: ${answer}`
    );
  } catch (e: any) {
    return { score: 0, feedback: `Evaluation error: ${e.message}`, strengths: [], weaknesses: [], suggestions: [] };
  }
}

export function runScoringAggregator(results: any[]): any {
  if (results.length === 0) {
    return { overallScore: 0, defenseReadinessIndex: 0, priorityRevisions: [], riskAreas: [] };
  }

  const engineWeights: Record<string, number> = {
    plagiarism: 0.20,
    rubric_alignment: 0.20,
    statistics: 0.15,
    literature_review: 0.15,
    anthropomorphism: 0.10,
    formatting: 0.10,
    scoring: 0.10,
  };

  let weightedSum = 0;
  let totalWeight = 0;
  const riskAreas: any[] = [];
  const priorityRevisions: string[] = [];

  for (const result of results) {
    const weight = engineWeights[result.engineType] || 0.1;
    const score = result.score || 0;
    weightedSum += score * weight;
    totalWeight += weight;

    if (score < 60) {
      riskAreas.push({ engine: result.engineType, risk: "high", score });
      priorityRevisions.push(`${result.engineType}: Score ${score}/100 - needs significant improvement`);
    } else if (score < 80) {
      riskAreas.push({ engine: result.engineType, risk: "medium", score });
    }
  }

  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const defenseReadinessIndex = Math.min(100, Math.round(overallScore * 1.1));

  return { overallScore, defenseReadinessIndex, priorityRevisions, riskAreas };
}
