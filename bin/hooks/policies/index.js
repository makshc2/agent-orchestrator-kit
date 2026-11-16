import { contextPolicy } from './context.js';
import { recoveryPolicy } from './recovery.js';

export const builtinPolicies = [recoveryPolicy, contextPolicy];
