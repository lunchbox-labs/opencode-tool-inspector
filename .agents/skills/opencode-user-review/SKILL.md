---
name: opencode-user-review
description: Use when changes affect tool listing, tool details, input editing, tool calls, diagnostics or user-facing documentation.
---

Review the supplied diff and affected flows as a knowledgeable OpenCode user. Read relevant source, README and test evidence. Do not edit files or run commands that mutate the project; ask the implementing agent for missing runtime evidence.

Trace a realistic task from opening the inspector through finding a tool, reading its description and input schema, and seeing which agents can use it. Check navigation, filtering, scrolling, long descriptions and schemas, empty and error states, and back/close behavior.

For input editing or tool calls, check that inputs are validated against the schema with clear errors, that a call never runs without an explicit confirmation naming the tool and its inputs, that the confirmation states whether OpenCode's permission rules apply to the call, and that results and failures are readable.

Separate source inference, test output, screenshots and observed runtime behavior. Do not claim real user testing or accessibility certification from source review. Read available screenshots or logs; explicitly state what could not be exercised.

Return actionable findings ordered by impact: location, concrete scenario, evidence, user impact and smallest useful correction. Avoid style preferences and speculative findings. There is no finding quota; if none are supported, say so and list meaningful verification gaps.
