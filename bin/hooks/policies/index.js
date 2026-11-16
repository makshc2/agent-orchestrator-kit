import { contextPolicy } from './context.js';
import { recoveryPolicy } from './recovery.js';
import { workflowPolicies } from './workflow.js';

export const builtinPolicies = [recoveryPolicy, contextPolicy, ...workflowPolicies];
