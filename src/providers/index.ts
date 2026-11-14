// The providers sync collects from. Adding one means adding its collector file and a line here;
// store, render and publish work on DayRecords alone.

import { claudeCode } from "./claude-code.ts"
import type { Provider } from "./provider.ts"

export const providers: readonly Provider[] = [claudeCode()]
