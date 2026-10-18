# 2. Hybrid, explainable scoring

**Decision:** The overall score blends deterministic ATS checks (30% parseability, 30% keyword match) with the AI's quality scores (40%). Every deduction carries its evidence.

**Why:** Asking an AI for one number gives answers nobody can check. Layout problems, missing sections and missing keywords can be measured exactly, so they are code, tested and repeatable. The AI is used for what rules can't judge: tone, content and structure quality.

**Details:** If no job description is given the keyword part is dropped and the weights are rescaled. A resume the AI declines to score fails instead of saving a fake score.

**Limits:** These are heuristics, not any employer's real ATS. The evaluation dataset is synthetic and the rules were tuned against it, so its perfect scores prove the checks work on those cases, not on real resumes.

**Alternatives:** AI only (opaque, varies); rules only (can't judge writing quality).
